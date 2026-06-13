# service.py — analysis orchestrator: computes indicator snapshots and sentiment
# scores per instrument, blends them into stock_scores, and ranks the universe.
# Degrades to technical-only when the LLM or sentiment sources are unavailable
# (PRD §7).

import logging
from collections.abc import Callable
from dataclasses import asdict
from datetime import date

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.llm.provider import LLMProvider
from app.models.analysis import IndicatorSnapshot, SentimentItem, SentimentScore, StockScore
from app.models.instrument import Instrument
from app.models.price_bar import PriceBar
from app.sentiment.scoring import composite_sentiment, score_item
from app.sentiment.sources import SentimentSource
from app.ta.scoring import composite_score, compute_signals, signals_to_json
from app.ta.support_resistance import analyze_support_resistance
from app.ta.trend_channel import fit_trend_channel

logger = logging.getLogger(__name__)

# Development plan §5.3: combined = 0.6*technical + 0.4*scaled_sentiment, with the
# sentiment weight shrinking proportionally to its confidence.
TECH_WEIGHT = 0.6
SENT_WEIGHT = 0.4
MAX_ITEMS_PER_SOURCE = 5


def load_ohlcv(db: Session, instrument_id: int, max_bars: int = 400) -> pd.DataFrame:
    """Load an instrument's recent bars as an OHLCV DataFrame.

    Args:
        db: Database session.
        instrument_id: Target instrument.
        max_bars: Most-recent bars to load.

    Returns:
        pd.DataFrame: Columns open/high/low/close/volume indexed by date, ascending.
    """
    rows = db.execute(
        select(PriceBar.date, PriceBar.open, PriceBar.high, PriceBar.low,
               PriceBar.close, PriceBar.volume)
        .where(PriceBar.instrument_id == instrument_id)
        .order_by(PriceBar.date.desc())
        .limit(max_bars)
    ).all()
    frame = pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])
    return frame.set_index("date").sort_index()


def analyze_technical(db: Session, instrument: Instrument, as_of: date) -> float | None:
    """Compute and persist the indicator snapshot for one instrument.

    Args:
        db: Database session (flushed, not committed).
        instrument: Instrument to analyze.
        as_of: Snapshot date.

    Returns:
        float | None: Technical score, or None when history is insufficient.
    """
    df = load_ohlcv(db, instrument.id)
    signals = compute_signals(df)
    if not signals:
        return None
    score = composite_score(signals)

    channel = fit_trend_channel(df["close"])
    sr = analyze_support_resistance(df["high"], df["low"], df["close"])
    extras = {
        "trend_channel": asdict(channel) if channel else None,
        "sr_levels": [asdict(level) for level in sr.levels[:8]],
    }

    db.execute(delete(IndicatorSnapshot).where(
        IndicatorSnapshot.instrument_id == instrument.id, IndicatorSnapshot.date == as_of))
    db.add(IndicatorSnapshot(instrument_id=instrument.id, date=as_of,
                             signals=signals_to_json(signals), technical_score=score,
                             extras=extras))
    return score


def analyze_sentiment(
    db: Session,
    llm: LLMProvider,
    sources: list[SentimentSource],
    instrument: Instrument,
    as_of: date,
    on_progress: Callable[[dict], None] | None = None,
) -> tuple[float, float] | None:
    """Fetch, LLM-score, and persist sentiment for one instrument.

    Args:
        db: Database session (flushed, not committed).
        llm: LLM provider for item scoring.
        sources: Media channels to query.
        instrument: Instrument to analyze.
        as_of: Score date.
        on_progress: Optional callback invoked with a status payload as each
            article is read and scored.

    Returns:
        tuple[float, float] | None: (score, confidence), or None when no items
        could be fetched or scored (degradation path).
    """
    items = [item for source in sources
             for item in source.fetch(instrument, limit=MAX_ITEMS_PER_SOURCE)]
    total = len(items)
    scored: list[dict] = []
    for i, item in enumerate(items, start=1):
        if on_progress:
            on_progress({"stage": "reading_article", "symbol": instrument.symbol,
                         "current": i, "total": total})
        rating = score_item(llm, instrument.name, instrument.symbol, item)
        if rating is None:
            continue
        scored.append({**rating, "published_at": item.published_at, "source": item.source})
        db.add(SentimentItem(
            instrument_id=instrument.id, source=item.source, url=item.url[:1000],
            title=item.title[:500], published_at=item.published_at,
            sentiment=rating["sentiment"], relevance=rating["relevance"],
            summary=rating["summary"]))
    if not scored:
        return None
    score, confidence = composite_sentiment(scored)
    db.execute(delete(SentimentScore).where(
        SentimentScore.instrument_id == instrument.id, SentimentScore.date == as_of))
    db.add(SentimentScore(instrument_id=instrument.id, date=as_of, score=score,
                          item_count=len(scored), confidence=confidence))
    return score, confidence


def blend_and_store(db: Session, instrument: Instrument, as_of: date,
                    technical: float, sentiment: tuple[float, float] | None) -> float:
    """Blend technical and sentiment into the combined score and persist it.

    Sentiment contributes proportionally to its confidence; with no sentiment the
    score is technical-only (flagged by sentiment_score=None).

    Args:
        db: Database session (flushed, not committed).
        instrument: Scored instrument.
        as_of: Score date.
        technical: Technical score 0-100.
        sentiment: (score -1..1, confidence 0..1) or None.

    Returns:
        float: Combined score 0-100.
    """
    if sentiment is None:
        combined = technical
        sent_value = None
    else:
        sent_value, confidence = sentiment
        scaled = 50 + 50 * sent_value  # map -1..1 onto 0..100
        effective_sent_weight = SENT_WEIGHT * confidence
        effective_tech_weight = 1 - effective_sent_weight
        combined = effective_tech_weight * technical + effective_sent_weight * scaled
    db.execute(delete(StockScore).where(
        StockScore.instrument_id == instrument.id, StockScore.date == as_of))
    db.add(StockScore(instrument_id=instrument.id, date=as_of, technical_score=technical,
                      sentiment_score=sent_value, combined_score=round(combined, 2)))
    return combined


def run_analysis(
    db: Session,
    llm: LLMProvider,
    sources: list[SentimentSource],
    instruments: list[Instrument],
    as_of: date | None = None,
    with_sentiment: bool = True,
    on_progress: Callable[[dict], None] | None = None,
) -> dict[str, float]:
    """Run the full analysis pass for a set of instruments and rank them.

    Args:
        db: Database session (committed at the end).
        llm: LLM provider.
        sources: Sentiment channels.
        instruments: Instruments to analyze.
        as_of: Analysis date (defaults to today).
        with_sentiment: Disable to run technical-only (faster dev runs).
        on_progress: Optional callback invoked with a status payload as each
            instrument (and, when enabled, each of its sentiment articles) is
            processed.

    Returns:
        dict[str, float]: Combined score per analyzed symbol.
    """
    as_of = as_of or date.today()
    results: dict[str, float] = {}
    total = len(instruments)
    for i, instrument in enumerate(instruments, start=1):
        if on_progress:
            on_progress({"stage": "analyzing", "symbol": instrument.symbol,
                         "current": i, "total": total})
        technical = analyze_technical(db, instrument, as_of)
        if technical is None:
            logger.info("Skipping %s: insufficient history", instrument.symbol)
            continue
        sentiment = None
        if with_sentiment:
            sentiment = analyze_sentiment(db, llm, sources, instrument, as_of,
                                          on_progress=on_progress)
        results[instrument.symbol] = blend_and_store(
            db, instrument, as_of, technical, sentiment)

    ranked = db.scalars(
        select(StockScore).where(StockScore.date == as_of)
        .order_by(StockScore.combined_score.desc())
    ).all()
    for position, row in enumerate(ranked, start=1):
        row.rank = position
    db.commit()
    logger.info("Analyzed %d instruments for %s", len(results), as_of)
    return results
