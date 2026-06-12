# instrument.py — Instrument ORM model: one row per tradable stock in the scan
# universe (US or TASE), including how it entered the universe.

import enum
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Exchange(str, enum.Enum):
    """Supported exchange groups."""

    us = "us"
    tase = "tase"


class UniverseSource(str, enum.Enum):
    """How an instrument entered the scan universe."""

    sp500 = "sp500"
    nasdaq100 = "nasdaq100"
    ta125 = "ta125"
    discovery = "discovery"
    topic = "topic"


class Instrument(Base):
    """A tradable equity tracked by the platform."""

    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    exchange: Mapped[Exchange] = mapped_column(Enum(Exchange, name="exchange"))
    sector: Mapped[str | None] = mapped_column(String(100), default=None)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    universe_source: Mapped[UniverseSource] = mapped_column(
        Enum(UniverseSource, name="universe_source")
    )
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    website: Mapped[str | None] = mapped_column(String(500), default=None)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    profile_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
