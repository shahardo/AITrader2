# load_universe.py — CLI: load index constituents into the instruments table and
# sync price history for them. Usage:
#   python -m scripts.load_universe [--history-days 730] [--skip-prices] [--limit N]

import argparse
import logging

from app.core.db import SessionLocal
from app.marketdata.service import sync_price_history
from app.marketdata.yfinance_provider import YFinanceProvider
from app.models.instrument import Instrument
from app.universe.constituents import fetch_base_universe
from app.universe.loader import upsert_universe


def main() -> None:
    """Load the base universe and optionally backfill price history."""
    parser = argparse.ArgumentParser(description="Load universe constituents and prices")
    parser.add_argument("--history-days", type=int, default=730)
    parser.add_argument("--skip-prices", action="store_true", help="only upsert instruments")
    parser.add_argument("--limit", type=int, default=0, help="sync prices for first N only")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    db = SessionLocal()
    try:
        entries = fetch_base_universe()
        counts = upsert_universe(db, entries)
        print(f"Universe: {counts['inserted']} inserted, {counts['updated']} updated")
        if not args.skip_prices:
            instruments = list(db.query(Instrument).filter(Instrument.is_active.is_(True)))
            if args.limit:
                instruments = instruments[: args.limit]
            inserted = sync_price_history(
                db, YFinanceProvider(), instruments, history_days=args.history_days
            )
            print(f"Prices: {sum(inserted.values())} bars across {len(inserted)} symbols")
    finally:
        db.close()


if __name__ == "__main__":
    main()
