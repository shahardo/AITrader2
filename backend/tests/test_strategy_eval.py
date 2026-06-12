# test_strategy_eval.py — tests for the strategy library decisions, the 10/2
# train-test evaluator (window boundaries, persistence), and the churn-guarded
# strategy recommendation.

from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar
from app.models.strategy import BacktestTrade, StrategyRun
from app.strategy.base import build_features
from app.strategy.evaluator import (
    ensure_strategy_rows,
    evaluate_all_strategies,
    recommend_strategy,
)
from app.strategy.library import STRATEGY_REGISTRY, make_strategy


def _frame(drift, n=300, seed=3):
    rng = np.random.default_rng(seed)
    closes = 100 * np.exp(np.linspace(0, drift, n) + rng.normal(0, 0.004, n).cumsum())
    idx = [date(2025, 1, 1) + timedelta(days=i) for i in range(n)]
    df = pd.DataFrame({"open": closes, "high": closes * 1.01, "low": closes * 0.99,
                       "close": closes, "volume": np.full(n, 1e6)}, index=idx)
    return build_features(df)


def test_registry_has_four_strategies():
    assert set(STRATEGY_REGISTRY) == {"momentum", "mean_reversion",
                                      "trend_following", "balanced"}


def test_momentum_buys_uptrend_not_downtrend():
    strategy = make_strategy("momentum")
    up, down = _frame(0.5), _frame(-0.5)
    assert strategy.decide(up, len(up) - 1, holding=False).action == "BUY"
    assert strategy.decide(down, len(down) - 1, holding=False).action == "HOLD"
    assert strategy.decide(down, len(down) - 1, holding=True).action == "SELL"


def test_mean_reversion_buys_oversold():
    strategy = make_strategy("mean_reversion", {"entry_rsi": 30.0, "exit_rsi": 55.0})
    # Steady decline within a healthy long-term level -> low RSI.
    n = 300
    closes = np.concatenate([np.full(200, 100.0), np.linspace(100, 90, 100)])
    idx = [date(2025, 1, 1) + timedelta(days=i) for i in range(n)]
    df = pd.DataFrame({"open": closes, "high": closes * 1.001, "low": closes * 0.999,
                       "close": closes, "volume": np.full(n, 1e6)}, index=idx)
    feats = build_features(df)
    decision = strategy.decide(feats, n - 1, holding=False)
    assert decision.action == "BUY"
    assert decision.reasons["rsi"] < 30


def _seed_universe(db, n_symbols=6):
    start = date.today() - timedelta(days=420)
    rng = np.random.default_rng(11)
    for s in range(n_symbols):
        inst = Instrument(symbol=f"SYM{s}", name=f"Sym {s}", exchange=Exchange.us,
                          universe_source=UniverseSource.sp500)
        db.add(inst)
        db.commit()
        db.refresh(inst)
        drift = 0.4 if s % 2 == 0 else -0.2
        closes = 100 * np.exp(np.linspace(0, drift, 420) +
                              rng.normal(0, 0.005, 420).cumsum())
        for i, c in enumerate(closes):
            db.add(PriceBar(instrument_id=inst.id, date=start + timedelta(days=i),
                            open=c, high=c * 1.01, low=c * 0.99, close=c, volume=1e6))
        db.commit()


def test_evaluator_runs_all_strategies_with_correct_windows(db_session):
    _seed_universe(db_session)
    as_of = date.today()
    runs = evaluate_all_strategies(db_session, as_of=as_of, max_symbols=6)

    assert len(runs) == 4
    for run in runs:
        # 10/2 split: test = last ~2 months, train ends the day before test starts.
        assert run.test_end == as_of
        assert (run.test_start - run.train_end).days == 1
        assert (as_of - run.test_start).days == 60
        assert run.train_start == as_of - timedelta(days=365)
        assert "sharpe" in run.train_metrics and "sharpe" in run.test_metrics
    # Trades persisted with reasons for at least one run (uptrending universe).
    assert db_session.query(BacktestTrade).count() > 0
    trade = db_session.query(BacktestTrade).first()
    assert isinstance(trade.triggering_signals, dict)


def test_recommend_strategy_uses_test_metrics_and_churn_guard(db_session):
    strategies = ensure_strategy_rows(db_session)
    ids = {kind: s.id for kind, s in strategies.items()}

    def add_run(kind, sharpe, dd=-0.1):
        db_session.add(StrategyRun(
            strategy_id=ids[kind], run_date=date.today(),
            train_start=date(2025, 1, 1), train_end=date(2025, 10, 31),
            test_start=date(2025, 11, 1), test_end=date(2025, 12, 31),
            chosen_params={}, train_metrics={"sharpe": 9.9},  # train must NOT win
            test_metrics={"sharpe": sharpe, "max_drawdown": dd}))

    add_run("momentum", sharpe=1.0)
    add_run("balanced", sharpe=1.2)
    add_run("mean_reversion", sharpe=0.2)
    add_run("trend_following", sharpe=0.1)
    db_session.commit()

    # Without incumbent: best test sharpe (balanced) wins.
    best = recommend_strategy(db_session, "balanced")
    assert best.kind == "balanced"
    # Churn guard: balanced (1.2) does NOT displace momentum (1.0): delta < 0.3.
    kept = recommend_strategy(db_session, "balanced", incumbent_id=ids["momentum"])
    assert kept.kind == "momentum"
    # A big enough edge does displace.
    add_run("balanced", sharpe=2.0)
    db_session.commit()
    switched = recommend_strategy(db_session, "balanced", incumbent_id=ids["momentum"])
    assert switched.kind == "balanced"
