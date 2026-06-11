# provider.py — MarketDataProvider abstract interface and the provider-neutral
# Bar dataclass. Concrete providers (yfinance now, paid feeds later) implement this.

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Bar:
    """One provider-neutral daily OHLCV bar."""

    symbol: str
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketDataProvider(ABC):
    """Interface every market-data backend must implement.

    Implementations must be safe to call for mixed US and TASE symbols and must
    return an empty list (not raise) for symbols with no available data, so a
    single bad symbol never aborts a batch sync.
    """

    @abstractmethod
    def fetch_daily_bars(
        self, symbols: list[str], start: date, end: date
    ) -> dict[str, list[Bar]]:
        """Fetch daily OHLCV history for many symbols.

        Args:
            symbols: Provider-format symbols (TASE symbols carry the ".TA" suffix).
            start: First date to include (inclusive).
            end: Last date to include (inclusive).

        Returns:
            dict[str, list[Bar]]: Bars per symbol, ascending by date. Symbols
            with no data map to an empty list.
        """
