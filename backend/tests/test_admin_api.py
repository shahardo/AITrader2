# test_admin_api.py — tests for the Settings page "danger zone": wiping all
# application data, and wiping all data plus every user account.

from datetime import date

from app.models.analysis import (
    IndicatorSnapshot,
    LLMCall,
    SentimentItem,
    SentimentScore,
    StockScore,
)
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.product import Notification, Scan, Topic, TopicReport
from app.models.strategy import (
    BacktestTrade,
    Holding,
    PortfolioModel,
    Recommendation,
    Strategy,
    StrategyRun,
    TradeModel,
)
from app.models.user import User

ALL_DATA_MODELS = [
    LLMCall,
    BacktestTrade,
    TradeModel,
    Recommendation,
    Holding,
    PortfolioModel,
    StrategyRun,
    Strategy,
    Notification,
    TopicReport,
    Topic,
    Scan,
    StockScore,
    SentimentScore,
    SentimentItem,
    IndicatorSnapshot,
    PriceBar,
    Instrument,
]


def _seed_everything(db, user):
    """Create one row in every data table, plus the given user.

    Args:
        db: Database session.
        user: The owning user for user-scoped rows.

    Returns:
        None
    """
    inst = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                       universe_source=UniverseSource.sp500)
    db.add(inst)
    db.commit()
    db.refresh(inst)

    db.add(PriceBar(instrument_id=inst.id, date=date(2026, 6, 1),
                     open=1, high=1, low=1, close=1, volume=1))
    db.add(IndicatorSnapshot(instrument_id=inst.id, date=date(2026, 6, 1),
                              signals={}, technical_score=50.0, extras={}))
    db.add(SentimentItem(instrument_id=inst.id, source="yahoo", title="t",
                          sentiment=0.1, relevance=0.5))
    db.add(SentimentScore(instrument_id=inst.id, date=date(2026, 6, 1), score=0.1))
    db.add(StockScore(instrument_id=inst.id, date=date(2026, 6, 1),
                       technical_score=50.0, combined_score=50.0))
    db.add(LLMCall(call_site="test", model="fake"))

    topic = Topic(name="quantum")
    db.add(topic)
    db.commit()
    db.refresh(topic)
    db.add(TopicReport(topic_id=topic.id, requested_by=user.id))

    db.add(Notification(user_id=user.id, kind="daily_recs", title="hi"))
    db.add(Scan(triggered_by=user.id, status="done"))

    strategy = Strategy(name="momentum", kind="momentum")
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    run = StrategyRun(
        strategy_id=strategy.id, run_date=date(2026, 6, 1),
        train_start=date(2026, 1, 1), train_end=date(2026, 4, 30),
        test_start=date(2026, 5, 1), test_end=date(2026, 6, 1),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    db.add(BacktestTrade(strategy_run_id=run.id, symbol="AAPL", side="BUY",
                          date=date(2026, 6, 1), price=100, qty=1))

    portfolio = PortfolioModel(user_id=user.id, name="P", strategy_id=strategy.id,
                                initial_capital=10_000, cash=10_000)
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    db.add(Holding(portfolio_id=portfolio.id, instrument_id=inst.id, qty=1, avg_cost=100))
    rec = Recommendation(portfolio_id=portfolio.id, instrument_id=inst.id, action="BUY")
    db.add(rec)
    db.commit()
    db.refresh(rec)
    db.add(TradeModel(portfolio_id=portfolio.id, instrument_id=inst.id, side="BUY",
                       qty=1, price=100, recommendation_id=rec.id))
    db.commit()


def test_clear_data_wipes_everything_but_users(client, db_session, auth_headers):
    user = db_session.query(User).one()
    _seed_everything(db_session, user)
    for model in ALL_DATA_MODELS:
        assert db_session.query(model).count() > 0

    resp = client.post("/api/v1/admin/clear-data", headers=auth_headers)
    assert resp.status_code == 204

    for model in ALL_DATA_MODELS:
        assert db_session.query(model).count() == 0
    assert db_session.query(User).count() == 1

    # The user's session keeps working.
    resp = client.get("/api/v1/me", headers=auth_headers)
    assert resp.status_code == 200


def test_clear_data_and_users_wipes_accounts_too(client, db_session, auth_headers):
    user = db_session.query(User).one()
    _seed_everything(db_session, user)

    resp = client.post("/api/v1/admin/clear-data-and-users", headers=auth_headers)
    assert resp.status_code == 204

    for model in ALL_DATA_MODELS:
        assert db_session.query(model).count() == 0
    assert db_session.query(User).count() == 0

    # The now-deleted user's token is no longer valid.
    resp = client.get("/api/v1/me", headers=auth_headers)
    assert resp.status_code == 401
