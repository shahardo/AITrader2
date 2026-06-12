# test_portfolio.py — tests for the paper broker (cash/holdings invariants),
# valuation, equity curve reconstruction, and the portfolios API (multi-portfolio
# CRUD, ownership isolation, comparison).

from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.strategy import Holding, PortfolioModel
from app.models.user import User
from app.portfolio.service import (
    TradeError,
    equity_curve,
    execute_paper_trade,
    portfolio_value,
)


def _user(db, email="u@x.com"):
    user = User(email=email, password_hash="h")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _portfolio(db, user, capital=10_000.0):
    p = PortfolioModel(user_id=user.id, name="P", initial_capital=capital, cash=capital)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _instrument(db, symbol="AAPL", closes=None):
    inst = Instrument(symbol=symbol, name=symbol, exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db.add(inst)
    db.commit()
    db.refresh(inst)
    for i, c in enumerate(closes or []):
        db.add(PriceBar(instrument_id=inst.id, date=date(2026, 6, 1) + timedelta(days=i),
                        open=c, high=c, low=c, close=c, volume=1e6))
    db.commit()
    return inst


def test_buy_sell_roundtrip_keeps_invariants(db_session):
    user = _user(db_session)
    portfolio = _portfolio(db_session, user)
    inst = _instrument(db_session)

    execute_paper_trade(db_session, portfolio, inst.id, "BUY", qty=10, price=100)
    assert portfolio.cash == pytest.approx(9_000)
    holding = db_session.query(Holding).one()
    assert holding.qty == 10 and holding.avg_cost == 100

    # Averaging up.
    execute_paper_trade(db_session, portfolio, inst.id, "BUY", qty=10, price=120)
    holding = db_session.query(Holding).one()
    assert holding.avg_cost == pytest.approx(110)

    execute_paper_trade(db_session, portfolio, inst.id, "SELL", qty=20, price=130)
    assert db_session.query(Holding).count() == 0  # fully closed
    assert portfolio.cash == pytest.approx(10_000 - 1000 - 1200 + 2600)


def test_overdraft_and_overselling_rejected(db_session):
    user = _user(db_session)
    portfolio = _portfolio(db_session, user, capital=500)
    inst = _instrument(db_session)
    with pytest.raises(TradeError):
        execute_paper_trade(db_session, portfolio, inst.id, "BUY", qty=10, price=100)
    with pytest.raises(TradeError):
        execute_paper_trade(db_session, portfolio, inst.id, "SELL", qty=1, price=100)


def test_portfolio_value_marks_to_market(db_session):
    user = _user(db_session)
    portfolio = _portfolio(db_session, user)
    inst = _instrument(db_session, closes=[100, 150])  # latest close 150
    execute_paper_trade(db_session, portfolio, inst.id, "BUY", qty=10, price=100)
    db_session.commit()
    assert portfolio_value(db_session, portfolio) == pytest.approx(9_000 + 10 * 150)


def test_equity_curve_replays_trades(db_session):
    user = _user(db_session)
    portfolio = _portfolio(db_session, user)
    inst = _instrument(db_session, closes=[100, 110, 120])
    trade_time = datetime(2026, 6, 1, 18, tzinfo=UTC)
    execute_paper_trade(db_session, portfolio, inst.id, "BUY", qty=10, price=100,
                        executed_at=trade_time)
    db_session.commit()
    curve = dict(equity_curve(db_session, portfolio))
    assert curve[date(2026, 6, 1)] == pytest.approx(10_000 - 1000 + 10 * 100)
    assert curve[date(2026, 6, 3)] == pytest.approx(9_000 + 10 * 120)


def test_portfolio_api_crud_and_isolation(client, auth_headers, db_session):
    created = client.post("/api/v1/portfolios", headers=auth_headers,
                          json={"name": "Growth", "initial_capital": 50_000}).json()
    client.post("/api/v1/portfolios", headers=auth_headers,
                json={"name": "Safe", "initial_capital": 20_000, "auto_execute": True})

    rows = client.get("/api/v1/portfolios", headers=auth_headers).json()
    assert [r["name"] for r in rows] == ["Growth", "Safe"]
    assert rows[0]["value"] == 50_000 and rows[0]["pnl_pct"] == 0

    # Second user cannot see or touch the first user's portfolio.
    other = client.post("/api/v1/auth/signup",
                        json={"email": "two@x.com", "password": "longenough1"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/v1/portfolios", headers=other_headers).json() == []
    resp = client.get(f"/api/v1/portfolios/{created['id']}", headers=other_headers)
    assert resp.status_code == 404

    # Update + delete.
    resp = client.patch(f"/api/v1/portfolios/{created['id']}", headers=auth_headers,
                        json={"auto_execute": True})
    assert resp.json()["auto_execute"] is True
    assert client.delete(f"/api/v1/portfolios/{created['id']}",
                         headers=auth_headers).status_code == 204


def test_portfolio_compare_endpoint(client, auth_headers):
    a = client.post("/api/v1/portfolios", headers=auth_headers,
                    json={"name": "A", "initial_capital": 10_000}).json()
    b = client.post("/api/v1/portfolios", headers=auth_headers,
                    json={"name": "B", "initial_capital": 10_000}).json()
    resp = client.get(f"/api/v1/portfolios-compare?ids={a['id']},{b['id']}",
                      headers=auth_headers)
    assert resp.status_code == 200
    assert [p["name"] for p in resp.json()] == ["A", "B"]
    assert all(len(p["curve"]) >= 1 for p in resp.json())
