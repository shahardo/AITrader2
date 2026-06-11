# scoring.py — turns raw indicator values into discrete signals (-1/0/+1 with a
# 0..1 strength) and blends them into the composite technical score (0-100) using
# the indicator weights from the development plan (§5.1).

from dataclasses import asdict, dataclass

import pandas as pd

from app.ta import indicators as ind
from app.ta.support_resistance import analyze_support_resistance
from app.ta.trend_channel import fit_trend_channel

# Development plan §5.1 weights: trend ×1.5, MACD & S/R ×1.25, oscillators &
# volume ×1.0, volatility ×0.75.
WEIGHTS: dict[str, float] = {
    "sma_cross": 1.5,
    "adx": 1.5,
    "trend_channel": 1.5,
    "macd": 1.25,
    "support_resistance": 1.25,
    "ema20": 1.0,
    "rsi": 1.0,
    "stochastic": 1.0,
    "williams_r": 1.0,
    "cci": 1.0,
    "obv": 1.0,
    "vwap_distance": 1.0,
    "bollinger": 0.75,
    "atr": 0.75,
}

MIN_BARS = 60  # below this we refuse to score rather than emit noise


@dataclass(frozen=True)
class IndicatorSignal:
    """One indicator's contribution to the technical score.

    Attributes:
        signal: -1 (bearish), 0 (neutral), or +1 (bullish).
        strength: Conviction in [0, 1]; multiplies the signal in the composite.
        value: Headline numeric value for display (e.g. RSI level).
    """

    signal: int
    strength: float
    value: float | None


def _clip(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    """Clamp x into [lo, hi]."""
    return max(lo, min(hi, x))


def compute_signals(df: pd.DataFrame) -> dict[str, IndicatorSignal]:
    """Compute all 14 indicator signals from an OHLCV frame.

    Args:
        df: DataFrame with columns open/high/low/close/volume, ascending dates.

    Returns:
        dict[str, IndicatorSignal]: Signal per indicator key in WEIGHTS. Returns
        an empty dict when there is not enough history (< MIN_BARS rows).
    """
    if len(df) < MIN_BARS:
        return {}
    high, low, close, volume = df["high"], df["low"], df["close"], df["volume"]
    out: dict[str, IndicatorSignal] = {}
    last = float(close.iloc[-1])

    # SMA 50/200 cross — golden/death regime; falls back to 50-only when short.
    sma50 = ind.sma(close, 50).iloc[-1]
    sma200 = ind.sma(close, 200).iloc[-1] if len(df) >= 200 else None
    if sma200 is not None and not pd.isna(sma200):
        spread = (sma50 - sma200) / sma200
        out["sma_cross"] = IndicatorSignal(
            1 if spread > 0 else -1, _clip(abs(spread) / 0.05), float(spread))
    elif not pd.isna(sma50):
        spread = (last - sma50) / sma50
        out["sma_cross"] = IndicatorSignal(
            1 if spread > 0 else -1, _clip(abs(spread) / 0.05) * 0.5, float(spread))

    # EMA20 — price location vs short trend.
    ema20 = float(ind.ema(close, 20).iloc[-1])
    rel = (last - ema20) / ema20
    out["ema20"] = IndicatorSignal(1 if rel > 0 else -1, _clip(abs(rel) / 0.03), rel)

    # MACD — histogram sign and magnitude relative to price.
    macd_df = ind.macd(close)
    hist = float(macd_df["hist"].iloc[-1])
    out["macd"] = IndicatorSignal(
        1 if hist > 0 else -1, _clip(abs(hist) / (last * 0.01)), hist)

    # RSI — overbought/oversold mean-reversion read.
    rsi_val = float(ind.rsi(close).iloc[-1])
    if rsi_val < 30:
        out["rsi"] = IndicatorSignal(1, _clip((30 - rsi_val) / 15), rsi_val)
    elif rsi_val > 70:
        out["rsi"] = IndicatorSignal(-1, _clip((rsi_val - 70) / 15), rsi_val)
    else:
        out["rsi"] = IndicatorSignal(0, 0.0, rsi_val)

    # Stochastic — %K extremes.
    k = float(ind.stochastic(high, low, close)["k"].iloc[-1])
    if k < 20:
        out["stochastic"] = IndicatorSignal(1, _clip((20 - k) / 15), k)
    elif k > 80:
        out["stochastic"] = IndicatorSignal(-1, _clip((k - 80) / 15), k)
    else:
        out["stochastic"] = IndicatorSignal(0, 0.0, k)

    # Bollinger %B — band extremes as mean-reversion signal.
    pct_b = float(ind.bollinger(close)["pct_b"].iloc[-1])
    if pct_b < 0.05:
        out["bollinger"] = IndicatorSignal(1, _clip((0.05 - pct_b) / 0.2), pct_b)
    elif pct_b > 0.95:
        out["bollinger"] = IndicatorSignal(-1, _clip((pct_b - 0.95) / 0.2), pct_b)
    else:
        out["bollinger"] = IndicatorSignal(0, 0.0, pct_b)

    # ATR — volatility regime (no direction): contracting vol mildly bullish for
    # trend continuation, exploding vol a caution flag.
    atr_series = ind.atr(high, low, close)
    atr_now = float(atr_series.iloc[-1])
    atr_avg = float(atr_series.tail(60).mean())
    vol_ratio = atr_now / atr_avg if atr_avg else 1.0
    out["atr"] = IndicatorSignal(
        -1 if vol_ratio > 1.5 else 0, _clip((vol_ratio - 1.5) / 0.5) if vol_ratio > 1.5 else 0.0,
        atr_now)

    # OBV — volume flow trend over the last month.
    obv_series = ind.obv(close, volume)
    obv_slope = float(obv_series.iloc[-1] - obv_series.iloc[-21]) if len(df) >= 21 else 0.0
    vol_month = float(volume.tail(21).sum()) or 1.0
    obv_rel = obv_slope / vol_month
    out["obv"] = IndicatorSignal(
        1 if obv_rel > 0 else -1, _clip(abs(obv_rel) / 0.3), obv_rel)

    # VWAP distance — price vs 20-day rolling VWAP.
    vw = float(ind.vwap_distance(high, low, close, volume).iloc[-1])
    out["vwap_distance"] = IndicatorSignal(1 if vw > 0 else -1, _clip(abs(vw) / 0.03), vw)

    # ADX — trend strength gated by DI direction.
    adx_df = ind.adx(high, low, close)
    adx_val = float(adx_df["adx"].iloc[-1])
    plus, minus = float(adx_df["plus_di"].iloc[-1]), float(adx_df["minus_di"].iloc[-1])
    if adx_val > 20:
        out["adx"] = IndicatorSignal(
            1 if plus > minus else -1, _clip((adx_val - 20) / 30), adx_val)
    else:
        out["adx"] = IndicatorSignal(0, 0.0, adx_val)

    # Williams %R — overbought/oversold.
    wr = float(ind.williams_r(high, low, close).iloc[-1])
    if wr < -80:
        out["williams_r"] = IndicatorSignal(1, _clip((-80 - wr) / 15), wr)
    elif wr > -20:
        out["williams_r"] = IndicatorSignal(-1, _clip((wr + 20) / 15), wr)
    else:
        out["williams_r"] = IndicatorSignal(0, 0.0, wr)

    # CCI — channel extremes.
    cci_val = float(ind.cci(high, low, close).iloc[-1])
    if cci_val < -100:
        out["cci"] = IndicatorSignal(1, _clip((-100 - cci_val) / 100), cci_val)
    elif cci_val > 100:
        out["cci"] = IndicatorSignal(-1, _clip((cci_val - 100) / 100), cci_val)
    else:
        out["cci"] = IndicatorSignal(0, 0.0, cci_val)

    # Trend channel — buy near the lower band of an up channel, sell near the
    # upper band of a down channel (dev plan §5.1).
    channel = fit_trend_channel(close)
    if channel is not None:
        up = channel.slope_annual_pct > 0
        if up and channel.position < 0.4:
            sig, strength = 1, _clip((0.4 - channel.position) / 0.4)
        elif not up and channel.position > 0.6:
            sig, strength = -1, _clip((channel.position - 0.6) / 0.4)
        else:
            sig, strength = (1 if up else -1), 0.2  # mild bias with the slope
        out["trend_channel"] = IndicatorSignal(sig, strength, channel.slope_annual_pct)

    # Support/resistance — near strong support is a buy bias; near resistance, sell.
    sr = analyze_support_resistance(high, low, close)
    sup, res = sr.support_distance_atr, sr.resistance_distance_atr
    if sup is not None and sup < 1.0:
        out["support_resistance"] = IndicatorSignal(1, _clip(1.0 - sup), sup)
    elif res is not None and res < 1.0:
        out["support_resistance"] = IndicatorSignal(-1, _clip(1.0 - res), res)
    else:
        out["support_resistance"] = IndicatorSignal(0, 0.0, sup if sup is not None else res)

    return out


def composite_score(signals: dict[str, IndicatorSignal],
                    weights: dict[str, float] | None = None) -> float:
    """Blend indicator signals into the 0-100 technical score.

    Implements: score = 50 + 50 * Σ(w·signal·strength) / Σ(w).

    Args:
        signals: Output of compute_signals.
        weights: Optional per-indicator weight overrides (strategies re-weight).

    Returns:
        float: Technical score; 50 is neutral, above is bullish.
    """
    weights = weights or WEIGHTS
    total_weight = sum(weights.get(k, 1.0) for k in signals) or 1.0
    weighted = sum(
        weights.get(k, 1.0) * s.signal * s.strength for k, s in signals.items()
    )
    return round(50 + 50 * weighted / total_weight, 2)


def signals_to_json(signals: dict[str, IndicatorSignal]) -> dict:
    """Serialize signals for JSON storage in indicator snapshots.

    Args:
        signals: Output of compute_signals.

    Returns:
        dict: indicator key -> {"signal", "strength", "value"}.
    """
    return {k: asdict(v) for k, v in signals.items()}
