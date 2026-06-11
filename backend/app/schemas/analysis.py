# analysis.py — Pydantic schemas for score leaderboards, indicator snapshots,
# sentiment drill-down, and the manual analysis trigger.

from datetime import date, datetime

from pydantic import BaseModel, Field


class ScoreRow(BaseModel):
    """One leaderboard row: instrument identity + latest scores."""

    symbol: str
    name: str
    exchange: str
    date: date
    technical_score: float
    sentiment_score: float | None
    combined_score: float
    rank: int | None

    model_config = {"from_attributes": True}


class SnapshotOut(BaseModel):
    """Latest indicator snapshot for the stock-detail page."""

    date: date
    technical_score: float
    signals: dict
    extras: dict

    model_config = {"from_attributes": True}


class SentimentItemOut(BaseModel):
    """One scored media item for the sentiment drill-down."""

    source: str
    title: str
    url: str
    published_at: datetime | None
    sentiment: float
    relevance: float
    summary: str

    model_config = {"from_attributes": True}


class SentimentOut(BaseModel):
    """Composite sentiment + contributing items."""

    date: date
    score: float
    confidence: float
    item_count: int
    items: list[SentimentItemOut] = []


class AnalysisRunRequest(BaseModel):
    """Manual analysis trigger parameters."""

    symbols: list[str] | None = None  # None = whole active universe
    with_sentiment: bool = True
    limit: int = Field(default=0, ge=0, le=2000)  # 0 = no cap


class AnalysisRunResult(BaseModel):
    """Outcome of a manual analysis run."""

    analyzed: int
    scores: dict[str, float]
