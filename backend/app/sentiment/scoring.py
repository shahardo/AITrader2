# scoring.py — sentiment scoring: the LLM rates each media item (sentiment,
# relevance, summary), then items blend into a per-symbol composite with
# recency-decay weighting (development plan §5.2).

import logging
import math
from datetime import UTC, datetime

from app.llm.provider import LLMProvider, LLMUnavailable, ModelTier
from app.sentiment.sources import RawItem

logger = logging.getLogger(__name__)

DECAY_DAYS = 7.0  # half-life-ish decay constant: exp(-age/7)

SYSTEM_PROMPT = (
    "You are a financial news analyst. Rate the headline's sentiment toward the "
    "given company's stock. Respond with a JSON object: "
    '{"sentiment": <float -1..1>, "relevance": <float 0..1>, "summary": "<one sentence>"}. '
    "sentiment: -1 very bearish, 0 neutral, 1 very bullish. "
    "relevance: how directly the headline concerns this company (0 = unrelated)."
)


def score_item(llm: LLMProvider, company: str, symbol: str, item: RawItem) -> dict | None:
    """Score one media item with the LLM (bulk tier).

    Args:
        llm: LLM provider.
        company: Company name for context.
        symbol: Ticker symbol.
        item: The raw media item.

    Returns:
        dict | None: {"sentiment", "relevance", "summary"} clamped to valid
        ranges, or None when the LLM is unavailable or returned junk.
    """
    user = f"Company: {company} ({symbol})\nSource: {item.source}\nHeadline: {item.title}"
    try:
        result = llm.complete("sentiment.score_item", SYSTEM_PROMPT, user,
                              tier=ModelTier.bulk, max_tokens=200)
    except LLMUnavailable:
        return None
    parsed = result.parsed
    if not parsed or "sentiment" not in parsed:
        logger.warning("Unparseable sentiment for %s: %.80s", symbol, result.content)
        return None
    try:
        return {
            "sentiment": max(-1.0, min(1.0, float(parsed["sentiment"]))),
            "relevance": max(0.0, min(1.0, float(parsed.get("relevance", 0.5)))),
            "summary": str(parsed.get("summary", ""))[:1000],
        }
    except (TypeError, ValueError):
        return None


def composite_sentiment(
    scored: list[dict], now: datetime | None = None
) -> tuple[float, float]:
    """Blend scored items into (composite score, confidence).

    Implements: score = Σ(sent·rel·exp(-age/7)) / Σ(rel·exp(-age/7));
    confidence grows with item count and source diversity.

    Args:
        scored: Dicts with keys sentiment, relevance, published_at (datetime|None),
            and source.
        now: Clock override for tests.

    Returns:
        tuple[float, float]: (score in -1..1, confidence in 0..1); (0, 0) when empty.
    """
    now = now or datetime.now(UTC)
    num = den = 0.0
    sources: set[str] = set()
    for item in scored:
        published = item.get("published_at")
        age_days = max(0.0, (now - published).total_seconds() / 86400) if published else 3.0
        weight = item["relevance"] * math.exp(-age_days / DECAY_DAYS)
        num += item["sentiment"] * weight
        den += weight
        sources.add(item.get("source", "?"))
    if den == 0:
        return 0.0, 0.0
    count_factor = min(1.0, len(scored) / 8)
    diversity_factor = min(1.0, len(sources) / 3)
    return round(num / den, 4), round(0.5 * count_factor + 0.5 * diversity_factor, 3)
