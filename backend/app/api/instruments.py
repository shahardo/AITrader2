# instruments.py — universe browser endpoints: list instruments with latest-price
# summaries, and per-symbol detail with price history for charting.

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.marketdata.yfinance_provider import YFinanceProvider
from app.models.instrument import Exchange, Instrument
from app.models.price_bar import PriceBar
from app.schemas.instrument import InstrumentDetail, InstrumentOut, PriceBarOut

router = APIRouter(prefix="/instruments", tags=["instruments"])


def _latest_bar_summary(db: Session, instrument_ids: list[int]) -> dict[int, tuple]:
    """Fetch last close/date and bar counts for a set of instruments in two queries.

    Args:
        db: Database session.
        instrument_ids: Instruments to summarize.

    Returns:
        dict[int, tuple]: instrument_id -> (last_close, last_date, bar_count).
    """
    if not instrument_ids:
        return {}
    counts = dict(
        db.execute(
            select(PriceBar.instrument_id, func.count())
            .where(PriceBar.instrument_id.in_(instrument_ids))
            .group_by(PriceBar.instrument_id)
        ).all()
    )
    latest_date = (
        select(PriceBar.instrument_id, func.max(PriceBar.date).label("max_date"))
        .where(PriceBar.instrument_id.in_(instrument_ids))
        .group_by(PriceBar.instrument_id)
        .subquery()
    )
    latest_rows = db.execute(
        select(PriceBar.instrument_id, PriceBar.close, PriceBar.date).join(
            latest_date,
            (PriceBar.instrument_id == latest_date.c.instrument_id)
            & (PriceBar.date == latest_date.c.max_date),
        )
    ).all()
    summary: dict[int, tuple] = {}
    for iid, close, bar_date in latest_rows:
        summary[iid] = (close, bar_date, counts.get(iid, 0))
    return summary


@router.get("", response_model=list[InstrumentOut])
def list_instruments(
    exchange: Exchange | None = None,
    search: str | None = Query(default=None, max_length=50),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> list[InstrumentOut]:
    """List active universe instruments with latest-price summaries.

    Args:
        exchange: Optional exchange filter (us/tase).
        search: Optional case-insensitive match against symbol or name.
        db: Request-scoped database session.
        _user: Authenticated user (authorization only).

    Returns:
        list[InstrumentOut]: Instruments ordered by symbol.
    """
    stmt = select(Instrument).where(Instrument.is_active.is_(True))
    if exchange is not None:
        stmt = stmt.where(Instrument.exchange == exchange)
    if search:
        pattern = f"%{search.lower()}%"
        stmt = stmt.where(
            func.lower(Instrument.symbol).like(pattern) | func.lower(Instrument.name).like(pattern)
        )
    instruments = list(db.scalars(stmt.order_by(Instrument.symbol)))
    summaries = _latest_bar_summary(db, [i.id for i in instruments])
    out: list[InstrumentOut] = []
    for inst in instruments:
        row = InstrumentOut.model_validate(inst)
        if inst.id in summaries:
            row.last_close, row.last_date, row.bar_count = summaries[inst.id]
        out.append(row)
    return out


@router.get("/{symbol}", response_model=InstrumentDetail)
def get_instrument(
    symbol: str,
    days: int = Query(default=365, ge=1, le=2000),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
) -> InstrumentDetail:
    """Return one instrument with its recent daily bars for charting.

    Args:
        symbol: Instrument symbol (case-insensitive).
        days: Maximum number of most-recent bars to include.
        db: Request-scoped database session.
        _user: Authenticated user (authorization only).

    Returns:
        InstrumentDetail: Instrument summary plus bars in ascending date order.

    Raises:
        HTTPException: 404 if the symbol is not in the universe.
    """
    inst = db.scalar(select(Instrument).where(func.upper(Instrument.symbol) == symbol.upper()))
    if inst is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instrument not found")

    if inst.profile_fetched_at is None:
        profile = YFinanceProvider().fetch_company_profile(inst.symbol)
        inst.website = profile["website"]
        inst.description = profile["description"]
        inst.profile_fetched_at = datetime.now(UTC)
        db.commit()

    bars = list(
        db.scalars(
            select(PriceBar)
            .where(PriceBar.instrument_id == inst.id)
            .order_by(PriceBar.date.desc())
            .limit(days)
        )
    )
    bars.reverse()
    detail = InstrumentDetail.model_validate(inst)
    detail.bars = [PriceBarOut.model_validate(b) for b in bars]
    if bars:
        detail.last_close = bars[-1].close
        detail.last_date = bars[-1].date
        detail.bar_count = len(bars)
    return detail
