# evolution.py — Celery task wrapper for the genetic-algorithm "evolved"
# strategy run (app/strategy/genetic.py), dispatched by POST /strategies/evolve.

from app.core.db import SessionLocal
from app.jobs.celery_app import celery_app
from app.models.strategy import StrategyEvolutionRun
from app.strategy.genetic import EvolutionConfig, run_evolution_and_persist


@celery_app.task(name="app.jobs.evolve_strategy")
def evolve_strategy_task(evolution_run_id: int, options: dict) -> dict:
    """Run the GA for one StrategyEvolutionRun and persist its outcome.

    Args:
        evolution_run_id: Id of the (already persisted) StrategyEvolutionRun.
        options: GA scope, mirroring EvolveRequest fields (population_size,
            generations, risk_weight, max_symbols, symbols).

    Returns:
        dict: {"evolution_run_id": ..., "status": "done"|"failed"}.
    """
    db = SessionLocal()
    try:
        run = db.get(StrategyEvolutionRun, evolution_run_id)
        run.status = "running"
        db.commit()
        config = EvolutionConfig(
            population_size=options["population_size"],
            generations=options["generations"],
            risk_weight=options["risk_weight"],
            max_symbols=options["max_symbols"],
            symbols=options.get("symbols"),
        )
        run_evolution_and_persist(db, run, config)
        return {"evolution_run_id": evolution_run_id, "status": run.status}
    finally:
        db.close()
