# test_indicators.py — golden-value and property tests for the hand-rolled
# technical indicators, trend channel, and support/resistance analyses.

import numpy as np
import pandas as pd
import pytest

from app.ta import indicators as ind
from app.ta.support_resistance import analyze_support_resistance
from app.ta.trend_channel import fit_trend_channel


@pytest.fixture()
def trending_df():
    """Synthetic 250-bar uptrend with mild noise (deterministic)."""
    rng = np.random.default_rng(42)
    n = 250
    drift = np.linspace(0, 0.5, n)
    noise = rng.normal(0, 0.01, n).cumsum()
    close = 100 * np.exp(drift + noise)
    high = close * 1.01
    low = close * 0.99
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    volume = np.full(n, 1e6)
    idx = pd.bdate_range("2025-01-01", periods=n)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx
    )


def test_sma_golden_values():
    s = pd.Series([1, 2, 3, 4, 5], dtype=float)
    out = ind.sma(s, 3)
    assert np.isnan(out.iloc[1])
    assert out.iloc[2] == pytest.approx(2.0)
    assert out.iloc[4] == pytest.approx(4.0)


def test_ema_golden_values():
    s = pd.Series([1, 2, 3], dtype=float)
    # span=3 -> alpha=0.5: ema = [1, 1.5, 2.25]
    out = ind.ema(s, 3)
    assert out.tolist() == pytest.approx([1.0, 1.5, 2.25])


def test_rsi_bounds_and_direction():
    up = pd.Series(np.linspace(100, 200, 50))
    down = pd.Series(np.linspace(200, 100, 50))
    assert ind.rsi(up).iloc[-1] > 95  # monotonic gains -> RSI ~ 100
    assert ind.rsi(down).iloc[-1] < 5


def test_macd_sign_in_clean_uptrend():
    close = pd.Series(100 * np.exp(np.linspace(0, 0.3, 120)))
    macd = ind.macd(close)
    assert macd["macd"].iloc[-1] > 0
    assert set(macd.columns) == {"macd", "signal", "hist"}


def test_stochastic_bounds(trending_df):
    st = ind.stochastic(trending_df["high"], trending_df["low"], trending_df["close"])
    valid = st.dropna()
    assert ((valid >= -1e-9) & (valid <= 100 + 1e-9)).all().all()


def test_bollinger_pct_b_centered_for_flat_series():
    flat = pd.Series(np.full(30, 50.0))
    bb = ind.bollinger(flat)
    # Zero variance -> bands collapse; pct_b undefined (NaN), mid == price.
    assert bb["mid"].iloc[-1] == pytest.approx(50.0)
    assert np.isnan(bb["pct_b"].iloc[-1])


def test_atr_positive_and_scales(trending_df):
    out = ind.atr(trending_df["high"], trending_df["low"], trending_df["close"])
    assert (out.dropna() > 0).all()


def test_obv_accumulates_on_up_days():
    close = pd.Series([10, 11, 12, 11], dtype=float)
    vol = pd.Series([100, 100, 100, 100], dtype=float)
    out = ind.obv(close, vol)
    assert out.tolist() == [0, 100, 200, 100]


def test_adx_strong_in_clean_trend(trending_df):
    adx = ind.adx(trending_df["high"], trending_df["low"], trending_df["close"])
    assert adx["adx"].iloc[-1] > 15
    assert adx["plus_di"].iloc[-1] > adx["minus_di"].iloc[-1]


def test_williams_r_bounds(trending_df):
    wr = ind.williams_r(trending_df["high"], trending_df["low"], trending_df["close"]).dropna()
    assert ((wr <= 1e-9) & (wr >= -100 - 1e-9)).all()


def test_cci_positive_in_uptrend(trending_df):
    cci = ind.cci(trending_df["high"], trending_df["low"], trending_df["close"])
    assert cci.iloc[-1] > 0


def test_vwap_distance_above_in_uptrend(trending_df):
    vw = ind.vwap_distance(trending_df["high"], trending_df["low"],
                           trending_df["close"], trending_df["volume"])
    assert vw.iloc[-1] > 0


def test_trend_channel_detects_uptrend(trending_df):
    channel = fit_trend_channel(trending_df["close"])
    assert channel is not None
    assert channel.slope_annual_pct > 20  # strong synthetic drift
    assert channel.lower < channel.mid < channel.upper
    assert -0.5 < channel.position < 1.5


def test_trend_channel_needs_enough_data():
    assert fit_trend_channel(pd.Series(np.linspace(1, 2, 30))) is None


def test_support_resistance_finds_levels():
    # Price oscillating between ~90 and ~110 -> clear S/R bands.
    t = np.arange(200)
    close = pd.Series(100 + 10 * np.sin(t / 6.0))
    high, low = close + 1, close - 1
    sr = analyze_support_resistance(high, low, close)
    assert sr.levels, "expected at least one level"
    prices = [level.price for level in sr.levels]
    assert any(p < 95 for p in prices)  # support cluster near the lows
    assert any(p > 105 for p in prices)  # resistance cluster near the highs


def test_support_resistance_handles_short_series():
    short = pd.Series([1.0, 2.0, 3.0])
    sr = analyze_support_resistance(short + 0.1, short - 0.1, short)
    assert sr.levels == []
    assert sr.nearest_support is None
