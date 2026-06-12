# outcomes.py — recommendation outcome tracking (PRD success metrics): fills in
# outcome_30d on month-old recommendations and computes hit-rate statistics so
# users can judge the bot's historical accuracy.

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.jobs.celery_app import celery_app
from app.models.price_bar import PriceBar
from app.models.strategy import PortfolioModel, Recommendation

logger = logging.getLogger(__name__)

OUTCOME_DAYS = 30


def fill_outcomes(db: Session, now: datetime | None = None) -> int:
    """Compute 30-day returns for recommendations that are due.

    For each recommendation older than OUTCOME_DAYS with a reference price and
    no outcome yet, the outcome is the percent move from the recommendation
    price to the first close on/after the 30-day mark (sign-flipped for SELLs,
    so a positive outcome always means "the call was right").

    Args:
        db: Database session (committed).
        now: Clock override for tests.

    Returns:
        int: Number of recommendations updated.
    """
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=OUTCOME_DAYS)
    due = db.scalars(select(Recommendation).where(
        Recommendation.outcome_30d.is_(None),
        Recommendation.price_at_recommendation.is_not(None),
        Recommendation.created_at <= cutoff,
        Recommendation.action.in_(("BUY", "SELL")))).all()
    updated = 0
    for rec in due:
        target_date = (rec.created_at + timedelta(days=OUTCOME_DAYS)).date()
        close = db.scalar(
            select(PriceBar.close)
            .where(PriceBar.instrument_id == rec.instrument_id,
                   PriceBar.date >= target_date)
            .order_by(PriceBar.date).limit(1))
        if close is None:
            continue  # not enough forward data yet; retry next run
        move = (close / rec.price_at_recommendation - 1) * 100
        rec.outcome_30d = round(move if rec.action == "BUY" else -move, 2)
        updated += 1
    db.commit()
    logger.info("Outcome tracker updated %d recommendations", updated)
    return updated


def hit_rate_stats(db: Session, user_id: int) -> dict:
    """Summarize recommendation accuracy for one user's portfolios.

    Args:
        db: Database session.
        user_id: Owner of the portfolios to aggregate.

    Returns:
        dict: {evaluated, hits, hit_rate, avg_return} over recommendations with
        a filled outcome_30d; zeros when nothing is evaluated yet.
    """
    portfolio_ids = [p.id for p in db.scalars(
        select(PortfolioModel).where(PortfolioModel.user_id == user_id))]
    if not portfolio_ids:
        return {"evaluated": 0, "hits": 0, "hit_rate": 0.0, "avg_return": 0.0}
    outcomes = [r for (r,) in db.execute(
        select(Recommendation.outcome_30d).where(
            Recommendation.portfolio_id.in_(portfolio_ids),
            Recommendation.outcome_30d.is_not(None)))]
    if not outcomes:
        return {"evaluated": 0, "hits": 0, "hit_rate": 0.0, "avg_return": 0.0}
    hits = sum(1 for o in outcomes if o > 0)
    return {"evaluated": len(outcomes), "hits": hits,
            "hit_rate": round(hits / len(outcomes), 3),
            "avg_return": round(sum(outcomes) / len(outcomes), 2)}


@celery_app.task(name="app.jobs.outcome_tracker")
def outcome_tracker() -> dict:
    """Daily Celery task wrapping fill_outcomes.

    Returns:
        dict: {"updated": n}.
    """
    db = SessionLocal()
    try:
        return {"updated": fill_outcomes(db)}
    finally:
        db.close()
