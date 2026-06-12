# models/__init__.py — imports all ORM models so Base.metadata sees every table
# (required by Alembic autogeneration and create_all in tests).

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

__all__ = [
    "Topic",
    "TopicReport",
    "Notification",
    "Scan",
    "Strategy",
    "StrategyRun",
    "BacktestTrade",
    "PortfolioModel",
    "Holding",
    "TradeModel",
    "Recommendation",
    "User",
    "Instrument",
    "PriceBar",
    "IndicatorSnapshot",
    "SentimentItem",
    "SentimentScore",
    "StockScore",
    "LLMCall",
]
