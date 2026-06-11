# validate_tase_coverage.py — Milestone 1 go/no-go check (PRD risk: "TASE data gaps
# on Yahoo"): tries to fetch recent history for every bundled TA-125 symbol and
# reports coverage. Note: the bundled ta125.csv is a partial seed snapshot; this
# script is how we verify and prune it. Usage: python -m scripts.validate_tase_coverage

import logging
from datetime import date, timedelta

from app.marketdata.yfinance_provider import YFinanceProvider
from app.universe.constituents import fetch_ta125


def main() -> None:
    """Fetch 30 days of bars per TA-125 seed symbol and print a coverage report."""
    logging.basicConfig(level=logging.WARNING)
    entries = fetch_ta125()
    symbols = [e.symbol for e in entries]
    provider = YFinanceProvider(batch_size=25)
    end = date.today()
    bars = provider.fetch_daily_bars(symbols, end - timedelta(days=30), end)

    covered = sorted(s for s, b in bars.items() if len(b) >= 5)
    missing = sorted(s for s, b in bars.items() if len(b) < 5)
    pct = 100.0 * len(covered) / len(symbols) if symbols else 0.0
    print(f"TASE coverage: {len(covered)}/{len(symbols)} symbols usable ({pct:.0f}%)")
    if missing:
        print("Missing or thin data:")
        for s in missing:
            print(f"  - {s}")
    print("\nGo/no-go guidance: >=80% usable -> proceed with full TASE scope;")
    print("otherwise reduce the TASE universe to the covered symbols (PRD section 9).")


if __name__ == "__main__":
    main()
