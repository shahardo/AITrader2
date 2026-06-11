# instrument.py — Pydantic schemas for the universe browser and stock detail endpoints.

from datetime import date

from pydantic import BaseModel

from app.models.instrument import Exchange, UniverseSource


class InstrumentOut(BaseModel):
    """Universe table row: instrument identity plus latest-price summary."""

    id: int
    symbol: str
    name: str
    exchange: Exchange
    sector: str | None
    currency: str
    universe_source: UniverseSource
    last_close: float | None = None
    last_date: date | None = None
    bar_count: int = 0

    model_config = {"from_attributes": True}


class PriceBarOut(BaseModel):
    """One OHLCV bar for charting."""

    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float

    model_config = {"from_attributes": True}


class InstrumentDetail(InstrumentOut):
    """Stock detail: instrument summary plus its price history."""

    bars: list[PriceBarOut] = []
