# price_bar.py — PriceBar ORM model: one daily OHLCV bar per instrument per date.
# Acts as the local cache for provider data so analysis never re-fetches history.

from datetime import date as date_type

from sqlalchemy import Date, Float, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PriceBar(Base):
    """A single end-of-day OHLCV bar."""

    __tablename__ = "price_bars"
    __table_args__ = (
        UniqueConstraint("instrument_id", "date", name="uq_price_bars_instrument_date"),
        Index("ix_price_bars_instrument_date", "instrument_id", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    date: Mapped[date_type] = mapped_column(Date)
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0.0)
