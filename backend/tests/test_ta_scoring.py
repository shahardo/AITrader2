# test_ta_scoring.py — tests for signal extraction and the composite technical score.

import numpy as np
import pandas as pd
import pytest

from app.ta.scoring import (
    WEIGHTS,
    IndicatorSignal,
    composite_score,
    compute_signals,
    signals_to_json,
)


def _df(close: np.ndarray) -> pd.DataFrame:
    idx = pd.bdate_range("2025-01-01", periods=len(close))
    return pd.DataFrame(
        {"open": close, "high": close * 1.01, "low": close * 0.99,
         "close": close, "volume": np.full(len(close), 1e6)}, index=idx)


def test_compute_signals_returns_all_indicators_with_history():
    rng = np.random.default_rng(1)
    close = 100 * np.exp(rng.normal(0.001, 0.01, 260).cumsum())
    signals = compute_signals(_df(close))
    assert set(signals) == set(WEIGHTS)
    for sig in signals.values():
        assert sig.signal in (-1, 0, 1)
        assert 0.0 <= sig.strength <= 1.0


def test_compute_signals_empty_for_short_history():
    assert compute_signals(_df(np.linspace(100, 110, 30))) == {}


def test_uptrend_scores_above_downtrend():
    rng = np.random.default_rng(2)
    noise = rng.normal(0, 0.004, 260).cumsum()
    up = 100 * np.exp(np.linspace(0, 0.4, 260) + noise)
    down = 100 * np.exp(np.linspace(0, -0.4, 260) + noise)
    up_score = composite_score(compute_signals(_df(up)))
    down_score = composite_score(compute_signals(_df(down)))
    assert up_score > down_score
    assert up_score > 50 > down_score


def test_composite_score_bounds_and_neutrality():
    all_bull = {k: IndicatorSignal(1, 1.0, None) for k in WEIGHTS}
    all_bear = {k: IndicatorSignal(-1, 1.0, None) for k in WEIGHTS}
    neutral = {k: IndicatorSignal(0, 0.0, None) for k in WEIGHTS}
    assert composite_score(all_bull) == pytest.approx(100.0)
    assert composite_score(all_bear) == pytest.approx(0.0)
    assert composite_score(neutral) == pytest.approx(50.0)


def test_strategy_weight_override_changes_score():
    signals = {
        "sma_cross": IndicatorSignal(1, 1.0, None),
        "rsi": IndicatorSignal(-1, 1.0, None),
    }
    default = composite_score(signals)
    rsi_heavy = composite_score(signals, weights={"sma_cross": 0.1, "rsi": 10.0})
    assert default > 50 > rsi_heavy


def test_signals_serialize_to_plain_json():
    payload = signals_to_json({"rsi": IndicatorSignal(1, 0.5, 25.0)})
    assert payload == {"rsi": {"signal": 1, "strength": 0.5, "value": 25.0}}
