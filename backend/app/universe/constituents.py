# constituents.py — fetches index constituent lists for the base scan universe:
# S&P 500 and Nasdaq-100 live from Wikipedia (with bundled fallback files), and
# TA-125 from a bundled seed list (no reliable free live source exists).

import csv
import logging
from dataclasses import dataclass
from io import StringIO
from pathlib import Path

import httpx
import pandas as pd

from app.models.instrument import Exchange, UniverseSource

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
WIKI_SP500 = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
WIKI_NASDAQ100 = "https://en.wikipedia.org/wiki/Nasdaq-100"


@dataclass(frozen=True)
class ConstituentEntry:
    """One index member, normalized to Yahoo symbol format."""

    symbol: str
    name: str
    sector: str | None
    exchange: Exchange
    currency: str
    universe_source: UniverseSource


def normalize_us_symbol(symbol: str) -> str:
    """Convert a US symbol to Yahoo format (class shares use '-' not '.').

    Args:
        symbol: Raw symbol, e.g. "BRK.B".

    Returns:
        str: Yahoo-format symbol, e.g. "BRK-B".
    """
    return symbol.strip().upper().replace(".", "-")


def _read_fallback(filename: str, exchange: Exchange, source: UniverseSource,
                   currency: str) -> list[ConstituentEntry]:
    """Load a bundled CSV fallback list (columns: symbol,name,sector).

    Args:
        filename: File name inside the bundled data directory.
        exchange: Exchange to tag entries with.
        source: Universe source to tag entries with.
        currency: Trading currency code.

    Returns:
        list[ConstituentEntry]: Parsed entries.
    """
    entries: list[ConstituentEntry] = []
    with open(DATA_DIR / filename, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            entries.append(
                ConstituentEntry(
                    symbol=row["symbol"].strip(),
                    name=row["name"].strip(),
                    sector=(row.get("sector") or "").strip() or None,
                    exchange=exchange,
                    currency=currency,
                    universe_source=source,
                )
            )
    return entries


def _fetch_wikipedia_table(url: str, symbol_col: str, name_col: str,
                           sector_col: str | None) -> pd.DataFrame | None:
    """Download a Wikipedia page and return the first table with the wanted columns.

    Args:
        url: Wikipedia page URL.
        symbol_col: Column holding ticker symbols.
        name_col: Column holding company names.
        sector_col: Column holding sectors, or None if not expected.

    Returns:
        pd.DataFrame | None: Matching table, or None on any failure.
    """
    try:
        resp = httpx.get(url, timeout=30, headers={"User-Agent": "AITrader2/0.1"},
                         follow_redirects=True)
        resp.raise_for_status()
        tables = pd.read_html(StringIO(resp.text))
    except Exception:  # noqa: BLE001 — fall back to bundled lists on any failure
        logger.warning("Failed to fetch/parse %s; using bundled fallback", url)
        return None
    wanted = {symbol_col, name_col} | ({sector_col} if sector_col else set())
    for table in tables:
        if wanted.issubset(set(map(str, table.columns))):
            return table
    logger.warning("No table with columns %s found at %s", wanted, url)
    return None


def fetch_sp500() -> list[ConstituentEntry]:
    """Return current S&P 500 constituents (live from Wikipedia, else fallback).

    Returns:
        list[ConstituentEntry]: S&P 500 members in Yahoo symbol format.
    """
    table = _fetch_wikipedia_table(WIKI_SP500, "Symbol", "Security", "GICS Sector")
    if table is None:
        return _read_fallback("sp500_fallback.csv", Exchange.us, UniverseSource.sp500, "USD")
    return [
        ConstituentEntry(
            symbol=normalize_us_symbol(str(row["Symbol"])),
            name=str(row["Security"]),
            sector=str(row["GICS Sector"]),
            exchange=Exchange.us,
            currency="USD",
            universe_source=UniverseSource.sp500,
        )
        for _, row in table.iterrows()
    ]


def fetch_nasdaq100() -> list[ConstituentEntry]:
    """Return current Nasdaq-100 constituents (live from Wikipedia, else fallback).

    Returns:
        list[ConstituentEntry]: Nasdaq-100 members in Yahoo symbol format.
    """
    table = _fetch_wikipedia_table(WIKI_NASDAQ100, "Ticker", "Company", "GICS Sector")
    if table is None:
        return _read_fallback(
            "nasdaq100_fallback.csv", Exchange.us, UniverseSource.nasdaq100, "USD"
        )
    return [
        ConstituentEntry(
            symbol=normalize_us_symbol(str(row["Ticker"])),
            name=str(row["Company"]),
            sector=str(row["GICS Sector"]),
            exchange=Exchange.us,
            currency="USD",
            universe_source=UniverseSource.nasdaq100,
        )
        for _, row in table.iterrows()
    ]


def fetch_ta125() -> list[ConstituentEntry]:
    """Return TA-125 constituents from the bundled seed list.

    The seed list is a maintained snapshot (see data/ta125.csv header); the
    TASE coverage validation script verifies each symbol against Yahoo.

    Returns:
        list[ConstituentEntry]: TASE members with ".TA" Yahoo suffixes.
    """
    return _read_fallback("ta125.csv", Exchange.tase, UniverseSource.ta125, "ILA")


def fetch_base_universe() -> list[ConstituentEntry]:
    """Return the merged base universe (S&P 500 + Nasdaq-100 + TA-125), deduplicated.

    When a symbol appears in both US indices, the S&P 500 entry wins.

    Returns:
        list[ConstituentEntry]: Deduplicated union of the three indices.
    """
    merged: dict[str, ConstituentEntry] = {}
    for entry in fetch_nasdaq100() + fetch_sp500() + fetch_ta125():
        merged[entry.symbol] = entry
    return list(merged.values())
