# yfinance_provider.py — free Yahoo Finance implementation of MarketDataProvider.
# Downloads in batches with retry/backoff to survive rate limits and flaky symbols.

import logging
import time
from datetime import date, timedelta

import pandas as pd
import yfinance as yf

from app.marketdata.provider import Bar, MarketDataProvider

logger = logging.getLogger(__name__)


class YFinanceProvider(MarketDataProvider):
    """MarketDataProvider backed by the unofficial Yahoo Finance API.

    Attributes:
        batch_size: Symbols per yf.download call.
        max_retries: Retry attempts per batch on transient failures.
        backoff_seconds: Base delay for exponential backoff between retries.
    """

    def __init__(self, batch_size: int = 50, max_retries: int = 3, backoff_seconds: float = 2.0):
        """Initialize the provider.

        Args:
            batch_size: Symbols per download request.
            max_retries: Attempts per batch before giving up on it.
            backoff_seconds: Base for exponential backoff (2s, 4s, 8s...).
        """
        self.batch_size = batch_size
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds

    def fetch_daily_bars(
        self, symbols: list[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        """Fetch daily bars for all symbols, batching and retrying as needed.

        Args:
            symbols: Yahoo-format symbols (e.g. "AAPL", "TEVA.TA").
            start: First date (inclusive).
            end: Last date (inclusive).

        Returns:
            dict[str, list[Bar]]: Bars per symbol; failed/empty symbols map to [].
        """
        result: dict[str, list[Bar]] = {s: [] for s in symbols}
        for i in range(0, len(symbols), self.batch_size):
            batch = symbols[i : i + self.batch_size]
            frame = self._download_batch(batch, start, end)
            if frame is None or frame.empty:
                continue
            for symbol in batch:
                result[symbol] = self._extract_symbol_bars(frame, symbol, len(batch) > 1)
        return result

    def _download_batch(self, batch: list[str], start: date, end: date) -> pd.DataFrame | None:
        """Download one batch with retry/backoff.

        Args:
            batch: Symbols in this request.
            start: First date (inclusive).
            end: Last date (inclusive); yfinance's `end` is exclusive so one day is added.

        Returns:
            pd.DataFrame | None: Raw multi-symbol frame, or None if all retries failed.
        """
        for attempt in range(self.max_retries):
            try:
                frame = yf.download(
                    tickers=" ".join(batch),
                    start=start.isoformat(),
                    end=(end + timedelta(days=1)).isoformat(),
                    interval="1d",
                    group_by="ticker",
                    auto_adjust=True,
                    threads=False,
                    progress=False,
                )
                return frame
            except Exception:  # noqa: BLE001 — provider must degrade, not crash the pipeline
                wait = self.backoff_seconds * (2**attempt)
                logger.warning(
                    "yfinance batch failed (attempt %d/%d), retrying in %.0fs",
                    attempt + 1,
                    self.max_retries,
                    wait,
                )
                time.sleep(wait)
        logger.error("yfinance batch permanently failed: %s", batch)
        return None

    @staticmethod
    def _extract_symbol_bars(frame: pd.DataFrame, symbol: str, multi: bool) -> list[Bar]:
        """Convert one symbol's slice of a yfinance frame into Bar objects.

        Args:
            frame: Frame returned by yf.download.
            symbol: Symbol to extract.
            multi: Whether the frame has a per-ticker column level.

        Returns:
            list[Bar]: Ascending, NaN rows dropped; [] if the symbol is absent.
        """
        try:
            sub = frame[symbol] if multi else frame
        except KeyError:
            return []
        sub = sub.dropna(subset=["Open", "High", "Low", "Close"])
        bars: list[Bar] = []
        for idx, row in sub.iterrows():
            bars.append(
                Bar(
                    symbol=symbol,
                    date=idx.date(),
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row.get("Volume", 0.0) or 0.0),
                )
            )
        bars.sort(key=lambda b: b.date)
        return bars
