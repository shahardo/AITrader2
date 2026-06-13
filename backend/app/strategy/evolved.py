# evolved.py — the GA-evolved composite strategy (app/strategy/genetic.py):
# a single weighted combination of existing indicator signals, with the
# weights and entry/exit thresholds ("gene") evolved rather than hand-tuned.

import pandas as pd

from app.strategy.base import Decision, TradingStrategy, _val

SIGNAL_NAMES = [
    "mom_63",
    "mom_126",
    "trend_fast",
    "trend_slow",
    "rsi_signal",
    "trend_strength",
    "price_vs_sma200",
]

# Search space for each gene component: signal weights in [-1, 1], plus the
# combined-score thresholds that gate BUY/SELL.
GENE_BOUNDS: dict[str, tuple[float, float]] = {
    **{f"weight_{name}": (-1.0, 1.0) for name in SIGNAL_NAMES},
    "entry_threshold": (0.05, 0.6),
    "exit_threshold": (-0.6, 0.3),
}

# A reasonable pre-GA default: modest momentum/trend tilt, used until the
# first evolution run produces a fitted gene.
DEFAULT_GENE: dict[str, float] = {
    "weight_mom_63": 0.3,
    "weight_mom_126": 0.0,
    "weight_trend_fast": 0.3,
    "weight_trend_slow": 0.0,
    "weight_rsi_signal": 0.0,
    "weight_trend_strength": 0.4,
    "weight_price_vs_sma200": 0.0,
    "entry_threshold": 0.15,
    "exit_threshold": -0.1,
}


def _clip(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    """Clamp a value to a range.

    Args:
        value: Value to clamp.
        lo: Lower bound.
        hi: Upper bound.

    Returns:
        float: `value` clamped to `[lo, hi]`.
    """
    return max(lo, min(hi, value))


def _compute_signals(features: pd.DataFrame, day: int) -> dict[str, float]:
    """Compute the bounded per-symbol signals an evolved gene weights.

    Args:
        features: Output of `build_features` for one symbol.
        day: Positional bar index.

    Returns:
        dict[str, float]: One value per `SIGNAL_NAMES`, each in `[-1, 1]`.
    """
    close = _val(features, day, "close")
    sma20 = _val(features, day, "sma20")
    sma50 = _val(features, day, "sma50")
    sma200 = _val(features, day, "sma200")
    rsi = _val(features, day, "rsi")
    adx = _val(features, day, "adx")
    plus_di = _val(features, day, "plus_di")
    minus_di = _val(features, day, "minus_di")
    return {
        "mom_63": _clip(_val(features, day, "ret_63")),
        "mom_126": _clip(_val(features, day, "ret_126")),
        "trend_fast": _clip((sma20 - sma50) / sma50) if sma50 > 0 else 0.0,
        "trend_slow": _clip((sma50 - sma200) / sma200) if sma200 > 0 else 0.0,
        "rsi_signal": _clip((50.0 - rsi) / 50.0),
        "trend_strength": _clip(((plus_di - minus_di) / 100.0) * (adx / 100.0)),
        "price_vs_sma200": _clip((close - sma200) / sma200) if sma200 > 0 else 0.0,
    }


def describe_gene(params: dict) -> str:
    """Render an evolved gene as a human-readable rule summary.

    Args:
        params: A gene dict matching `GENE_BOUNDS`.

    Returns:
        str: Plain-language description naming the strongest signals and the
        entry/exit thresholds on the combined score.
    """
    weights = {name: params.get(f"weight_{name}", 0.0) for name in SIGNAL_NAMES}
    top = sorted(weights.items(), key=lambda kv: abs(kv[1]), reverse=True)[:3]
    signals = ", ".join(f"{name} ({w:+.2f})" for name, w in top if abs(w) > 1e-6)
    entry = params.get("entry_threshold", 0.0)
    exit_ = params.get("exit_threshold", 0.0)
    return (
        f"Genetically evolved composite strategy: buys when the weighted signal "
        f"score exceeds {entry:.2f} and sells once it falls below {exit_:.2f}. "
        f"Strongest signals: {signals or 'none'}."
    )


class EvolvedStrategy(TradingStrategy):
    """Composite strategy whose weights/thresholds are produced by the GA.

    The combined score is a weighted average of `SIGNAL_NAMES`, normalized by
    the sum of absolute weights so it stays in roughly `[-1, 1]` regardless of
    the gene's weight magnitudes.
    """

    kind = "evolved"
    label = "Evolved (GA)"
    risk_fit = "balanced"
    param_grid = [DEFAULT_GENE]

    def decide(self, features, day, holding) -> Decision:
        """Evolved entry/exit rule. See TradingStrategy.decide."""
        signals = _compute_signals(features, day)
        weights = {name: self.params[f"weight_{name}"] for name in SIGNAL_NAMES}
        total_weight = sum(abs(w) for w in weights.values())
        if total_weight > 1e-9:
            score = sum(weights[name] * signals[name] for name in SIGNAL_NAMES) / total_weight
        else:
            score = 0.0
        reasons = {**{k: round(v, 4) for k, v in signals.items()},
                  "combined_score": round(score, 4)}
        if holding:
            if score < self.params["exit_threshold"]:
                return Decision("SELL", reasons=reasons)
            return Decision("HOLD", reasons=reasons)
        if score > self.params["entry_threshold"]:
            return Decision("BUY", score=score, reasons=reasons)
        return Decision("HOLD", reasons=reasons)

    def describe(self) -> str:
        """Return the gene's plain-language rule summary. See TradingStrategy.describe."""
        return describe_gene(self.params)
