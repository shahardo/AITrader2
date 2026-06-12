# test_outcomes.py — tests for the 30-day outcome tracker and hit-rate stats.

from datetime import UTC, datetime, timedelta

from app.jobs.outcomes import fill_outcomes, hit_rate_stats
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.strategy import PortfolioModel, Recommendation
from app.models.user import User


def _setup(db):
    user = User(email="o@x.com", password_hash="h")
    db.add(user)
    db.commit()
    portfolio = PortfolioModel(user_id=user.id, name="P", initial_capital=1e5, cash=1e5)
    inst = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db.add_all([portfolio, inst])
    db.commit()
    return user, portfolio, inst


def _rec(db, portfolio, inst, action, price, created_days_ago, now):
    rec = Recommendation(portfolio_id=portfolio.id, instrument_id=inst.id, action=action,
                         qty=10, price_at_recommendation=price,
                         created_at=now - timedelta(days=created_days_ago))
    db.add(rec)
    db.commit()
    return rec


def test_fill_outcomes_computes_signed_returns(db_session):
    now = datetime(2026, 6, 10, tzinfo=UTC)
    user, portfolio, inst = _setup(db_session)
    # Price at the 30-day mark is 110.
    db_session.add(PriceBar(instrument_id=inst.id, date=(now + timedelta(days=-5)).date(),
                            open=110, high=110, low=110, close=110, volume=1e6))
    buy = _rec(db_session, portfolio, inst, "BUY", 100.0, 35, now)   # +10% move
    sell = _rec(db_session, portfolio, inst, "SELL", 100.0, 35, now)  # -10% (good call? no)
    fresh = _rec(db_session, portfolio, inst, "BUY", 100.0, 5, now)   # too recent

    updated = fill_outcomes(db_session, now=now)

    assert updated == 2
    for rec in (buy, sell, fresh):
        db_session.refresh(rec)
    assert buy.outcome_30d == 10.0     # price rose: BUY was right
    assert sell.outcome_30d == -10.0   # price rose: SELL was wrong
    assert fresh.outcome_30d is None


def test_fill_outcomes_waits_for_forward_data(db_session):
    now = datetime(2026, 6, 10, tzinfo=UTC)
    user, portfolio, inst = _setup(db_session)
    # Only a bar BEFORE the 30-day mark exists.
    db_session.add(PriceBar(instrument_id=inst.id, date=(now - timedelta(days=20)).date(),
                            open=105, high=105, low=105, close=105, volume=1e6))
    rec = _rec(db_session, portfolio, inst, "BUY", 100.0, 35, now)
    assert fill_outcomes(db_session, now=now) == 0
    db_session.refresh(rec)
    assert rec.outcome_30d is None  # retried on a later run


def test_hit_rate_stats(db_session):
    now = datetime(2026, 6, 10, tzinfo=UTC)
    user, portfolio, inst = _setup(db_session)
    for outcome in (5.0, -2.0, 8.0, None):
        rec = _rec(db_session, portfolio, inst, "BUY", 100, 40, now)
        rec.outcome_30d = outcome
    db_session.commit()

    stats = hit_rate_stats(db_session, user.id)
    assert stats["evaluated"] == 3
    assert stats["hits"] == 2
    assert stats["hit_rate"] == round(2 / 3, 3)
    assert stats["avg_return"] == round((5 - 2 + 8) / 3, 2)


def test_hit_rate_endpoint_empty(client, auth_headers):
    stats = client.get("/api/v1/stats/hit-rate", headers=auth_headers).json()
    assert stats == {"evaluated": 0, "hits": 0, "hit_rate": 0.0, "avg_return": 0.0}
