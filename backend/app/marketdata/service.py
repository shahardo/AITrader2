# service.py — syncs provider bars into the local price_bars cache: fetches only
# missing date ranges per instrument and upserts idempotently.

import logging
from collections.abc import Callable
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.marketdata.provider import MarketDataProvider
from app.models.instrument import Instrument
from app.models.price_bar import PriceBar

logger = logging.getLogger(__name__)

DEFAULT_HISTORY_DAYS = 730  # PRD FR-2: at least two years of history per symbol


def sync_price_history(
    db: Session,
    provider: MarketDataProvider,
    instruments: list[Instrument],
    history_days: int = DEFAULT_HISTORY_DAYS,
    today: date | None = None,
    on_progress: Callable[[dict], None] | None = None,
) -> dict[str, int]:
    """Bring the price_bars cache up to date for the given instruments.

    For each instrument, fetches from the day after its newest cached bar (or
    `history_days` back if uncached) through today, and inserts only new dates.

    Args:
        db: Database session (committed once at the end).
        provider: Market data backend to fetch from.
        instruments: Instruments to sync.
        history_days: Backfill window for instruments with no cached bars.
        today: Override for "today" (used by tests); defaults to date.today().
        on_progress: Optional callback invoked with a status payload as each
            instrument's bars are synced.

    Returns:
        dict[str, int]: Number of bars inserted per symbol.
    """
    today = today or date.today()
    default_start = today - timedelta(days=history_days)

    latest: dict[int, date] = dict(
        db.execute(
            select(PriceBar.instrument_id, func.max(PriceBar.date))
            .where(PriceBar.instrument_id.in_([i.id for i in instruments]))
            .group_by(PriceBar.instrument_id)
        ).all()
    )

    by_start: dict[date, list[Instrument]] = {}
    for inst in instruments:
        last = latest.get(inst.id)
        start = (last + timedelta(days=1)) if last else default_start
        if start > today:
            continue
        by_start.setdefault(start, []).append(inst)

    inserted: dict[str, int] = {}
    total = sum(len(group) for group in by_start.values())
    processed = 0
    for start, group in by_start.items():
        symbol_map = {i.symbol: i for i in group}
        fetched = provider.fetch_daily_bars(list(symbol_map), start, today)
        for symbol, bars in fetched.items():
            processed += 1
            if on_progress:
                on_progress({"stage": "syncing_prices", "symbol": symbol,
                             "current": processed, "total": total})
            inst = symbol_map[symbol]
            count = 0
            for bar in bars:
                if bar.date < start:
                    continue
                db.add(
                    PriceBar(
                        instrument_id=inst.id,
                        date=bar.date,
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                        volume=bar.volume,
                    )
                )
                count += 1
            if count:
                inserted[symbol] = count
    db.commit()
    logger.info("Synced %d instruments, %d bars", len(inserted), sum(inserted.values()))
    return inserted
