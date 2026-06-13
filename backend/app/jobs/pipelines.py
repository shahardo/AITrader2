# pipelines.py — Celery tasks for the scheduled pipelines: nightly data refresh +
# analysis + per-portfolio recommendations, and the weekly strategy re-evaluation
# with per-portfolio reassignment (dev plan §7).

import logging
from datetime import date

from sqlalchemy import select

from app.core.db import SessionLocal
from app.jobs.celery_app import celery_app
from app.llm.groq_provider import build_default_provider
from app.marketdata.service import sync_price_history
from app.marketdata.yfinance_provider import YFinanceProvider
from app.models.instrument import Instrument
from app.models.strategy import PortfolioModel, StrategyEvolutionRun
from app.models.user import StrategySwitchMode, User
from app.notify.service import complete_telegram_links, notify
from app.recommend.engine import generate_daily_recommendations
from app.sentiment.sources import default_sources
from app.strategy.evaluator import evaluate_all_strategies, recommend_strategy
from app.strategy.genetic import EvolutionConfig, run_evolution_and_persist

logger = logging.getLogger(__name__)


@celery_app.task(name="app.jobs.daily_pipeline")
def daily_pipeline(with_sentiment: bool = True) -> dict:
    """Nightly job: refresh, analyze, recommend.

    Refreshes prices, re-analyzes the universe, and generates per-portfolio
    recommendations (auto-executing where enabled).

    Args:
        with_sentiment: Disable to run technical-only (faster/dev).

    Returns:
        dict: Run summary counts.
    """
    from app.analysis.service import run_analysis

    db = SessionLocal()
    try:
        instruments = list(db.scalars(
            select(Instrument).where(Instrument.is_active.is_(True))))
        synced = sync_price_history(db, YFinanceProvider(), instruments)
        llm = build_default_provider()
        scores = run_analysis(db, llm, default_sources(), instruments,
                              with_sentiment=with_sentiment)
        complete_telegram_links(db)
        rec_count = 0
        portfolios = db.scalars(select(PortfolioModel)).all()
        for portfolio in portfolios:
            user = db.get(User, portfolio.user_id)
            recs = generate_daily_recommendations(db, llm, user, portfolio)
            rec_count += len(recs)
            if recs:
                lines = [f"{r.action} {db.get(Instrument, r.instrument_id).symbol} "
                         f"× {r.qty:g} ({r.status})" for r in recs]
                notify(db, user, "daily_recs",
                       f"{len(recs)} recommendation(s) for '{portfolio.name}'",
                       "\n".join(lines))
        db.commit()
        summary = {"synced_symbols": len(synced), "analyzed": len(scores),
                   "portfolios": len(portfolios), "recommendations": rec_count}
        logger.info("Daily pipeline done: %s", summary)
        return summary
    finally:
        db.close()


@celery_app.task(name="app.jobs.weekly_strategy")
def weekly_strategy() -> dict:
    """Weekly job: 10/2 strategy re-evaluation.

    Re-runs the train-test evaluation, then runs a genetic-algorithm pass to
    refresh the "evolved" strategy's gene (failures here are logged but never
    block portfolio reassignment), and finally reassigns portfolio strategies
    (auto mode applies immediately; approve mode leaves the assignment
    untouched and the recommendation surfaces in the Strategy Lab).

    Returns:
        dict: Run summary counts.
    """
    db = SessionLocal()
    try:
        runs = evaluate_all_strategies(db, as_of=date.today())

        evo_run = StrategyEvolutionRun(status="running", population_size=50, generations=30,
                                       risk_weight=1.0, max_symbols=25, triggered_by="weekly")
        db.add(evo_run)
        db.commit()
        try:
            run_evolution_and_persist(db, evo_run, EvolutionConfig())
        except Exception:
            logger.exception("Weekly GA evolution failed")

        switched = 0
        for portfolio in db.scalars(select(PortfolioModel)).all():
            user = db.get(User, portfolio.user_id)
            best = recommend_strategy(db, user.risk_level.value, portfolio.strategy_id)
            if best is None or best.id == portfolio.strategy_id:
                continue
            if user.strategy_switch_mode == StrategySwitchMode.auto:
                portfolio.strategy_id = best.id
                switched += 1
                notify(db, user, "strategy_change",
                       f"Strategy switched to {best.name} for '{portfolio.name}'",
                       "Weekly out-of-sample evaluation found a better fit "
                       "(see the Strategy Lab for the full run).")
            else:
                notify(db, user, "strategy_change",
                       f"Suggested strategy for '{portfolio.name}': {best.name}",
                       "Approve by assigning it on the Portfolios page; details "
                       "in the Strategy Lab.")
        db.commit()
        summary = {"runs": len(runs), "switched_portfolios": switched}
        logger.info("Weekly strategy done: %s", summary)
        return summary
    finally:
        db.close()
