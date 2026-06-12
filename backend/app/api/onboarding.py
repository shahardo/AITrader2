# onboarding.py — first-login setup status: tells the frontend wizard which
# steps (universe load, first analysis, portfolio, recommendations) remain.

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.analysis import StockScore
from app.models.instrument import Instrument
from app.models.price_bar import PriceBar
from app.models.strategy import PortfolioModel, Recommendation
from app.models.user import User

router = APIRouter(tags=["onboarding"])


class OnboardingStatus(BaseModel):
    """Setup-progress flags driving the first-login wizard."""

    universe_loaded: bool
    instrument_count: int
    prices_loaded: bool
    scores_ready: bool
    has_portfolio: bool
    has_recommendations: bool
    complete: bool


@router.get("/onboarding/status", response_model=OnboardingStatus)
def onboarding_status(db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)) -> OnboardingStatus:
    """Report which onboarding steps are already done for this user.

    Universe/price/score checks are global (shared data); portfolio and
    recommendation checks are scoped to the authenticated user.

    Args:
        db: Request-scoped database session.
        user: Authenticated user.

    Returns:
        OnboardingStatus: Per-step completion flags plus the overall flag.
    """
    instrument_count = db.scalar(
        select(func.count()).select_from(Instrument).where(Instrument.is_active.is_(True))
    ) or 0
    prices_loaded = db.scalar(select(PriceBar.id).limit(1)) is not None
    scores_ready = db.scalar(select(StockScore.id).limit(1)) is not None
    portfolio_ids = list(db.scalars(
        select(PortfolioModel.id).where(PortfolioModel.user_id == user.id)))
    has_recommendations = bool(portfolio_ids) and db.scalar(
        select(Recommendation.id)
        .where(Recommendation.portfolio_id.in_(portfolio_ids)).limit(1)) is not None
    return OnboardingStatus(
        universe_loaded=instrument_count > 0,
        instrument_count=instrument_count,
        prices_loaded=prices_loaded,
        scores_ready=scores_ready,
        has_portfolio=bool(portfolio_ids),
        has_recommendations=has_recommendations,
        complete=(instrument_count > 0 and scores_ready and bool(portfolio_ids)
                  and has_recommendations),
    )
