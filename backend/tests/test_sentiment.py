# test_sentiment.py — tests for LLM item scoring (mocked provider), the
# recency-decayed composite, and degradation when the LLM is unavailable.

import json
from datetime import UTC, datetime, timedelta

from app.llm.provider import LLMProvider, LLMResult, LLMUnavailable, NullLLMProvider
from app.sentiment.scoring import composite_sentiment, score_item
from app.sentiment.sources import RawItem


class FakeLLM(LLMProvider):
    """LLM stub returning a canned JSON payload."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def complete(self, call_site, system, user, **kwargs) -> LLMResult:
        self.calls.append((call_site, user))
        if self.payload is None:
            raise LLMUnavailable("down")
        content = json.dumps(self.payload)
        return LLMResult(content=content, parsed=self.payload, model="fake")


ITEM = RawItem(source="yahoo_rss", title="Apple beats earnings", url="http://x",
               published_at=datetime.now(UTC))


def test_score_item_clamps_and_returns_fields():
    llm = FakeLLM({"sentiment": 1.7, "relevance": -0.2, "summary": "Beat expectations."})
    rating = score_item(llm, "Apple", "AAPL", ITEM)
    assert rating == {"sentiment": 1.0, "relevance": 0.0, "summary": "Beat expectations."}
    assert llm.calls[0][0] == "sentiment.score_item"


def test_score_item_none_when_llm_unavailable():
    assert score_item(NullLLMProvider(), "Apple", "AAPL", ITEM) is None


def test_score_item_none_on_junk_response():
    llm = FakeLLM({"unexpected": True})
    assert score_item(llm, "Apple", "AAPL", ITEM) is None


def test_composite_weights_fresh_items_more():
    now = datetime.now(UTC)
    fresh_bull = {"sentiment": 1.0, "relevance": 1.0, "published_at": now, "source": "a"}
    stale_bear = {"sentiment": -1.0, "relevance": 1.0,
                  "published_at": now - timedelta(days=30), "source": "b"}
    score, confidence = composite_sentiment([fresh_bull, stale_bear], now=now)
    assert score > 0.8  # the month-old bear barely registers
    assert 0 < confidence <= 1


def test_composite_empty_is_neutral_zero_confidence():
    assert composite_sentiment([]) == (0.0, 0.0)


def test_composite_confidence_grows_with_count_and_diversity():
    now = datetime.now(UTC)

    def make(n, sources):
        return [{"sentiment": 0.5, "relevance": 1.0, "published_at": now,
                 "source": sources[i % len(sources)]} for i in range(n)]

    _, low = composite_sentiment(make(1, ["a"]), now=now)
    _, high = composite_sentiment(make(8, ["a", "b", "c"]), now=now)
    assert high > low
