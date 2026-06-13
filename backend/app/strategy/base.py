# base.py — strategy interface: a strategy turns a per-symbol feature frame into
# entry/exit decisions. Features are precomputed once per symbol (vectorized) so
# backtests over a year of daily bars stay fast.

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd

from app.ta import indicators as ind


@dataclass(frozen=True)
class Decision:
    """A strategy's verdict for one symbol on one day.

    Attributes:
        action: "BUY", "SELL", or "HOLD".
        score: Ranking strength for BUYs (higher = better candidate).
        reasons: Signal name -> value pairs explaining the decision
            (persisted to backtest_trades.triggering_signals).
    """

    action: str
    score: float = 0.0
    reasons: dict | None = None


def _val(features: pd.DataFrame, day: int, col: str) -> float:
    """Read one feature value, mapping NaN to 0.0.

    Args:
        features: Feature frame.
        day: Positional bar index.
        col: Column name.

    Returns:
        float: The value, or 0.0 when missing/NaN.
    """
    v = features[col].iloc[day]
    return 0.0 if pd.isna(v) else float(v)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Precompute the indicator columns strategies read.

    Args:
        df: OHLCV frame (columns open/high/low/close/volume, ascending dates).

    Returns:
        pd.DataFrame: Input columns plus sma20/sma50/sma200, rsi, ret_63,
        ret_126, atr, adx, plus_di, minus_di.
    """
    out = df.copy()
    close = out["close"]
    out["sma20"] = ind.sma(close, 20)
    out["sma50"] = ind.sma(close, 50)
    out["sma200"] = ind.sma(close, 200)
    out["rsi"] = ind.rsi(close)
    out["ret_63"] = close.pct_change(63)
    out["ret_126"] = close.pct_change(126)
    out["atr"] = ind.atr(out["high"], out["low"], close)
    adx = ind.adx(out["high"], out["low"], close)
    out["adx"] = adx["adx"]
    out["plus_di"] = adx["plus_di"]
    out["minus_di"] = adx["minus_di"]
    return out


class TradingStrategy(ABC):
    """Interface every strategy implements.

    Attributes:
        kind: Registry key (stable identifier stored in the DB).
        label: Human-readable name.
        risk_fit: Which risk profile this strategy suits by default.
        param_grid: Search space for the train-window grid search.
    """

    kind: str = "base"
    label: str = "Base"
    risk_fit: str = "balanced"
    param_grid: list[dict] = [{}]

    def __init__(self, params: dict | None = None):
        """Initialize with chosen parameters (defaults to the grid's first cell).

        Args:
            params: Strategy parameters; missing keys take grid defaults.
        """
        self.params = {**self.param_grid[0], **(params or {})}

    @abstractmethod
    def decide(self, features: pd.DataFrame, day: int, holding: bool) -> Decision:
        """Decide the action for one symbol at one bar.

        Args:
            features: Output of build_features for the symbol.
            day: Positional index of the decision bar within `features`.
            holding: Whether the simulated/real portfolio currently holds it.

        Returns:
            Decision: BUY/SELL/HOLD with ranking score and reasons.
        """

    def describe(self) -> str:
        """Return a short plain-language description of the rules.

        Returns:
            str: Human-readable rule summary including current params.
        """
        return f"{self.label} with parameters {self.params}"
