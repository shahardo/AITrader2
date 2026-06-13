# strategies.py — Strategy Lab endpoints: the strategy library, evaluation runs
# with train/test metrics and equity curves, trade-by-trade drill-down, and the
# manual evaluation trigger (PRD FR-8 / FR-10).

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.jobs.evolution import evolve_strategy_task
from app.models.strategy import BacktestTrade, Strategy, StrategyEvolutionRun, StrategyRun
from app.schemas.portfolio import (
    BacktestTradeOut,
    StrategyEvolutionRunOut,
    StrategyOut,
    StrategyRunOut,
)
from app.strategy.evaluator import ensure_strategy_rows, evaluate_all_strategies

router = APIRouter(tags=["strategies"])


class EvaluateRequest(BaseModel):
    """Manual strategy-evaluation trigger parameters."""

    symbols: list[str] | None = None
    max_symbols: int = Field(default=60, ge=5, le=500)


class EvolveRequest(BaseModel):
    """Manual genetic-algorithm evolution trigger parameters.

    Caps keep a manual run within a reasonable runtime; defaults match
    EvolutionConfig's "larger & thorough" budget.
    """

    population_size: int = Field(default=50, ge=10, le=200)
    generations: int = Field(default=30, ge=5, le=100)
    risk_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    max_symbols: int = Field(default=25, ge=5, le=60)
    symbols: list[str] | None = None


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


@router.post("/strategies/evolve", response_model=StrategyEvolutionRunOut,
             status_code=status.HTTP_202_ACCEPTED)
def evolve_now(payload: EvolveRequest, db: Session = Depends(get_db),
              _user=Depends(get_current_user)) -> StrategyEvolutionRunOut:
    """Start a genetic-algorithm run that evolves the 'evolved' strategy's gene.

    Dispatches an async Celery task; poll the returned run's id via
    GET /strategy-evolution-runs/{id} for progress.
    """
    run = StrategyEvolutionRun(
        status="pending", triggered_by="manual",
        population_size=payload.population_size, generations=payload.generations,
        risk_weight=payload.risk_weight, max_symbols=payload.max_symbols,
    )
    db.add(run)
    db.commit()
    evolve_strategy_task.delay(run.id, payload.model_dump())
    return StrategyEvolutionRunOut.model_validate(run)


@router.get("/strategy-evolution-runs", response_model=list[StrategyEvolutionRunOut])
def list_evolution_runs(db: Session = Depends(get_db),
                        _user=Depends(get_current_user)) -> list[StrategyEvolutionRunOut]:
    """List genetic-algorithm evolution runs, newest first."""
    rows = db.scalars(select(StrategyEvolutionRun)
                      .order_by(StrategyEvolutionRun.started_at.desc()).limit(20))
    return [StrategyEvolutionRunOut.model_validate(r) for r in rows]


@router.get("/strategy-evolution-runs/{run_id}", response_model=StrategyEvolutionRunOut)
def get_evolution_run(run_id: int, db: Session = Depends(get_db),
                      _user=Depends(get_current_user)) -> StrategyEvolutionRunOut:
    """Return one evolution run's status and progress, for polling."""
    run = db.get(StrategyEvolutionRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evolution run not found")
    return StrategyEvolutionRunOut.model_validate(run)
