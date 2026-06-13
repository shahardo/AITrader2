# portfolios.py — portfolio endpoints: CRUD for multiple paper portfolios,
# holdings detail, performance curves and cross-portfolio comparison, the
# onboarding initial proposal, and the recommendations feed with approve/reject.

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.llm.groq_provider import build_default_provider
from app.models.instrument import Instrument
from app.models.strategy import Holding, PortfolioModel, Recommendation, Strategy
from app.models.user import User
from app.portfolio.service import equity_curve, latest_close, portfolio_value
from app.recommend.engine import (
    apply_recommendation,
    generate_daily_recommendations,
    propose_initial_portfolio,
)
from app.schemas.portfolio import (
    EquityPoint,
    HoldingOut,
    PerformanceOut,
    PortfolioCreate,
    PortfolioDetail,
    PortfolioOut,
    PortfolioUpdate,
    RecommendationOut,
)

router = APIRouter(tags=["portfolios"])


def _own_portfolio(db: Session, user: User, portfolio_id: int) -> PortfolioModel:
    """Fetch a portfolio owned by the user or raise 404.

    Args:
        db: Database session.
        user: Authenticated user.
        portfolio_id: Target portfolio id.

    Returns:
        PortfolioModel: The owned portfolio.

    Raises:
        HTTPException: 404 when missing or owned by someone else.
    """
    portfolio = db.get(PortfolioModel, portfolio_id)
    if portfolio is None or portfolio.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Portfolio not found")
    return portfolio


def _to_out(db: Session, portfolio: PortfolioModel) -> PortfolioOut:
    """Build the summary schema with valuation and strategy name."""
    out = PortfolioOut.model_validate(portfolio)
    out.value = portfolio_value(db, portfolio)
    out.pnl_pct = round(100 * (out.value / portfolio.initial_capital - 1), 2)
    if portfolio.strategy_id:
        strategy = db.get(Strategy, portfolio.strategy_id)
        out.strategy_name = strategy.name if strategy else None
    return out


@router.get("/portfolios", response_model=list[PortfolioOut])
def list_portfolios(db: Session = Depends(get_db), user: User = Depends(get_current_user)
                    ) -> list[PortfolioOut]:
    """List the user's portfolios with live valuations."""
    rows = db.scalars(select(PortfolioModel).where(PortfolioModel.user_id == user.id)
                      .order_by(PortfolioModel.id))
    return [_to_out(db, p) for p in rows]


@router.post("/portfolios", response_model=PortfolioOut, status_code=status.HTTP_201_CREATED)
def create_portfolio(payload: PortfolioCreate, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)) -> PortfolioOut:
    """Create a paper portfolio (PRD FR-9: users may hold several)."""
    if payload.strategy_id is not None and db.get(Strategy, payload.strategy_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown strategy")
    portfolio = PortfolioModel(user_id=user.id, name=payload.name,
                               strategy_id=payload.strategy_id,
                               initial_capital=payload.initial_capital,
                               cash=payload.initial_capital,
                               auto_execute=payload.auto_execute)
    db.add(portfolio)
    db.commit()
    db.refresh(portfolio)
    return _to_out(db, portfolio)


@router.get("/portfolios/{portfolio_id}", response_model=PortfolioDetail)
def get_portfolio(portfolio_id: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)) -> PortfolioDetail:
    """Return one portfolio with holdings marked to market."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    detail = PortfolioDetail(**_to_out(db, portfolio).model_dump())
    rows = db.execute(
        select(Holding, Instrument)
        .join(Instrument, Instrument.id == Holding.instrument_id)
        .where(Holding.portfolio_id == portfolio.id)).all()
    for holding, inst in rows:
        px = latest_close(db, inst.id)
        detail.holdings.append(HoldingOut(
            symbol=inst.symbol, name=inst.name, qty=holding.qty, avg_cost=holding.avg_cost,
            last_close=px, market_value=round(holding.qty * px, 2) if px else None,
            pnl_pct=round(100 * (px / holding.avg_cost - 1), 2) if px else None))
    return detail


@router.patch("/portfolios/{portfolio_id}", response_model=PortfolioOut)
def update_portfolio(portfolio_id: int, payload: PortfolioUpdate,
                     db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)) -> PortfolioOut:
    """Update name/strategy/auto-execute on an owned portfolio."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    data = payload.model_dump(exclude_unset=True)
    if "strategy_id" in data and data["strategy_id"] is not None:
        if db.get(Strategy, data["strategy_id"]) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown strategy")
    for field, value in data.items():
        setattr(portfolio, field, value)
    db.commit()
    db.refresh(portfolio)
    return _to_out(db, portfolio)


@router.delete("/portfolios/{portfolio_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_portfolio(portfolio_id: int, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)) -> None:
    """Delete an owned portfolio and its ledger."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    db.delete(portfolio)
    db.commit()


@router.get("/portfolios/{portfolio_id}/performance", response_model=PerformanceOut)
def portfolio_performance(portfolio_id: int, days: int = Query(default=365, ge=7, le=1500),
                          db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)) -> PerformanceOut:
    """Return the reconstructed equity curve for one portfolio."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    curve = equity_curve(db, portfolio, days=days)
    return PerformanceOut(portfolio_id=portfolio.id, name=portfolio.name,
                          curve=[EquityPoint(date=d, value=v) for d, v in curve])


@router.get("/portfolios-compare", response_model=list[PerformanceOut])
def compare_portfolios(ids: str = Query(description="comma-separated portfolio ids"),
                       db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)) -> list[PerformanceOut]:
    """Return equity curves for several owned portfolios (comparison chart)."""
    out: list[PerformanceOut] = []
    for raw in ids.split(","):
        if not raw.strip().isdigit():
            continue
        portfolio = _own_portfolio(db, user, int(raw))
        curve = equity_curve(db, portfolio)
        out.append(PerformanceOut(portfolio_id=portfolio.id, name=portfolio.name,
                                  curve=[EquityPoint(date=d, value=v) for d, v in curve]))
    return out


def _rec_out(db: Session, rec: Recommendation) -> RecommendationOut:
    """Map a Recommendation row to its API schema."""
    inst = db.get(Instrument, rec.instrument_id)
    return RecommendationOut(
        id=rec.id, portfolio_id=rec.portfolio_id, symbol=inst.symbol,
        instrument_name=inst.name, action=rec.action, qty=rec.qty,
        confidence=rec.confidence, signals=rec.signals, explanation=rec.explanation,
        kind=rec.kind, status=rec.status,
        price_at_recommendation=rec.price_at_recommendation, created_at=rec.created_at)


@router.post("/portfolios/{portfolio_id}/initial-proposal",
             response_model=list[RecommendationOut])
def initial_proposal(portfolio_id: int, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)) -> list[RecommendationOut]:
    """Generate the onboarding portfolio proposal (pending BUY recommendations)."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    pending = db.scalars(select(Recommendation).where(
        Recommendation.portfolio_id == portfolio.id,
        Recommendation.kind == "initial", Recommendation.status == "pending")).all()
    if pending:
        return [_rec_out(db, r) for r in pending]
    recs = propose_initial_portfolio(db, build_default_provider(), user, portfolio)
    if not recs:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "No universe scores yet — run an analysis first")
    return [_rec_out(db, r) for r in recs]


@router.post("/portfolios/{portfolio_id}/initial-proposal/approve",
             response_model=list[RecommendationOut])
def approve_initial_proposal(portfolio_id: int, db: Session = Depends(get_db),
                             user: User = Depends(get_current_user)
                             ) -> list[RecommendationOut]:
    """Approve the pending initial proposal: executes all its BUYs as paper trades."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    pending = db.scalars(select(Recommendation).where(
        Recommendation.portfolio_id == portfolio.id,
        Recommendation.kind == "initial", Recommendation.status == "pending")).all()
    if not pending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No pending initial proposal")
    for rec in pending:
        apply_recommendation(db, portfolio, rec)
    db.commit()
    return [_rec_out(db, r) for r in pending]


@router.get("/recommendations", response_model=list[RecommendationOut])
def list_recommendations(portfolio_id: int, rec_status: str | None = Query(default=None),
                         db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)
                         ) -> list[RecommendationOut]:
    """List a portfolio's recommendations, newest first."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    stmt = select(Recommendation).where(Recommendation.portfolio_id == portfolio.id)
    if rec_status:
        stmt = stmt.where(Recommendation.status == rec_status)
    rows = db.scalars(stmt.order_by(Recommendation.created_at.desc()).limit(200))
    return [_rec_out(db, r) for r in rows]


@router.post("/recommendations/{rec_id}/approve", response_model=RecommendationOut)
def approve_recommendation(rec_id: int, db: Session = Depends(get_db),
                           user: User = Depends(get_current_user)) -> RecommendationOut:
    """Approve a pending recommendation and execute it as a paper trade."""
    rec = db.get(Recommendation, rec_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found")
    portfolio = _own_portfolio(db, user, rec.portfolio_id)
    if rec.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Recommendation is {rec.status}")
    apply_recommendation(db, portfolio, rec)
    db.commit()
    return _rec_out(db, rec)


@router.post("/recommendations/{rec_id}/reject", response_model=RecommendationOut)
def reject_recommendation(rec_id: int, db: Session = Depends(get_db),
                          user: User = Depends(get_current_user)) -> RecommendationOut:
    """Reject a pending recommendation."""
    rec = db.get(Recommendation, rec_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recommendation not found")
    _own_portfolio(db, user, rec.portfolio_id)
    if rec.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Recommendation is {rec.status}")
    rec.status = "rejected"
    db.commit()
    return _rec_out(db, rec)


@router.post("/portfolios/{portfolio_id}/recommendations/generate",
             response_model=list[RecommendationOut])
def generate_recommendations_now(portfolio_id: int, db: Session = Depends(get_db),
                                 user: User = Depends(get_current_user)
                                 ) -> list[RecommendationOut]:
    """Run the daily recommendation pass for one portfolio on demand."""
    portfolio = _own_portfolio(db, user, portfolio_id)
    if portfolio.strategy_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Portfolio has no strategy assigned — assign one in the Strategy Lab")
    recs = generate_daily_recommendations(db, build_default_provider(), user, portfolio)
    return [_rec_out(db, r) for r in recs]
