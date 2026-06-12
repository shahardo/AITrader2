# service.py — paper portfolio operations: trade execution against the virtual
# ledger (cash/holdings invariants), valuation, and equity-curve reconstruction
# from the immutable trade history.

import logging
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.price_bar import PriceBar
from app.models.strategy import Holding, PortfolioModel, TradeModel

logger = logging.getLogger(__name__)


class TradeError(ValueError):
    """Raised when a paper trade violates ledger invariants (cash/qty)."""


def execute_paper_trade(
    db: Session,
    portfolio: PortfolioModel,
    instrument_id: int,
    side: str,
    qty: float,
    price: float,
    recommendation_id: int | None = None,
    executed_at: datetime | None = None,
) -> TradeModel:
    """Execute one paper trade, updating cash and holdings atomically.

    Args:
        db: Database session (flushed, not committed).
        portfolio: Target portfolio.
        instrument_id: Traded instrument.
        side: "BUY" or "SELL".
        qty: Share count (positive).
        price: Fill price per share.
        recommendation_id: Originating recommendation, if any.
        executed_at: Fill timestamp override.

    Returns:
        TradeModel: The persisted ledger row.

    Raises:
        TradeError: On insufficient cash (BUY) or shares (SELL), or bad input.
    """
    if qty <= 0 or price <= 0:
        raise TradeError("qty and price must be positive")
    holding = db.scalar(select(Holding).where(
        Holding.portfolio_id == portfolio.id, Holding.instrument_id == instrument_id))
    if side == "BUY":
        cost = qty * price
        if cost > portfolio.cash + 1e-6:
            raise TradeError(f"Insufficient cash: need {cost:.2f}, have {portfolio.cash:.2f}")
        portfolio.cash -= cost
        if holding is None:
            db.add(Holding(portfolio_id=portfolio.id, instrument_id=instrument_id,
                           qty=qty, avg_cost=price))
        else:
            total_cost = holding.avg_cost * holding.qty + cost
            holding.qty += qty
            holding.avg_cost = total_cost / holding.qty
    elif side == "SELL":
        if holding is None or holding.qty < qty - 1e-9:
            raise TradeError("Insufficient shares to sell")
        portfolio.cash += qty * price
        holding.qty -= qty
        if holding.qty <= 1e-9:
            db.delete(holding)
    else:
        raise TradeError(f"Unknown side: {side}")
    trade = TradeModel(portfolio_id=portfolio.id, instrument_id=instrument_id, side=side,
                       qty=qty, price=price, recommendation_id=recommendation_id,
                       **({"executed_at": executed_at} if executed_at else {}))
    db.add(trade)
    db.flush()
    return trade


def latest_close(db: Session, instrument_id: int, on_or_before: date | None = None
                 ) -> float | None:
    """Return the most recent close for an instrument.

    Args:
        db: Database session.
        instrument_id: Target instrument.
        on_or_before: Optional date cap.

    Returns:
        float | None: Close price, or None with no bars.
    """
    stmt = select(PriceBar.close).where(PriceBar.instrument_id == instrument_id)
    if on_or_before:
        stmt = stmt.where(PriceBar.date <= on_or_before)
    return db.scalar(stmt.order_by(PriceBar.date.desc()).limit(1))


def portfolio_value(db: Session, portfolio: PortfolioModel,
                    as_of: date | None = None) -> float:
    """Mark a portfolio to market: cash plus holdings at latest closes.

    Args:
        db: Database session.
        portfolio: Target portfolio.
        as_of: Valuation date cap (defaults to latest data).

    Returns:
        float: Total portfolio value.
    """
    value = portfolio.cash
    holdings = db.scalars(select(Holding).where(Holding.portfolio_id == portfolio.id))
    for h in holdings:
        px = latest_close(db, h.instrument_id, as_of)
        value += h.qty * (px if px is not None else h.avg_cost)
    return round(value, 2)


def equity_curve(db: Session, portfolio: PortfolioModel, days: int = 365
                 ) -> list[tuple[date, float]]:
    """Reconstruct the daily equity curve by replaying trades against price bars.

    Args:
        db: Database session.
        portfolio: Target portfolio.
        days: Window length ending today.

    Returns:
        list[tuple[date, float]]: (date, value) points from portfolio creation
        (or window start) to the latest priced day.
    """
    trades = list(db.scalars(
        select(TradeModel).where(TradeModel.portfolio_id == portfolio.id)
        .order_by(TradeModel.executed_at)))
    anchor = portfolio.created_at.date()
    if trades:  # curve must cover the earliest activity
        anchor = min(anchor, trades[0].executed_at.date())
    start = max(anchor, date.today() - timedelta(days=days))
    instrument_ids = {t.instrument_id for t in trades}

    bars: dict[int, dict[date, float]] = {}
    all_dates: set[date] = set()
    for iid in instrument_ids:
        rows = db.execute(
            select(PriceBar.date, PriceBar.close)
            .where(PriceBar.instrument_id == iid, PriceBar.date >= start)).all()
        bars[iid] = {d: c for d, c in rows}
        all_dates.update(bars[iid])
    if not all_dates:  # no trades yet: flat cash line for the window so far
        return [(start, portfolio.initial_capital), (date.today(), portfolio.cash)]

    cash = portfolio.initial_capital
    positions: dict[int, float] = {}
    trade_idx = 0
    curve: list[tuple[date, float]] = []
    last_price: dict[int, float] = {}
    for day in sorted(all_dates):
        while trade_idx < len(trades) and trades[trade_idx].executed_at.date() <= day:
            t = trades[trade_idx]
            if t.side == "BUY":
                cash -= t.qty * t.price
                positions[t.instrument_id] = positions.get(t.instrument_id, 0) + t.qty
            else:
                cash += t.qty * t.price
                positions[t.instrument_id] = positions.get(t.instrument_id, 0) - t.qty
            trade_idx += 1
        value = cash
        for iid, qty in positions.items():
            if qty <= 0:
                continue
            px = bars.get(iid, {}).get(day)
            if px is not None:
                last_price[iid] = px
            value += qty * last_price.get(iid, 0.0)
        curve.append((day, round(value, 2)))
    return curve
