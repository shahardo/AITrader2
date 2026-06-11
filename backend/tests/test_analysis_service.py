# test_analysis_service.py — tests for the analysis orchestrator: snapshot
# persistence, blending with/without sentiment, ranking, and the API endpoints.

from datetime import date, timedelta

import numpy as np

from app.analysis.service import blend_and_store, run_analysis
from app.llm.provider import NullLLMProvider
from app.models.analysis import IndicatorSnapshot, StockScore
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar


def _seed_instrument(db, symbol, drift, n=260):
    """Create an instrument with n synthetic bars following the given drift."""
    inst = Instrument(symbol=symbol, name=symbol, exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db.add(inst)
    db.commit()
    db.refresh(inst)
    rng = np.random.default_rng(7)
    closes = 100 * np.exp(np.linspace(0, drift, n) + rng.normal(0, 0.004, n).cumsum())
    start = date(2025, 6, 1)
    for i, c in enumerate(closes):
        db.add(PriceBar(instrument_id=inst.id, date=start + timedelta(days=i),
                        open=c, high=c * 1.01, low=c * 0.99, close=c, volume=1e6))
    db.commit()
    return inst


def test_run_analysis_persists_snapshots_and_ranks(db_session):
    up = _seed_instrument(db_session, "UPUP", drift=0.4)
    down = _seed_instrument(db_session, "DOWN", drift=-0.4)
    as_of = date(2026, 6, 10)

    scores = run_analysis(db_session, NullLLMProvider(), [], [up, down],
                          as_of=as_of, with_sentiment=False)

    assert set(scores) == {"UPUP", "DOWN"}
    assert scores["UPUP"] > scores["DOWN"]
    snaps = db_session.query(IndicatorSnapshot).all()
    assert {s.instrument_id for s in snaps} == {up.id, down.id}
    ranked = {s.instrument_id: s.rank for s in db_session.query(StockScore).all()}
    assert ranked[up.id] == 1 and ranked[down.id] == 2


def test_run_analysis_skips_thin_history(db_session):
    thin = _seed_instrument(db_session, "THIN", drift=0.1, n=20)
    scores = run_analysis(db_session, NullLLMProvider(), [], [thin], with_sentiment=False)
    assert scores == {}


def test_run_analysis_is_idempotent_per_day(db_session):
    inst = _seed_instrument(db_session, "UPUP", drift=0.3)
    as_of = date(2026, 6, 10)
    run_analysis(db_session, NullLLMProvider(), [], [inst], as_of=as_of, with_sentiment=False)
    run_analysis(db_session, NullLLMProvider(), [], [inst], as_of=as_of, with_sentiment=False)
    assert db_session.query(IndicatorSnapshot).count() == 1
    assert db_session.query(StockScore).count() == 1


def test_blend_uses_confidence_weighting(db_session):
    inst = _seed_instrument(db_session, "BLND", drift=0.2, n=70)
    as_of = date(2026, 6, 10)
    # technical 60, very bullish sentiment (1.0 -> scaled 100) at full confidence:
    # 0.6*60 + 0.4*100 = 76
    combined = blend_and_store(db_session, inst, as_of, 60.0, (1.0, 1.0))
    assert combined == 76.0
    # zero confidence -> sentiment ignored
    combined = blend_and_store(db_session, inst, as_of, 60.0, (1.0, 0.0))
    assert combined == 60.0
    # no sentiment at all -> technical only, sentiment_score stays NULL
    combined = blend_and_store(db_session, inst, as_of, 60.0, None)
    assert combined == 60.0
    row = db_session.query(StockScore).filter_by(instrument_id=inst.id).one()
    assert row.sentiment_score is None


def test_scores_endpoint_and_analysis_endpoints(client, auth_headers, db_session):
    inst = _seed_instrument(db_session, "UPUP", drift=0.4)
    run_analysis(db_session, NullLLMProvider(), [], [inst],
                 as_of=date(2026, 6, 10), with_sentiment=False)

    rows = client.get("/api/v1/scores/latest", headers=auth_headers).json()
    assert rows[0]["symbol"] == "UPUP" and rows[0]["rank"] == 1

    snap = client.get("/api/v1/instruments/UPUP/analysis", headers=auth_headers)
    assert snap.status_code == 200
    assert "sma_cross" in snap.json()["signals"]
    assert snap.json()["extras"]["trend_channel"] is not None

    missing = client.get("/api/v1/instruments/UPUP/sentiment", headers=auth_headers)
    assert missing.status_code == 404  # no sentiment rows yet


def test_run_endpoint_technical_only(client, auth_headers, db_session):
    _seed_instrument(db_session, "UPUP", drift=0.4)
    resp = client.post("/api/v1/analysis/run", headers=auth_headers,
                       json={"symbols": ["upup"], "with_sentiment": False})
    assert resp.status_code == 200
    body = resp.json()
    assert body["analyzed"] == 1 and "UPUP" in body["scores"]
