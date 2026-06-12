# evaluator.py — weekly strategy evaluation (dev plan §5.4): grid-search each
# strategy's params on the first 10 months of the trailing year, validate
# out-of-sample on the last 2 months, persist runs + trades, and recommend a
# strategy per risk profile using test metrics only (with a churn guard).

import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.service import load_ohlcv
from app.models.instrument import Instrument
from app.models.strategy import BacktestTrade, Strategy, StrategyRun
from app.strategy.backtest import run_backtest
from app.strategy.base import build_features
from app.strategy.library import STRATEGY_REGISTRY, make_strategy

logger = logging.getLogger(__name__)

TRAIN_MONTHS = 10
TEST_MONTHS = 2
CHURN_GUARD_SHARPE = 0.3  # challenger must beat incumbent's test sharpe by this


def ensure_strategy_rows(db: Session) -> dict[str, Strategy]:
    """Make sure every registry strategy exists in the strategies table.

    Args:
        db: Database session (committed).

    Returns:
        dict[str, Strategy]: kind -> persisted Strategy row.
    """
    existing = {s.kind: s for s in db.scalars(select(Strategy))}
    for kind, cls in STRATEGY_REGISTRY.items():
        if kind not in existing:
            row = Strategy(name=cls.label, kind=kind, params=cls.param_grid[0],
                           risk_fit=cls.risk_fit, description=cls(None).describe())
            db.add(row)
            existing[kind] = row
    db.commit()
    return existing


def evaluate_all_strategies(
    db: Session,
    as_of: date | None = None,
    symbols: list[str] | None = None,
    max_symbols: int = 60,
    initial_capital: float = 100_000.0,
) -> list[StrategyRun]:
    """Run the 10/2 train-test evaluation for every strategy in the library.

    Train: grid search over param_grid, picking the cell with the best train
    Sharpe. Test: a single out-of-sample run with the chosen params; test
    metrics drive all downstream selection.

    Args:
        db: Database session (committed).
        as_of: Evaluation date (defaults to today); window is the trailing year.
        symbols: Universe subset to simulate (defaults to top-ranked / first
            `max_symbols` active instruments).
        max_symbols: Cap on simulated symbols to bound runtime.
        initial_capital: Simulated starting cash.

    Returns:
        list[StrategyRun]: The persisted runs, one per strategy.
    """
    as_of = as_of or date.today()
    test_end = as_of
    test_start = as_of - timedelta(days=TEST_MONTHS * 30)
    train_end = test_start - timedelta(days=1)
    train_start = as_of - timedelta(days=365)

    stmt = select(Instrument).where(Instrument.is_active.is_(True))
    if symbols:
        stmt = stmt.where(Instrument.symbol.in_(symbols))
    instruments = list(db.scalars(stmt))[:max_symbols]

    features = {}
    for inst in instruments:
        df = load_ohlcv(db, inst.id, max_bars=600)  # extra history warms up indicators
        if len(df) >= 120:
            features[inst.symbol] = build_features(df)
    if not features:
        logger.warning("Strategy evaluation skipped: no instruments with history")
        return []

    strategy_rows = ensure_strategy_rows(db)
    runs: list[StrategyRun] = []
    for kind, cls in STRATEGY_REGISTRY.items():
        # Train: pick params by train-window Sharpe.
        best_params, best_train = None, None
        for params in cls.param_grid:
            result = run_backtest(make_strategy(kind, params), features,
                                  train_start, train_end, initial_capital)
            if best_train is None or result.metrics["sharpe"] > best_train["sharpe"]:
                best_params, best_train = params, result.metrics
        # Test: one out-of-sample pass with chosen params (never re-fit).
        test_result = run_backtest(make_strategy(kind, best_params), features,
                                   test_start, test_end, initial_capital)
        run = StrategyRun(
            strategy_id=strategy_rows[kind].id, run_date=as_of,
            train_start=train_start, train_end=train_end,
            test_start=test_start, test_end=test_end,
            chosen_params=best_params, train_metrics=best_train,
            test_metrics=test_result.metrics,
            equity_curve=[[d.isoformat(), v] for d, v in test_result.equity_curve],
        )
        db.add(run)
        db.flush()
        for trade in test_result.trades:
            db.add(BacktestTrade(
                strategy_run_id=run.id, symbol=trade.symbol, side=trade.side,
                date=trade.date, price=trade.price, qty=trade.qty,
                triggering_signals=trade.reasons, pnl=trade.pnl))
        strategy_rows[kind].params = best_params
        runs.append(run)
        logger.info("Evaluated %s: train sharpe %.2f, test sharpe %.2f",
                    kind, best_train["sharpe"], test_result.metrics["sharpe"])
    db.commit()
    return runs


def latest_runs_by_strategy(db: Session) -> dict[int, StrategyRun]:
    """Return each strategy's most recent run.

    Args:
        db: Database session.

    Returns:
        dict[int, StrategyRun]: strategy_id -> latest StrategyRun.
    """
    latest: dict[int, StrategyRun] = {}
    for run in db.scalars(select(StrategyRun).order_by(StrategyRun.run_date)):
        latest[run.strategy_id] = run
    return latest


def recommend_strategy(db: Session, risk_level: str,
                       incumbent_id: int | None = None) -> Strategy | None:
    """Pick the best strategy for a risk profile from the latest runs.

    Selection uses out-of-sample (test) Sharpe only. When an incumbent is given,
    a challenger must beat its test Sharpe by CHURN_GUARD_SHARPE to displace it.

    Args:
        db: Database session.
        risk_level: "conservative" | "balanced" | "aggressive".
        incumbent_id: Currently assigned strategy id, if any.

    Returns:
        Strategy | None: The recommended strategy row, or None without runs.
    """
    runs = latest_runs_by_strategy(db)
    if not runs:
        return None
    strategies = {s.id: s for s in db.scalars(select(Strategy))}

    def fitness(strategy_id: int) -> float:
        run = runs[strategy_id]
        sharpe = run.test_metrics.get("sharpe", 0.0)
        # Risk-profile tilt: conservative portfolios penalize drawdown harder.
        dd_penalty = abs(run.test_metrics.get("max_drawdown", 0.0))
        weight = {"conservative": 2.0, "balanced": 1.0, "aggressive": 0.5}[risk_level]
        return sharpe - weight * dd_penalty

    best_id = max(runs, key=fitness)
    if incumbent_id is not None and incumbent_id in runs and best_id != incumbent_id:
        challenger = runs[best_id].test_metrics.get("sharpe", 0.0)
        incumbent = runs[incumbent_id].test_metrics.get("sharpe", 0.0)
        if challenger - incumbent < CHURN_GUARD_SHARPE:
            return strategies[incumbent_id]
    return strategies[best_id]
