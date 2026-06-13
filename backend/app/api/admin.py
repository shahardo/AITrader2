# admin.py — destructive "danger zone" endpoints for the Settings page: wipe
# all application data, optionally including every user account.

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.analysis import (
    IndicatorSnapshot,
    LLMCall,
    SentimentItem,
    SentimentScore,
    StockScore,
)
from app.models.instrument import Instrument
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

router = APIRouter(prefix="/admin", tags=["admin"])

# Ordered children-before-parents so the deletes are valid regardless of
# whether the database enforces FK constraints.
_DATA_MODELS = [
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


def _clear_data(db: Session) -> None:
    """Delete every row from all application data tables.

    User accounts are left untouched.

    Args:
        db: Request-scoped database session.
    """
    for model in _DATA_MODELS:
        db.execute(delete(model))


@router.post("/clear-data", status_code=status.HTTP_204_NO_CONTENT)
def clear_data(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Wipe all universe, score, portfolio, and strategy data for every user.

    User accounts and sessions are preserved.

    Args:
        user: The authenticated user (required for access).
        db: Request-scoped database session.

    Returns:
        Response: 204 No Content on success.
    """
    _clear_data(db)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/clear-data-and-users", status_code=status.HTTP_204_NO_CONTENT)
def clear_data_and_users(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Wipe all application data and delete every user account.

    Existing access/refresh tokens become invalid, signing everyone out.

    Args:
        user: The authenticated user (required for access).
        db: Request-scoped database session.

    Returns:
        Response: 204 No Content on success.
    """
    _clear_data(db)
    db.execute(delete(User))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
