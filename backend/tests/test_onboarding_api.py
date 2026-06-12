# test_onboarding_api.py — tests for the onboarding-status endpoint that drives
# the first-login setup wizard.

from datetime import date

from sqlalchemy import select

from app.models.analysis import StockScore
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.strategy import PortfolioModel, Recommendation
from app.models.user import User

URL = "/api/v1/onboarding/status"


def test_status_requires_auth(client):
    assert client.get(URL).status_code == 401


def test_fresh_install_reports_nothing_done(client, auth_headers):
    body = client.get(URL, headers=auth_headers).json()
    assert body == {
        "universe_loaded": False, "instrument_count": 0, "prices_loaded": False,
        "scores_ready": False, "has_portfolio": False,
        "has_recommendations": False, "complete": False,
    }


def test_steps_flip_as_data_appears(client, auth_headers, db_session):
    inst = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db_session.add(inst)
    db_session.commit()
    body = client.get(URL, headers=auth_headers).json()
    assert body["universe_loaded"] is True
    assert body["instrument_count"] == 1
    assert body["complete"] is False

    db_session.add(PriceBar(instrument_id=inst.id, date=date(2026, 6, 10),
                            open=100, high=101, low=99, close=100.5, volume=1e6))
    db_session.add(StockScore(instrument_id=inst.id, date=date(2026, 6, 10),
                              technical_score=70.0, combined_score=70.0, rank=1))
    db_session.commit()
    body = client.get(URL, headers=auth_headers).json()
    assert body["prices_loaded"] is True
    assert body["scores_ready"] is True
    assert body["has_portfolio"] is False


def test_complete_when_user_has_portfolio_and_recommendation(
        client, auth_headers, db_session):
    inst = Instrument(symbol="AAPL", name="Apple", exchange=Exchange.us,
                      universe_source=UniverseSource.sp500)
    db_session.add(inst)
    db_session.commit()
    db_session.add(PriceBar(instrument_id=inst.id, date=date(2026, 6, 10),
                            open=100, high=101, low=99, close=100.5, volume=1e6))
    db_session.add(StockScore(instrument_id=inst.id, date=date(2026, 6, 10),
                              technical_score=70.0, combined_score=70.0, rank=1))
    user = db_session.scalar(select(User).where(User.email == "trader@example.com"))
    portfolio = PortfolioModel(user_id=user.id, name="Main",
                               initial_capital=100000, cash=100000)
    db_session.add(portfolio)
    db_session.commit()
    body = client.get(URL, headers=auth_headers).json()
    assert body["has_portfolio"] is True
    assert body["complete"] is False  # no recommendations yet

    db_session.add(Recommendation(portfolio_id=portfolio.id, instrument_id=inst.id,
                                  action="BUY", kind="initial"))
    db_session.commit()
    body = client.get(URL, headers=auth_headers).json()
    assert body["has_recommendations"] is True
    assert body["complete"] is True


def test_other_users_portfolios_do_not_count(client, auth_headers, db_session):
    other = User(email="other@example.com", password_hash="h")
    db_session.add(other)
    db_session.commit()
    db_session.add(PortfolioModel(user_id=other.id, name="Theirs",
                                  initial_capital=1000, cash=1000))
    db_session.commit()
    body = client.get(URL, headers=auth_headers).json()
    assert body["has_portfolio"] is False
