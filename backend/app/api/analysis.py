# analysis.py — analysis endpoints: score leaderboard, per-symbol indicator
# snapshot + sentiment drill-down, and the manual analysis trigger (dev/on-demand).

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.llm.groq_provider import build_default_provider
from app.models.analysis import IndicatorSnapshot, SentimentItem, SentimentScore, StockScore
from app.models.instrument import Instrument
from app.schemas.analysis import (
    AnalysisRunRequest,
    AnalysisRunResult,
    ScoreRow,
    SentimentItemOut,
    SentimentOut,
    SnapshotOut,
)
from app.sentiment.sources import default_sources

router = APIRouter(tags=["analysis"])


def _resolve_instrument(db: Session, symbol: str) -> Instrument:
    """Look up an active instrument by symbol or raise 404.

    Args:
        db: Database session.
        symbol: Case-insensitive symbol.

    Returns:
        Instrument: The matching row.

    Raises:
        HTTPException: 404 when not found.
    """
    inst = db.scalar(select(Instrument).where(
        func.upper(Instrument.symbol) == symbol.upper()))
    if inst is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instrument not found")
    return inst


@router.get("/scores/latest", response_model=list[ScoreRow])
def latest_scores(db: Session = Depends(get_db), _user=Depends(get_current_user)
                  ) -> list[ScoreRow]:
    """Return the most recent universe leaderboard, best combined score first.

    Args:
        db: Request-scoped database session.
        _user: Authenticated user (authorization only).

    Returns:
        list[ScoreRow]: Latest-date scores joined to instrument identity.
    """
    latest_date = db.scalar(select(func.max(StockScore.date)))
    if latest_date is None:
        return []
    rows = db.execute(
        select(StockScore, Instrument)
        .join(Instrument, Instrument.id == StockScore.instrument_id)
        .where(StockScore.date == latest_date)
        .order_by(StockScore.combined_score.desc())
    ).all()
    return [
        ScoreRow(symbol=inst.symbol, name=inst.name, exchange=inst.exchange.value,
                 date=score.date, technical_score=score.technical_score,
                 sentiment_score=score.sentiment_score,
                 combined_score=score.combined_score, rank=score.rank)
        for score, inst in rows
    ]


@router.get("/instruments/{symbol}/analysis", response_model=SnapshotOut)
def instrument_analysis(symbol: str, db: Session = Depends(get_db),
                        _user=Depends(get_current_user)) -> SnapshotOut:
    """Return the latest indicator snapshot for one instrument.

    Args:
        symbol: Instrument symbol.
        db: Request-scoped database session.
        _user: Authenticated user.

    Returns:
        SnapshotOut: Latest snapshot with per-indicator signals and overlays.

    Raises:
        HTTPException: 404 when the instrument or snapshot is missing.
    """
    inst = _resolve_instrument(db, symbol)
    snap = db.scalar(
        select(IndicatorSnapshot)
        .where(IndicatorSnapshot.instrument_id == inst.id)
        .order_by(IndicatorSnapshot.date.desc()).limit(1)
    )
    if snap is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No analysis yet for this instrument")
    return SnapshotOut.model_validate(snap)


@router.get("/instruments/{symbol}/sentiment", response_model=SentimentOut)
def instrument_sentiment(symbol: str, db: Session = Depends(get_db),
                         _user=Depends(get_current_user)) -> SentimentOut:
    """Return the latest composite sentiment and its contributing items.

    Args:
        symbol: Instrument symbol.
        db: Request-scoped database session.
        _user: Authenticated user.

    Returns:
        SentimentOut: Composite score plus up to 30 recent scored items.

    Raises:
        HTTPException: 404 when the instrument or sentiment is missing.
    """
    inst = _resolve_instrument(db, symbol)
    score = db.scalar(
        select(SentimentScore).where(SentimentScore.instrument_id == inst.id)
        .order_by(SentimentScore.date.desc()).limit(1)
    )
    if score is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No sentiment yet for this instrument")
    items = db.scalars(
        select(SentimentItem).where(SentimentItem.instrument_id == inst.id)
        .order_by(SentimentItem.created_at.desc()).limit(30)
    ).all()
    return SentimentOut(
        date=score.date, score=score.score, confidence=score.confidence,
        item_count=score.item_count,
        items=[SentimentItemOut.model_validate(i) for i in items])


@router.post("/analysis/run", response_model=AnalysisRunResult)
def run_analysis_endpoint(payload: AnalysisRunRequest, db: Session = Depends(get_db),
                          _user=Depends(get_current_user)) -> AnalysisRunResult:
    """Run analysis synchronously for selected symbols (dev/on-demand tool).

    The nightly pipeline calls the same service; this endpoint exists so users
    can refresh specific names and developers can exercise the engine.

    Args:
        payload: Symbols filter, sentiment toggle, and cap.
        db: Request-scoped database session.
        _user: Authenticated user.

    Returns:
        AnalysisRunResult: Combined scores per analyzed symbol.
    """
    from app.analysis.service import run_analysis

    stmt = select(Instrument).where(Instrument.is_active.is_(True))
    if payload.symbols:
        wanted = [s.upper() for s in payload.symbols]
        stmt = stmt.where(func.upper(Instrument.symbol).in_(wanted))
    instruments = list(db.scalars(stmt.order_by(Instrument.symbol)))
    if payload.limit:
        instruments = instruments[: payload.limit]
    scores = run_analysis(db, build_default_provider(), default_sources(), instruments,
                          with_sentiment=payload.with_sentiment)
    return AnalysisRunResult(analyzed=len(scores), scores=scores)
