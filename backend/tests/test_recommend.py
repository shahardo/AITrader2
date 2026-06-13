# test_recommend.py — tests for the recommendation engine: initial proposal,
# daily SELL/BUY generation under a strategy, auto-execution, approve/reject API,
# and LLM fallback explanations.

from datetime import date, timedelta

import numpy as np

from app.analysis.service import run_analysis
from app.llm.provider import NullLLMProvider
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.strategy import Holding, PortfolioModel, TradeModel
from app.models.user import User
from app.recommend.engine import generate_daily_recommendations, propose_initial_portfolio
from app.strategy.evaluator import ensure_strategy_rows


def _seed_scored_universe(db, specs):
    """Create instruments with synthetic history and run technical-only analysis.

    Args:
        specs: list of (symbol, drift) pairs.
    """
    instruments = []
    start = date.today() - timedelta(days=400)
    rng = np.random.default_rng(5)
    for symbol, drift in specs:
        inst = Instrument(symbol=symbol, name=symbol, exchange=Exchange.us,
                          universe_source=UniverseSource.sp500)
        db.add(inst)
        db.commit()
        db.refresh(inst)
        closes = 100 * np.exp(np.linspace(0, drift, 400) +
                              rng.normal(0, 0.004, 400).cumsum())
        for i, c in enumerate(closes):
            db.add(PriceBar(instrument_id=inst.id, date=start + timedelta(days=i),
                            open=c, high=c * 1.01, low=c * 0.99, close=c, volume=1e6))
        db.commit()
        instruments.append(inst)
    run_analysis(db, NullLLMProvider(), [], instruments, with_sentiment=False)
    return instruments


def _user_portfolio(db, auto=False, capital=100_000.0, strategy_id=None):
    user = User(email=f"u{auto}@x.com", password_hash="h")
    db.add(user)
    db.commit()
    portfolio = PortfolioModel(user_id=user.id, name="P", initial_capital=capital,
                               cash=capital, auto_execute=auto, strategy_id=strategy_id)
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return user, portfolio


def test_initial_proposal_creates_pending_buys_with_fallback_text(db_session):
    _seed_scored_universe(db_session, [("UP1", 0.5), ("UP2", 0.4), ("DN1", -0.3)])
    user, portfolio = _user_portfolio(db_session)

    recs = propose_initial_portfolio(db_session, NullLLMProvider(), user, portfolio)

    assert len(recs) >= 2
    assert all(r.action == "BUY" and r.status == "pending" and r.kind == "initial"
               for r in recs)
    assert all(r.qty >= 1 and r.explanation for r in recs)
    # No trades executed before approval.
    assert db_session.query(TradeModel).count() == 0


def test_daily_recs_buy_under_momentum_and_auto_execute(db_session):
    # Strong drifts so 63-day momentum clearly exceeds the entry threshold.
    _seed_scored_universe(db_session, [("UP1", 1.2), ("UP2", 1.0)])
    strategies = ensure_strategy_rows(db_session)
    user, portfolio = _user_portfolio(db_session, auto=True,
                                      strategy_id=strategies["momentum"].id)

    recs = generate_daily_recommendations(db_session, NullLLMProvider(), user, portfolio)

    buys = [r for r in recs if r.action == "BUY"]
    assert buys, "momentum should buy strong uptrends"
    assert all(r.status == "executed" for r in buys)  # auto_execute
    assert db_session.query(TradeModel).count() == len(buys)
    assert db_session.query(Holding).count() == len(buys)
    assert portfolio.cash < 100_000


def test_daily_recs_sell_held_downtrend(db_session):
    insts = _seed_scored_universe(db_session, [("DN1", -0.6)])
    strategies = ensure_strategy_rows(db_session)
    user, portfolio = _user_portfolio(db_session, strategy_id=strategies["momentum"].id)
    db_session.add(Holding(portfolio_id=portfolio.id, instrument_id=insts[0].id,
                           qty=10, avg_cost=150))
    db_session.commit()

    recs = generate_daily_recommendations(db_session, NullLLMProvider(), user, portfolio)

    sells = [r for r in recs if r.action == "SELL"]
    assert len(sells) == 1 and sells[0].qty == 10
    assert sells[0].status == "pending"  # not auto-execute


def test_recommendation_approve_executes_trade(client, auth_headers, db_session):
    _seed_scored_universe(db_session, [("UP1", 0.6)])
    portfolio = client.post("/api/v1/portfolios", headers=auth_headers,
                            json={"name": "P", "initial_capital": 100_000}).json()
    proposal = client.post(f"/api/v1/portfolios/{portfolio['id']}/initial-proposal",
                           headers=auth_headers).json()
    assert proposal and proposal[0]["status"] == "pending"

    rec_id = proposal[0]["id"]
    approved = client.post(f"/api/v1/recommendations/{rec_id}/approve",
                           headers=auth_headers).json()
    assert approved["status"] == "executed"
    detail = client.get(f"/api/v1/portfolios/{portfolio['id']}", headers=auth_headers).json()
    assert detail["holdings"], "approval should open the position"

    # Re-approving is a conflict.
    assert client.post(f"/api/v1/recommendations/{rec_id}/approve",
                       headers=auth_headers).status_code == 409


def test_recommendation_reject(client, auth_headers, db_session):
    _seed_scored_universe(db_session, [("UP1", 0.5)])
    portfolio = client.post("/api/v1/portfolios", headers=auth_headers,
                            json={"name": "P", "initial_capital": 50_000}).json()
    proposal = client.post(f"/api/v1/portfolios/{portfolio['id']}/initial-proposal",
                           headers=auth_headers).json()
    rec_id = proposal[0]["id"]
    rejected = client.post(f"/api/v1/recommendations/{rec_id}/reject",
                           headers=auth_headers).json()
    assert rejected["status"] == "rejected"
    detail = client.get(f"/api/v1/portfolios/{portfolio['id']}", headers=auth_headers).json()
    assert detail["holdings"] == []


def test_initial_proposal_without_scores_conflicts(client, auth_headers):
    portfolio = client.post("/api/v1/portfolios", headers=auth_headers,
                            json={"name": "P", "initial_capital": 50_000}).json()
    resp = client.post(f"/api/v1/portfolios/{portfolio['id']}/initial-proposal",
                       headers=auth_headers)
    assert resp.status_code == 409


def test_generate_recommendations_without_strategy_conflicts(client, auth_headers):
    portfolio = client.post("/api/v1/portfolios", headers=auth_headers,
                            json={"name": "P", "initial_capital": 50_000}).json()
    resp = client.post(f"/api/v1/portfolios/{portfolio['id']}/recommendations/generate",
                       headers=auth_headers)
    assert resp.status_code == 409


def test_strategies_api_and_evaluate(client, auth_headers, db_session):
    _seed_scored_universe(db_session, [("UP1", 0.5), ("DN1", -0.4)])
    rows = client.get("/api/v1/strategies", headers=auth_headers).json()
    assert {r["kind"] for r in rows} == {"momentum", "mean_reversion",
                                         "trend_following", "balanced", "evolved"}
    runs = client.post("/api/v1/strategies/evaluate", headers=auth_headers,
                       json={"max_symbols": 5}).json()
    assert len(runs) == 5
    run = runs[0]
    assert run["train_metrics"] and run["test_metrics"]

    trades = client.get(f"/api/v1/strategy-runs/{run['id']}/trades",
                        headers=auth_headers).json()
    assert isinstance(trades, list)  # may be empty for some strategies
