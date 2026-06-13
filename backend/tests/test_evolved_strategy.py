# test_evolved_strategy.py — tests for the GA-evolved composite strategy:
# signal bounds, decide() entry/exit logic for hand-crafted genes, and the
# human-readable gene description.

from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.strategy.base import build_features
from app.strategy.evolved import (
    GENE_BOUNDS,
    SIGNAL_NAMES,
    EvolvedStrategy,
    _compute_signals,
    describe_gene,
)


def _frame(drift, n=300, seed=3):
    rng = np.random.default_rng(seed)
    closes = 100 * np.exp(np.linspace(0, drift, n) + rng.normal(0, 0.004, n).cumsum())
    idx = [date(2025, 1, 1) + timedelta(days=i) for i in range(n)]
    df = pd.DataFrame({"open": closes, "high": closes * 1.01, "low": closes * 0.99,
                       "close": closes, "volume": np.full(n, 1e6)}, index=idx)
    return build_features(df)


def test_compute_signals_are_bounded():
    up, down = _frame(0.5), _frame(-0.5)
    for feats in (up, down):
        signals = _compute_signals(feats, len(feats) - 1)
        assert set(signals) == set(SIGNAL_NAMES)
        for value in signals.values():
            assert -1.0 <= value <= 1.0


def test_decide_buys_strong_uptrend_with_positive_weights():
    gene = {key: 0.0 for key in GENE_BOUNDS}
    gene.update({
        "weight_mom_126": 1.0, "weight_trend_slow": 1.0, "weight_price_vs_sma200": 1.0,
        "entry_threshold": 0.1, "exit_threshold": -0.1,
    })
    strategy = EvolvedStrategy(gene)
    up = _frame(0.5)
    decision = strategy.decide(up, len(up) - 1, holding=False)
    assert decision.action == "BUY"
    assert decision.reasons["combined_score"] > gene["entry_threshold"]


def test_decide_holds_below_entry_threshold():
    gene = {key: 0.0 for key in GENE_BOUNDS}
    gene.update({"entry_threshold": 0.6, "exit_threshold": -0.6})
    strategy = EvolvedStrategy(gene)
    up = _frame(0.5)
    decision = strategy.decide(up, len(up) - 1, holding=False)
    # All weights zero -> combined_score == 0, below a 0.6 entry threshold.
    assert decision.action == "HOLD"
    assert decision.reasons["combined_score"] == 0.0


def test_decide_sells_when_score_drops_below_exit_threshold():
    gene = {key: 0.0 for key in GENE_BOUNDS}
    gene.update({
        "weight_mom_63": 1.0, "weight_trend_fast": 1.0, "weight_trend_strength": 1.0,
        "entry_threshold": 0.1, "exit_threshold": 0.5,
    })
    strategy = EvolvedStrategy(gene)
    down = _frame(-0.5)
    decision = strategy.decide(down, len(down) - 1, holding=True)
    assert decision.action == "SELL"
    assert decision.reasons["combined_score"] < gene["exit_threshold"]


def test_decide_holds_position_above_exit_threshold():
    gene = {key: 0.0 for key in GENE_BOUNDS}
    gene.update({
        "weight_mom_63": 1.0, "weight_trend_fast": 1.0, "weight_trend_strength": 1.0,
        "entry_threshold": 0.1, "exit_threshold": -0.9,
    })
    strategy = EvolvedStrategy(gene)
    up = _frame(0.5)
    decision = strategy.decide(up, len(up) - 1, holding=True)
    assert decision.action == "HOLD"


def test_describe_gene_mentions_thresholds_and_top_signals():
    gene = {key: 0.0 for key in GENE_BOUNDS}
    gene.update({
        "weight_mom_63": 0.8, "weight_rsi_signal": -0.5,
        "entry_threshold": 0.25, "exit_threshold": -0.15,
    })
    text = describe_gene(gene)
    assert text
    assert "0.25" in text
    assert "-0.15" in text
    assert "mom_63" in text
