# test_instruments_api.py — API tests for the universe browser list and detail endpoints.

from datetime import date

from sqlalchemy import select

from app.marketdata.yfinance_provider import YFinanceProvider
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar


def _seed(db):
    aapl = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                      universe_source=UniverseSource.sp500, sector="Tech")
    teva = Instrument(symbol="TEVA.TA", name="Teva", exchange=Exchange.tase,
                      universe_source=UniverseSource.ta125, currency="ILA")
    db.add_all([aapl, teva])
    db.commit()
    for i, day in enumerate([date(2026, 6, 8), date(2026, 6, 9), date(2026, 6, 10)]):
        db.add(PriceBar(instrument_id=aapl.id, date=day, open=100 + i, high=101 + i,
                        low=99 + i, close=100.5 + i, volume=1e6))
    db.commit()


def test_list_requires_auth(client):
    assert client.get("/api/v1/instruments").status_code == 401


def test_list_with_price_summary(client, auth_headers, db_session):
    _seed(db_session)
    resp = client.get("/api/v1/instruments", headers=auth_headers)
    assert resp.status_code == 200
    rows = {r["symbol"]: r for r in resp.json()}
    assert rows["AAPL"]["last_close"] == 102.5
    assert rows["AAPL"]["last_date"] == "2026-06-10"
    assert rows["AAPL"]["bar_count"] == 3
    assert rows["TEVA.TA"]["last_close"] is None


def test_list_filters_by_exchange_and_search(client, auth_headers, db_session):
    _seed(db_session)
    resp = client.get("/api/v1/instruments?exchange=tase", headers=auth_headers)
    assert [r["symbol"] for r in resp.json()] == ["TEVA.TA"]
    resp = client.get("/api/v1/instruments?search=apple", headers=auth_headers)
    assert [r["symbol"] for r in resp.json()] == ["AAPL"]


def test_detail_returns_ascending_bars(client, auth_headers, db_session):
    _seed(db_session)
    resp = client.get("/api/v1/instruments/aapl?days=2", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert [b["date"] for b in body["bars"]] == ["2026-06-09", "2026-06-10"]
    assert body["last_close"] == 102.5


def test_detail_404_for_unknown_symbol(client, auth_headers):
    assert client.get("/api/v1/instruments/NOPE", headers=auth_headers).status_code == 404


def test_detail_lazily_fetches_and_caches_company_profile(
    client, auth_headers, db_session, monkeypatch
):
    _seed(db_session)
    calls = []

    def fake_fetch(self, symbol):
        calls.append(symbol)
        return {"website": "https://www.apple.com", "description": "Apple makes phones."}

    monkeypatch.setattr(YFinanceProvider, "fetch_company_profile", fake_fetch)

    resp = client.get("/api/v1/instruments/aapl", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["website"] == "https://www.apple.com"
    assert body["description"] == "Apple makes phones."
    assert calls == ["AAPL"]

    inst = db_session.scalar(select(Instrument).where(Instrument.symbol == "AAPL"))
    assert inst.profile_fetched_at is not None

    resp2 = client.get("/api/v1/instruments/aapl", headers=auth_headers)
    assert resp2.json()["website"] == "https://www.apple.com"
    assert calls == ["AAPL"]  # not re-fetched
