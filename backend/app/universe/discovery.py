# discovery.py — discovery layer of the scan (PRD FR-3): finds candidates beyond
# the base indices using Yahoo's predefined screeners (day gainers, most actives),
# so lesser-known names with unusual volume/momentum enter the universe.

import logging
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.instrument import Exchange, Instrument, UniverseSource

logger = logging.getLogger(__name__)

SCREENS = ("day_gainers", "most_actives", "small_cap_gainers")
MAX_PER_SCREEN = 25


def fetch_screener_symbols() -> dict[str, str]:
    """Pull candidate symbols from Yahoo's predefined screeners (best-effort).

    Returns:
        dict[str, str]: symbol -> company name; empty on any failure.
    """
    import yfinance as yf

    found: dict[str, str] = {}
    for screen in SCREENS:
        try:
            body = yf.screen(screen, count=MAX_PER_SCREEN)
            quotes = (body or {}).get("quotes", [])
        except Exception:  # noqa: BLE001 — discovery is best-effort by design
            logger.warning("Screener %s failed", screen)
            continue
        for quote in quotes:
            symbol = str(quote.get("symbol", "")).strip().upper()
            if symbol and "." not in symbol and "-" not in symbol[:1]:
                found[symbol] = str(quote.get("shortName") or quote.get("longName") or symbol)
    return found


def run_discovery(db: Session, on_progress: Callable[[dict], None] | None = None) -> int:
    """Add screener discoveries to the universe with source="discovery".

    Args:
        db: Database session (committed).
        on_progress: Optional callback invoked with a status payload as each
            screener symbol is considered.

    Returns:
        int: Number of newly added instruments.
    """
    symbols = fetch_screener_symbols()
    if not symbols:
        return 0
    existing = {s for (s,) in db.execute(select(Instrument.symbol))}
    added = 0
    total = len(symbols)
    for i, (symbol, name) in enumerate(symbols.items(), start=1):
        if on_progress:
            on_progress({"stage": "discovery", "symbol": symbol, "current": i, "total": total})
        if symbol in existing:
            continue
        db.add(Instrument(symbol=symbol, name=name[:255], exchange=Exchange.us,
                          universe_source=UniverseSource.discovery))
        added += 1
    db.commit()
    logger.info("Discovery added %d instruments", added)
    return added
