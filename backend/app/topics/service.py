# service.py — hot-topics radar and topic deep dives (PRD FR-11): the radar
# clusters recent news titles into themes via the LLM; a deep dive asks the LLM
# for theme candidates, validates every ticker against real listings (hallucinated
# tickers are dropped), pulls their history, analyzes them, and ranks the result.

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.llm.provider import LLMProvider, LLMUnavailable, ModelTier
from app.marketdata.provider import MarketDataProvider
from app.marketdata.service import sync_price_history
from app.models.analysis import SentimentItem, StockScore
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.product import Topic, TopicReport
from app.models.user import User

logger = logging.getLogger(__name__)

RADAR_SYSTEM = (
    "You are an investment-theme analyst. Given recent financial headlines, identify "
    "the 5-8 hottest investment themes (e.g. 'quantum computing', 'nuclear fusion', "
    "'GLP-1 drugs'). Respond as JSON: "
    '{"topics": [{"name": "...", "buzz": <0..1>, "summary": "<one sentence>"}]}'
)

DEEP_DIVE_SYSTEM = (
    "You are an equity research analyst. For the given investment theme, list 5-15 "
    "publicly traded stocks with meaningful exposure, including lesser-known names. "
    "US tickers as-is; Tel Aviv (TASE) tickers with the .TA suffix. No ETFs, no "
    "derivatives, no private companies. Respond as JSON: "
    '{"summary": "<theme overview, 2-4 sentences>", '
    '"candidates": [{"symbol": "...", "name": "...", "rationale": "<one sentence>"}]}'
)


def refresh_topic_radar(db: Session, llm: LLMProvider, max_titles: int = 120) -> list[Topic]:
    """Rebuild the hot-topics list from recent sentiment item titles.

    Args:
        db: Database session (committed).
        llm: LLM provider (deep tier).
        max_titles: Cap on headlines fed to the LLM.

    Returns:
        list[Topic]: Upserted hot topics (empty when LLM/headlines unavailable).
    """
    since = datetime.now(UTC) - timedelta(days=7)
    titles = [
        t for (t,) in db.execute(
            select(SentimentItem.title).where(SentimentItem.created_at >= since)
            .order_by(SentimentItem.created_at.desc()).limit(max_titles))
    ]
    if not titles:
        logger.info("Topic radar skipped: no recent headlines")
        return []
    try:
        result = llm.complete("topics.radar", RADAR_SYSTEM, "\n".join(titles),
                              tier=ModelTier.deep, max_tokens=1200)
    except LLMUnavailable:
        return []
    parsed = result.parsed or {}
    topics: list[Topic] = []
    existing = {t.name.lower(): t for t in db.scalars(select(Topic))}
    for item in parsed.get("topics", []):
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        topic = existing.get(name.lower())
        if topic is None:
            topic = Topic(name=name)
            db.add(topic)
        topic.buzz_score = max(0.0, min(1.0, float(item.get("buzz", 0.5))))
        topic.summary = str(item.get("summary", ""))[:2000]
        topic.status = "hot"
        topic.updated_at = datetime.now(UTC)
        topics.append(topic)
    db.commit()
    return topics


def _validate_candidates(db: Session, provider: MarketDataProvider,
                         raw: list[dict]) -> list[tuple[dict, Instrument]]:
    """Keep only candidates whose tickers resolve to real, priceable listings.

    Known instruments validate against the DB; unknown tickers must return real
    bars from the market-data provider before being added to the universe with
    source="topic". Anything else (hallucinations) is dropped.

    Args:
        db: Database session (flushed).
        provider: Market data provider for unknown-ticker validation.
        raw: LLM candidates [{symbol, name, rationale}].

    Returns:
        list[tuple[dict, Instrument]]: (candidate, instrument) for valid tickers.
    """
    valid: list[tuple[dict, Instrument]] = []
    unknown: dict[str, dict] = {}
    for cand in raw:
        symbol = str(cand.get("symbol", "")).strip().upper()
        if not symbol or len(symbol) > 12:
            continue
        cand["symbol"] = symbol
        inst = db.scalar(select(Instrument).where(Instrument.symbol == symbol))
        if inst is not None:
            valid.append((cand, inst))
        else:
            unknown[symbol] = cand
    if unknown:
        from datetime import date

        bars = provider.fetch_daily_bars(list(unknown), date.today() - timedelta(days=30),
                                         date.today())
        for symbol, cand in unknown.items():
            if len(bars.get(symbol, [])) < 5:
                logger.info("Deep-dive candidate %s dropped: no real price data", symbol)
                continue
            inst = Instrument(
                symbol=symbol, name=str(cand.get("name", symbol))[:255],
                exchange=Exchange.tase if symbol.endswith(".TA") else Exchange.us,
                currency="ILA" if symbol.endswith(".TA") else "USD",
                universe_source=UniverseSource.topic)
            db.add(inst)
            db.flush()
            valid.append((cand, inst))
    return valid


def run_deep_dive(db: Session, llm: LLMProvider, provider: MarketDataProvider,
                  topic_name: str, user: User | None = None,
                  analyze: bool = True) -> TopicReport:
    """Execute a topic deep dive end to end.

    Args:
        db: Database session (committed).
        llm: LLM provider.
        provider: Market data provider (validation + history for new tickers).
        topic_name: Theme to investigate (listed or free text).
        user: Requesting user (for the report attribution).
        analyze: Run the analysis pass on validated candidates (slower).

    Returns:
        TopicReport: Persisted report with ranked validated candidates.

    Raises:
        LLMUnavailable: When the LLM is down (deep dives need it).
    """
    topic = db.scalar(select(Topic).where(Topic.name.ilike(topic_name)))
    if topic is None:
        topic = Topic(name=topic_name[:200], status="user_requested")
        db.add(topic)
        db.flush()

    result = llm.complete("topics.deep_dive", DEEP_DIVE_SYSTEM,
                          f"Theme: {topic.name}", tier=ModelTier.deep, max_tokens=2000)
    parsed = result.parsed or {}
    candidates = _validate_candidates(db, provider, list(parsed.get("candidates", []))[:15])

    instruments = [inst for _, inst in candidates]
    scores: dict[int, float] = {}
    if analyze and instruments:
        from app.analysis.service import run_analysis
        from app.sentiment.sources import default_sources

        sync_price_history(db, provider, instruments)
        run_analysis(db, llm, default_sources(), instruments)
        for inst in instruments:
            row = db.scalar(select(StockScore).where(StockScore.instrument_id == inst.id)
                            .order_by(StockScore.date.desc()).limit(1))
            if row:
                scores[inst.id] = row.combined_score

    ranked = sorted(
        ({"symbol": cand["symbol"], "name": cand.get("name", ""),
          "rationale": str(cand.get("rationale", ""))[:500],
          "combined_score": scores.get(inst.id), "validated": True}
         for cand, inst in candidates),
        key=lambda c: (c["combined_score"] is not None, c["combined_score"] or 0),
        reverse=True)

    report = TopicReport(topic_id=topic.id, requested_by=user.id if user else None,
                         summary=str(parsed.get("summary", ""))[:4000],
                         candidates=ranked)
    db.add(report)
    db.commit()
    return report
