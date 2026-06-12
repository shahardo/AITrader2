# engine.py — recommendation engine: builds the initial portfolio proposal at
# onboarding (PRD FR-6) and the daily BUY/SELL recommendations per portfolio
# (FR-7), with LLM-written rationales and risk-profile position sizing.

import logging
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analysis.service import load_ohlcv
from app.llm.provider import LLMProvider, LLMUnavailable, ModelTier
from app.models.analysis import StockScore
from app.models.instrument import Instrument
from app.models.strategy import Holding, PortfolioModel, Recommendation, Strategy
from app.models.user import RiskLevel, User
from app.portfolio.service import execute_paper_trade, latest_close
from app.strategy.base import build_features
from app.strategy.library import make_strategy

logger = logging.getLogger(__name__)

# Dev plan §5.5: per-position weight caps by risk profile.
MAX_WEIGHT = {RiskLevel.conservative: 0.08, RiskLevel.balanced: 0.12,
              RiskLevel.aggressive: 0.20}
INITIAL_POSITIONS = {RiskLevel.conservative: 12, RiskLevel.balanced: 10,
                     RiskLevel.aggressive: 8}
TOP_CANDIDATES = 25  # daily BUY candidates considered per portfolio
MIN_PROPOSAL_SCORE = 50.0  # initial proposals never include below-neutral stocks


def _explain(llm: LLMProvider, action: str, symbol: str, context: str) -> str:
    """Ask the LLM for a one-paragraph rationale, with a deterministic fallback.

    Args:
        llm: LLM provider.
        action: BUY/SELL/HOLD.
        symbol: Ticker.
        context: Key signals serialized for the prompt.

    Returns:
        str: Rationale text (LLM-written or fallback).
    """
    try:
        result = llm.complete(
            "recommend.explain",
            "You are an investment analyst writing for a retail user. In 2-3 plain "
            "sentences, explain the recommendation based ONLY on the given signals. "
            'Respond as JSON: {"explanation": "..."}.',
            f"Recommendation: {action} {symbol}\nSignals: {context}",
            tier=ModelTier.deep, max_tokens=300)
        if result.parsed and result.parsed.get("explanation"):
            return str(result.parsed["explanation"])[:2000]
    except LLMUnavailable:
        pass
    return f"{action} {symbol} based on signals: {context}"


def _top_scored(db: Session, exclude_ids: set[int], limit: int) -> list[tuple]:
    """Return top-ranked (StockScore, Instrument) pairs from the latest scores.

    Args:
        db: Database session.
        exclude_ids: Instrument ids to skip (already held).
        limit: Maximum rows.

    Returns:
        list[tuple]: (StockScore, Instrument), best combined score first.
    """
    latest_date = db.scalar(select(func.max(StockScore.date)))
    if latest_date is None:
        return []
    stmt = (
        select(StockScore, Instrument)
        .join(Instrument, Instrument.id == StockScore.instrument_id)
        .where(StockScore.date == latest_date, Instrument.is_active.is_(True))
        .order_by(StockScore.combined_score.desc()).limit(limit + len(exclude_ids))
    )
    return [(s, i) for s, i in db.execute(stmt) if i.id not in exclude_ids][:limit]


def propose_initial_portfolio(db: Session, llm: LLMProvider, user: User,
                              portfolio: PortfolioModel) -> list[Recommendation]:
    """Build the onboarding BUY proposal from the latest universe scores.

    Positions are equal-weighted across the profile's target count, capped by
    MAX_WEIGHT. Recommendations are persisted as pending "initial" rows that the
    user approves before any paper trade happens.

    Args:
        db: Database session (committed).
        llm: LLM provider for rationales.
        user: Portfolio owner (risk profile source).
        portfolio: Freshly created portfolio with full cash.

    Returns:
        list[Recommendation]: Pending initial recommendations (may be empty when
        no scores exist yet).
    """
    count = INITIAL_POSITIONS[user.risk_level]
    weight = min(1.0 / count, MAX_WEIGHT[user.risk_level])
    proposals: list[Recommendation] = []
    for score, inst in _top_scored(db, exclude_ids=set(), limit=count):
        if score.combined_score < MIN_PROPOSAL_SCORE:
            continue
        price = latest_close(db, inst.id)
        if not price:
            continue
        qty = int(portfolio.initial_capital * weight / price)
        if qty < 1:
            continue
        context = (f"combined score {score.combined_score}, technical "
                   f"{score.technical_score}, sentiment {score.sentiment_score}")
        rec = Recommendation(
            portfolio_id=portfolio.id, instrument_id=inst.id, action="BUY", qty=qty,
            confidence=min(1.0, score.combined_score / 100),
            signals={"combined_score": score.combined_score,
                     "technical_score": score.technical_score,
                     "sentiment_score": score.sentiment_score},
            explanation=_explain(llm, "BUY", inst.symbol, context),
            kind="initial", price_at_recommendation=price)
        db.add(rec)
        proposals.append(rec)
    db.commit()
    return proposals


def generate_daily_recommendations(db: Session, llm: LLMProvider, user: User,
                                   portfolio: PortfolioModel,
                                   as_of: date | None = None) -> list[Recommendation]:
    """Produce today's SELL/BUY recommendations for one portfolio (PRD FR-7).

    Holdings are checked against the portfolio's strategy exit rule; BUY
    candidates come from the latest score leaderboard filtered through the
    strategy entry rule. Auto-execute portfolios trade immediately at the last
    close; others wait for user approval.

    Args:
        db: Database session (committed).
        llm: LLM provider for rationales.
        user: Portfolio owner.
        portfolio: Target portfolio.
        as_of: Decision date (defaults to today).

    Returns:
        list[Recommendation]: Newly created recommendations.
    """
    strategy_row = db.get(Strategy, portfolio.strategy_id) if portfolio.strategy_id else None
    if strategy_row is None:
        logger.info("Portfolio %s has no strategy; skipping daily recs", portfolio.id)
        return []
    strategy = make_strategy(strategy_row.kind, strategy_row.params)
    recs: list[Recommendation] = []

    # SELL pass over holdings.
    holdings = list(db.scalars(select(Holding).where(Holding.portfolio_id == portfolio.id)))
    held_ids = {h.instrument_id for h in holdings}
    for holding in holdings:
        df = load_ohlcv(db, holding.instrument_id)
        if len(df) < 60:
            continue
        decision = strategy.decide(build_features(df), len(df) - 1, holding=True)
        if decision.action != "SELL":
            continue
        inst = db.get(Instrument, holding.instrument_id)
        price = latest_close(db, inst.id)
        rec = Recommendation(
            portfolio_id=portfolio.id, instrument_id=inst.id, action="SELL",
            qty=holding.qty, confidence=0.7, signals=decision.reasons or {},
            explanation=_explain(llm, "SELL", inst.symbol, str(decision.reasons)),
            price_at_recommendation=price)
        db.add(rec)
        recs.append(rec)

    # BUY pass over top-scored non-held candidates passing the entry rule.
    total_value = portfolio.cash  # sizing base: cash only (conservative)
    for score, inst in _top_scored(db, exclude_ids=held_ids, limit=TOP_CANDIDATES):
        df = load_ohlcv(db, inst.id)
        if len(df) < 60:
            continue
        decision = strategy.decide(build_features(df), len(df) - 1, holding=False)
        if decision.action != "BUY":
            continue
        price = latest_close(db, inst.id)
        if not price:
            continue
        qty = int(total_value * MAX_WEIGHT[user.risk_level] / price)
        if qty < 1 or qty * price > portfolio.cash:
            continue
        merged_signals = {**(decision.reasons or {}), "combined_score": score.combined_score}
        rec = Recommendation(
            portfolio_id=portfolio.id, instrument_id=inst.id, action="BUY", qty=qty,
            confidence=min(1.0, score.combined_score / 100),
            signals=merged_signals,
            explanation=_explain(llm, "BUY", inst.symbol, str(merged_signals)),
            price_at_recommendation=price)
        db.add(rec)
        recs.append(rec)

    db.flush()
    if portfolio.auto_execute:
        for rec in recs:
            apply_recommendation(db, portfolio, rec)
    db.commit()
    return recs


def apply_recommendation(db: Session, portfolio: PortfolioModel,
                         rec: Recommendation) -> bool:
    """Execute one recommendation as a paper trade at its reference price.

    Args:
        db: Database session (flushed, not committed).
        portfolio: Owning portfolio.
        rec: The recommendation to execute.

    Returns:
        bool: True when executed; False when skipped (no price / trade error).
    """
    price = rec.price_at_recommendation or latest_close(db, rec.instrument_id)
    if not price or rec.action not in ("BUY", "SELL"):
        rec.status = "expired"
        return False
    from app.portfolio.service import TradeError

    try:
        trade = execute_paper_trade(db, portfolio, rec.instrument_id, rec.action,
                                    rec.qty, price, recommendation_id=rec.id)
    except TradeError as exc:
        logger.warning("Recommendation %s not executed: %s", rec.id, exc)
        rec.status = "expired"
        return False
    rec.status = "executed"
    return trade is not None
