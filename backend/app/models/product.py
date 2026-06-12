# product.py — product-surface ORM models (Milestone 4): hot topics, deep-dive
# reports, the in-app notification feed, and scan run records.

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Topic(Base):
    """One investment theme on the radar (e.g. quantum computing)."""

    __tablename__ = "topics"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    buzz_score: Mapped[float] = mapped_column(default=0.0)  # 0..1 from the radar
    status: Mapped[str] = mapped_column(String(20), default="hot")  # hot|user_requested
    summary: Mapped[str] = mapped_column(String(2000), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class TopicReport(Base):
    """One deep-dive report: theme summary + ranked validated candidates."""

    __tablename__ = "topic_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    topic_id: Mapped[int] = mapped_column(ForeignKey("topics.id", ondelete="CASCADE"), index=True)
    requested_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    summary: Mapped[str] = mapped_column(String(4000), default="")
    candidates: Mapped[list] = mapped_column(JSON, default=list)
    # candidates: [{symbol, name, rationale, combined_score, validated}]
    status: Mapped[str] = mapped_column(String(20), default="done")  # done|failed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Notification(Base):
    """One in-app notification (mirrored to Telegram when linked)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    # daily_recs|trade_executed|strategy_change|scan_done|deep_dive_done
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(String(2000), default="")
    read: Mapped[bool] = mapped_column(default=False)
    sent_telegram: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Scan(Base):
    """One universe scan run (constituents refresh + discovery layer)."""

    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    triggered_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|done|failed
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
