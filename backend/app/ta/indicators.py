# indicators.py — pure pandas/numpy implementations of the classic technical
# indicators (PRD FR-4). Each function takes OHLCV series and returns a pandas
# Series aligned to the input index. Implemented by hand (not pandas-ta, which
# is unmaintained and incompatible with numpy 2) so every formula is auditable.

import numpy as np
import pandas as pd


def sma(close: pd.Series, window: int) -> pd.Series:
    """Simple moving average.

    Args:
        close: Close prices.
        window: Averaging window length.

    Returns:
        pd.Series: SMA values (NaN until `window` points exist).
    """
    return close.rolling(window).mean()


def ema(close: pd.Series, span: int) -> pd.Series:
    """Exponential moving average.

    Args:
        close: Close prices.
        span: EMA span (standard 2/(span+1) smoothing).

    Returns:
        pd.Series: EMA values.
    """
    return close.ewm(span=span, adjust=False).mean()


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    """MACD line, signal line, and histogram.

    Args:
        close: Close prices.
        fast: Fast EMA span.
        slow: Slow EMA span.
        signal: Signal-line EMA span.

    Returns:
        pd.DataFrame: Columns "macd", "signal", "hist".
    """
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False).mean()
    return pd.DataFrame({"macd": line, "signal": sig, "hist": line - sig})


def rsi(close: pd.Series, window: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder's smoothing).

    Args:
        close: Close prices.
        window: Lookback length.

    Returns:
        pd.Series: RSI in [0, 100].
    """
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.fillna(100.0).where(close.notna())


def stochastic(
    high: pd.Series, low: pd.Series, close: pd.Series, k: int = 14, d: int = 3
) -> pd.DataFrame:
    """Stochastic oscillator %K and %D.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        k: %K lookback.
        d: %D smoothing window.

    Returns:
        pd.DataFrame: Columns "k" and "d" in [0, 100].
    """
    lowest = low.rolling(k).min()
    highest = high.rolling(k).max()
    pct_k = 100 * (close - lowest) / (highest - lowest).replace(0, np.nan)
    return pd.DataFrame({"k": pct_k, "d": pct_k.rolling(d).mean()})


def bollinger(close: pd.Series, window: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    """Bollinger Bands and %B (position of price within the bands).

    Args:
        close: Close prices.
        window: SMA window.
        num_std: Band width in standard deviations.

    Returns:
        pd.DataFrame: Columns "mid", "upper", "lower", "pct_b".
    """
    mid = sma(close, window)
    std = close.rolling(window).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    pct_b = (close - lower) / (upper - lower).replace(0, np.nan)
    return pd.DataFrame({"mid": mid, "upper": upper, "lower": lower, "pct_b": pct_b})


def atr(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series:
    """Average True Range (Wilder's smoothing).

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        window: Smoothing length.

    Returns:
        pd.Series: ATR values in price units.
    """
    prev_close = close.shift()
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1 / window, adjust=False).mean()


def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    """On-Balance Volume.

    Args:
        close: Close prices.
        volume: Trade volumes.

    Returns:
        pd.Series: Cumulative OBV.
    """
    direction = np.sign(close.diff()).fillna(0)
    return (direction * volume).cumsum()


def vwap_distance(
    high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, window: int = 20
) -> pd.Series:
    """Distance of close from rolling VWAP, as a fraction of VWAP.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        volume: Trade volumes.
        window: Rolling VWAP window.

    Returns:
        pd.Series: (close - vwap) / vwap; positive means price above VWAP.
    """
    typical = (high + low + close) / 3
    pv = (typical * volume).rolling(window).sum()
    v = volume.rolling(window).sum().replace(0, np.nan)
    vwap = pv / v
    return (close - vwap) / vwap


def adx(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.DataFrame:
    """Average Directional Index with +DI/-DI.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        window: Wilder smoothing length.

    Returns:
        pd.DataFrame: Columns "adx", "plus_di", "minus_di".
    """
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=high.index)
    tr = atr(high, low, close, window)
    plus_di = 100 * plus_dm.ewm(alpha=1 / window, adjust=False).mean() / tr.replace(0, np.nan)
    minus_di = 100 * minus_dm.ewm(alpha=1 / window, adjust=False).mean() / tr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return pd.DataFrame(
        {"adx": dx.ewm(alpha=1 / window, adjust=False).mean(), "plus_di": plus_di,
         "minus_di": minus_di}
    )


def williams_r(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 14) -> pd.Series:
    """Williams %R.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        window: Lookback length.

    Returns:
        pd.Series: Values in [-100, 0]; near 0 is overbought.
    """
    highest = high.rolling(window).max()
    lowest = low.rolling(window).min()
    return -100 * (highest - close) / (highest - lowest).replace(0, np.nan)


def cci(high: pd.Series, low: pd.Series, close: pd.Series, window: int = 20) -> pd.Series:
    """Commodity Channel Index.

    Args:
        high: High prices.
        low: Low prices.
        close: Close prices.
        window: Lookback length.

    Returns:
        pd.Series: CCI values (typically within ±200).
    """
    typical = (high + low + close) / 3
    mean = typical.rolling(window).mean()
    mad = typical.rolling(window).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (typical - mean) / (0.015 * mad.replace(0, np.nan))
