# library.py — the four launch strategies (PRD FR-8): momentum, mean-reversion,
# trend-following, and balanced, plus the registry used by the evaluator and the
# recommendation engine.

import pandas as pd

from app.strategy.base import Decision, TradingStrategy


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


class MomentumStrategy(TradingStrategy):
    """Buy strong recent performers above their 50-day average.

    Exits when the momentum fades or price loses the average.
    """

    kind = "momentum"
    label = "Momentum"
    risk_fit = "aggressive"
    param_grid = [
        {"lookback": "ret_63", "entry": 0.10, "exit": 0.0},
        {"lookback": "ret_63", "entry": 0.15, "exit": 0.02},
        {"lookback": "ret_126", "entry": 0.15, "exit": 0.0},
        {"lookback": "ret_126", "entry": 0.25, "exit": 0.05},
    ]

    def decide(self, features, day, holding) -> Decision:
        """Momentum entry/exit rule. See TradingStrategy.decide."""
        mom = _val(features, day, self.params["lookback"])
        close = _val(features, day, "close")
        sma50 = _val(features, day, "sma50")
        above = close > sma50 > 0
        reasons = {"momentum": round(mom, 4), "close_vs_sma50": above}
        if holding:
            if mom < self.params["exit"] or not above:
                return Decision("SELL", reasons=reasons)
            return Decision("HOLD", reasons=reasons)
        if mom > self.params["entry"] and above:
            return Decision("BUY", score=mom, reasons=reasons)
        return Decision("HOLD", reasons=reasons)


class MeanReversionStrategy(TradingStrategy):
    """Buy oversold names (low RSI) that are not in collapse; exit on RSI recovery."""

    kind = "mean_reversion"
    label = "Mean reversion"
    risk_fit = "balanced"
    param_grid = [
        {"entry_rsi": 30.0, "exit_rsi": 55.0},
        {"entry_rsi": 25.0, "exit_rsi": 50.0},
        {"entry_rsi": 35.0, "exit_rsi": 60.0},
    ]

    def decide(self, features, day, holding) -> Decision:
        """Mean-reversion entry/exit rule. See TradingStrategy.decide."""
        rsi_raw = features["rsi"].iloc[day]
        if pd.isna(rsi_raw):  # indicator not warmed up: no opinion
            return Decision("HOLD", reasons={"rsi": None})
        rsi = float(rsi_raw)
        close = _val(features, day, "close")
        sma200 = _val(features, day, "sma200")
        not_collapsing = sma200 == 0 or close > sma200 * 0.85
        reasons = {"rsi": round(rsi, 2), "not_collapsing": not_collapsing}
        if holding:
            if rsi > self.params["exit_rsi"]:
                return Decision("SELL", reasons=reasons)
            return Decision("HOLD", reasons=reasons)
        if rsi < self.params["entry_rsi"] and not_collapsing:
            return Decision("BUY", score=self.params["entry_rsi"] - rsi, reasons=reasons)
        return Decision("HOLD", reasons=reasons)


class TrendFollowingStrategy(TradingStrategy):
    """Ride established trends (fast average above slow, with strength).

    Exits when the trend structure breaks.
    """

    kind = "trend_following"
    label = "Trend following"
    risk_fit = "balanced"
    param_grid = [
        {"fast": "sma20", "slow": "sma50", "min_adx": 20.0},
        {"fast": "sma50", "slow": "sma200", "min_adx": 20.0},
        {"fast": "sma50", "slow": "sma200", "min_adx": 25.0},
    ]

    def decide(self, features, day, holding) -> Decision:
        """Trend-following entry/exit rule. See TradingStrategy.decide."""
        fast = _val(features, day, self.params["fast"])
        slow = _val(features, day, self.params["slow"])
        adx = _val(features, day, "adx")
        plus = _val(features, day, "plus_di")
        minus = _val(features, day, "minus_di")
        uptrend = slow > 0 and fast > slow and plus > minus
        reasons = {"fast_above_slow": fast > slow, "adx": round(adx, 1),
                   "di_bullish": plus > minus}
        if holding:
            if not uptrend:
                return Decision("SELL", reasons=reasons)
            return Decision("HOLD", reasons=reasons)
        if uptrend and adx > self.params["min_adx"]:
            spread = (fast - slow) / slow
            return Decision("BUY", score=spread, reasons=reasons)
        return Decision("HOLD", reasons=reasons)


class BalancedStrategy(TradingStrategy):
    """Blend of trend and value-of-entry; suits conservative profiles.

    Buys modest momentum confirmed by trend, with gentler thresholds.
    """

    kind = "balanced"
    label = "Balanced blend"
    risk_fit = "conservative"
    param_grid = [
        {"entry_mom": 0.05, "max_rsi": 70.0, "exit_mom": -0.05},
        {"entry_mom": 0.08, "max_rsi": 65.0, "exit_mom": -0.03},
    ]

    def decide(self, features, day, holding) -> Decision:
        """Balanced entry/exit rule. See TradingStrategy.decide."""
        mom = _val(features, day, "ret_63")
        rsi = _val(features, day, "rsi")
        close = _val(features, day, "close")
        sma50 = _val(features, day, "sma50")
        reasons = {"momentum": round(mom, 4), "rsi": round(rsi, 1)}
        if holding:
            if mom < self.params["exit_mom"] or (sma50 > 0 and close < sma50 * 0.97):
                return Decision("SELL", reasons=reasons)
            return Decision("HOLD", reasons=reasons)
        if mom > self.params["entry_mom"] and rsi < self.params["max_rsi"] and close > sma50 > 0:
            return Decision("BUY", score=mom * (1 - rsi / 100), reasons=reasons)
        return Decision("HOLD", reasons=reasons)


STRATEGY_REGISTRY: dict[str, type[TradingStrategy]] = {
    cls.kind: cls
    for cls in (MomentumStrategy, MeanReversionStrategy, TrendFollowingStrategy,
                BalancedStrategy)
}


def make_strategy(kind: str, params: dict | None = None) -> TradingStrategy:
    """Instantiate a strategy by registry key.

    Args:
        kind: Registry key (e.g. "momentum").
        params: Parameter overrides.

    Returns:
        TradingStrategy: The configured strategy.

    Raises:
        KeyError: For unknown kinds.
    """
    return STRATEGY_REGISTRY[kind](params)
