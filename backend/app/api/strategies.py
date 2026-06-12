# strategies.py — Strategy Lab endpoints: the strategy library, evaluation runs
# with train/test metrics and equity curves, trade-by-trade drill-down, and the
# manual evaluation trigger (PRD FR-8 / FR-10).

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.strategy import BacktestTrade, Strategy, StrategyRun
from app.schemas.portfolio import BacktestTradeOut, StrategyOut, StrategyRunOut
from app.strategy.evaluator import ensure_strategy_rows, evaluate_all_strategies

router = APIRouter(tags=["strategies"])


class EvaluateRequest(BaseModel):
    """Manual strategy-evaluation trigger parameters."""

    symbols: list[str] | None = None
    max_symbols: int = Field(default=60, ge=5, le=500)


@router.get("/strategies", response_model=list[StrategyOut])
def list_strategies(db: Session = Depends(get_db), _user=Depends(get_current_user)
                    ) -> list[StrategyOut]:
    """List the strategy library (seeding registry rows on first call)."""
    ensure_strategy_rows(db)
    rows = db.scalars(select(Strategy).order_by(Strategy.id))
    return [StrategyOut.model_validate(s) for s in rows]


@router.get("/strategies/{strategy_id}/runs", response_model=list[StrategyRunOut])
def strategy_runs(strategy_id: int, db: Session = Depends(get_db),
                  _user=Depends(get_current_user)) -> list[StrategyRunOut]:
    """List one strategy's evaluation runs, newest first."""
    if db.get(Strategy, strategy_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Strategy not found")
    rows = db.scalars(select(StrategyRun).where(StrategyRun.strategy_id == strategy_id)
                      .order_by(StrategyRun.run_date.desc()).limit(30))
    return [StrategyRunOut.model_validate(r) for r in rows]


@router.get("/strategy-runs/{run_id}", response_model=StrategyRunOut)
def strategy_run(run_id: int, db: Session = Depends(get_db),
                 _user=Depends(get_current_user)) -> StrategyRunOut:
    """Return one evaluation run with metrics and equity curve."""
    run = db.get(StrategyRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    return StrategyRunOut.model_validate(run)


@router.get("/strategy-runs/{run_id}/trades", response_model=list[BacktestTradeOut])
def strategy_run_trades(run_id: int, limit: int = Query(default=500, ge=1, le=2000),
                        db: Session = Depends(get_db),
                        _user=Depends(get_current_user)) -> list[BacktestTradeOut]:
    """Return a run's simulated trades with their triggering signals."""
    if db.get(StrategyRun, run_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    rows = db.scalars(select(BacktestTrade).where(BacktestTrade.strategy_run_id == run_id)
                      .order_by(BacktestTrade.date).limit(limit))
    return [BacktestTradeOut.model_validate(t) for t in rows]


@router.post("/strategies/evaluate", response_model=list[StrategyRunOut])
def evaluate_now(payload: EvaluateRequest, db: Session = Depends(get_db),
                 _user=Depends(get_current_user)) -> list[StrategyRunOut]:
    """Run the 10/2 train-test evaluation for all strategies on demand.

    The weekly job runs the same service; this endpoint lets users re-evaluate
    after loading new data and powers the Strategy Lab refresh button.
    """
    runs = evaluate_all_strategies(db, symbols=payload.symbols,
                                   max_symbols=payload.max_symbols)
    if not runs:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "No instruments with enough history to evaluate")
    return [StrategyRunOut.model_validate(r) for r in runs]
