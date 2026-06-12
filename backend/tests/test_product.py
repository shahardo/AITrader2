# test_product.py — tests for Milestone 4: notifications (+Telegram mirroring),
# Telegram account linking, the topic radar, deep dives with hallucinated-ticker
# rejection, and scan/notification API endpoints.

import json
from datetime import UTC, datetime, timedelta

from app.llm.provider import LLMProvider, LLMResult, LLMUnavailable
from app.marketdata.provider import Bar, MarketDataProvider
from app.models.analysis import SentimentItem
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.product import Notification, Topic
from app.models.user import User
from app.notify import service as notify_service
from app.notify.service import complete_telegram_links, notify
from app.topics.service import refresh_topic_radar, run_deep_dive


class FakeLLM(LLMProvider):
    """Stub returning a canned parsed payload per call site."""

    def __init__(self, payloads):
        self.payloads = payloads

    def complete(self, call_site, system, user, **kwargs) -> LLMResult:
        payload = self.payloads.get(call_site)
        if payload is None:
            raise LLMUnavailable("down")
        return LLMResult(content=json.dumps(payload), parsed=payload, model="fake")


class FakeMarketData(MarketDataProvider):
    """Provider knowing a fixed set of 'real' symbols."""

    def __init__(self, real_symbols):
        self.real = set(real_symbols)

    def fetch_daily_bars(self, symbols, start, end):
        out = {}
        for s in symbols:
            if s in self.real:
                out[s] = [Bar(s, start + timedelta(days=i), 10, 11, 9, 10, 1e5)
                          for i in range(10)]
            else:
                out[s] = []
        return out


def _user(db, chat_id=None):
    user = User(email=f"n{chat_id}@x.com", password_hash="h", telegram_chat_id=chat_id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_notify_persists_and_mirrors_to_telegram(db_session, monkeypatch):
    sent = []
    monkeypatch.setattr(notify_service, "send_telegram",
                        lambda chat, text: sent.append((chat, text)) or True)
    linked = _user(db_session, chat_id="42")
    unlinked = _user(db_session)

    row1 = notify(db_session, linked, "daily_recs", "3 recommendations", "BUY AAPL...")
    row2 = notify(db_session, unlinked, "daily_recs", "1 recommendation")
    db_session.commit()

    assert row1.sent_telegram is True and row2.sent_telegram is False
    assert sent == [("42", "3 recommendations\n\nBUY AAPL...")]
    assert db_session.query(Notification).count() == 2


def test_telegram_linking_via_code(db_session, monkeypatch):
    user = _user(db_session)
    user.telegram_link_code = "abc123"
    db_session.commit()
    monkeypatch.setattr(notify_service, "_bot_url", lambda m: f"http://bot/{m}")

    class FakeResp:
        def json(self):
            return {"result": [{"message": {"text": "/start abc123",
                                            "chat": {"id": 777}}}]}

    monkeypatch.setattr(notify_service.httpx, "get", lambda *a, **k: FakeResp())
    monkeypatch.setattr(notify_service, "send_telegram", lambda *a: True)

    assert complete_telegram_links(db_session) == 1
    db_session.refresh(user)
    assert user.telegram_chat_id == "777"
    assert user.telegram_link_code is None


def test_topic_radar_upserts_topics(db_session):
    inst = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db_session.add(inst)
    db_session.commit()
    db_session.add(SentimentItem(instrument_id=inst.id, source="x", title="Quantum boom",
                                 sentiment=0.5, relevance=1.0,
                                 created_at=datetime.now(UTC)))
    db_session.commit()
    llm = FakeLLM({"topics.radar": {"topics": [
        {"name": "Quantum computing", "buzz": 0.9, "summary": "Qubits everywhere."},
        {"name": "Nuclear fusion", "buzz": 0.7, "summary": "Energy moonshots."}]}})

    topics = refresh_topic_radar(db_session, llm)
    assert {t.name for t in topics} == {"Quantum computing", "Nuclear fusion"}

    # Re-running updates rather than duplicates.
    refresh_topic_radar(db_session, llm)
    assert db_session.query(Topic).count() == 2


def test_deep_dive_validates_and_drops_hallucinated_tickers(db_session):
    known = Instrument(symbol="IONQ", name="IonQ", exchange=Exchange.us,
                       universe_source=UniverseSource.discovery)
    db_session.add(known)
    db_session.commit()
    llm = FakeLLM({"topics.deep_dive": {
        "summary": "Quantum hardware and software plays.",
        "candidates": [
            {"symbol": "IONQ", "name": "IonQ", "rationale": "Pure-play quantum."},
            {"symbol": "RGTI", "name": "Rigetti", "rationale": "Quantum chips."},
            {"symbol": "FAKEQ", "name": "Hallucinated Inc", "rationale": "Does not exist."},
        ]}})
    provider = FakeMarketData(real_symbols={"RGTI"})  # RGTI unknown but real

    report = run_deep_dive(db_session, llm, provider, "Quantum computing", analyze=False)

    symbols = {c["symbol"] for c in report.candidates}
    assert symbols == {"IONQ", "RGTI"}  # FAKEQ dropped
    # RGTI entered the universe tagged as topic-sourced.
    rgti = db_session.query(Instrument).filter_by(symbol="RGTI").one()
    assert rgti.universe_source == UniverseSource.topic
    assert report.summary.startswith("Quantum hardware")


def test_notifications_api_flow(client, auth_headers, db_session):
    me = client.get("/api/v1/me", headers=auth_headers).json()
    user = db_session.get(User, me["id"])
    notify(db_session, user, "scan_done", "Scan finished", "120 instruments")
    db_session.commit()

    rows = client.get("/api/v1/notifications", headers=auth_headers).json()
    assert rows[0]["title"] == "Scan finished" and rows[0]["read"] is False

    assert client.post(f"/api/v1/notifications/{rows[0]['id']}/read",
                       headers=auth_headers).status_code == 204
    rows = client.get("/api/v1/notifications", headers=auth_headers).json()
    assert rows[0]["read"] is True


def test_telegram_link_endpoint_returns_code(client, auth_headers):
    resp = client.post("/api/v1/me/telegram-link", headers=auth_headers).json()
    assert len(resp["code"]) == 8
    assert resp["code"] in resp["instructions"]


def test_deep_dive_endpoint_503_without_llm(client, auth_headers):
    resp = client.post("/api/v1/topics/deep-dive", headers=auth_headers,
                       json={"topic": "Nuclear fusion"})
    assert resp.status_code == 503  # NullLLMProvider in tests (no GROQ key)


def test_hot_topics_endpoint_lists_by_buzz(client, auth_headers, db_session):
    db_session.add_all([Topic(name="A", buzz_score=0.3), Topic(name="B", buzz_score=0.9)])
    db_session.commit()
    rows = client.get("/api/v1/topics/hot", headers=auth_headers).json()
    assert [r["name"] for r in rows] == ["B", "A"]
