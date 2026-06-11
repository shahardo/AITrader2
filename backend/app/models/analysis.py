# analysis.py — analysis-output ORM models: per-day indicator snapshots, sentiment
# items and composite scores, blended stock scores, and the LLM call audit log.

from datetime import UTC, datetime
from datetime import date as date_type

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class IndicatorSnapshot(Base):
    """All indicator signals + technical score for one instrument on one day."""

    __tablename__ = "indicator_snapshots"
    __table_args__ = (
        UniqueConstraint("instrument_id", "date", name="uq_indicator_snapshots_instrument_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date_type] = mapped_column(Date)
    signals: Mapped[dict] = mapped_column(JSON)  # indicator -> {signal, strength, value}
    technical_score: Mapped[float] = mapped_column(Float)
    extras: Mapped[dict] = mapped_column(JSON, default=dict)  # channel bands, S/R levels


class SentimentItem(Base):
    """One news/social item scored by the LLM for an instrument."""

    __tablename__ = "sentiment_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(50))
    url: Mapped[str] = mapped_column(String(1000), default="")
    title: Mapped[str] = mapped_column(String(500))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    sentiment: Mapped[float] = mapped_column(Float)  # -1..+1 from the LLM
    relevance: Mapped[float] = mapped_column(Float)  # 0..1 from the LLM
    summary: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class SentimentScore(Base):
    """Composite daily sentiment for one instrument (recency-decayed mean)."""

    __tablename__ = "sentiment_scores"
    __table_args__ = (
        UniqueConstraint("instrument_id", "date", name="uq_sentiment_scores_instrument_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date_type] = mapped_column(Date)
    score: Mapped[float] = mapped_column(Float)  # -1..+1
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1


class StockScore(Base):
    """Blended technical+sentiment score used for ranking the universe."""

    __tablename__ = "stock_scores"
    __table_args__ = (
        UniqueConstraint("instrument_id", "date", name="uq_stock_scores_instrument_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[date_type] = mapped_column(Date, index=True)
    technical_score: Mapped[float] = mapped_column(Float)
    sentiment_score: Mapped[float | None] = mapped_column(Float, default=None)  # -1..+1
    combined_score: Mapped[float] = mapped_column(Float)  # 0..100
    rank: Mapped[int | None] = mapped_column(Integer, default=None)


class LLMCall(Base):
    """Audit/cost log row for every LLM invocation."""

    __tablename__ = "llm_calls"

    id: Mapped[int] = mapped_column(primary_key=True)
    call_site: Mapped[str] = mapped_column(String(100), index=True)
    model: Mapped[str] = mapped_column(String(100))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
