# sources.py — sentiment source interface and free RSS/JSON implementations:
# Yahoo Finance RSS (per symbol), Google News RSS, Reddit search, and Israeli
# financial press (Globes RSS) for TASE names.

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import feedparser
import httpx

from app.models.instrument import Exchange, Instrument

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RawItem:
    """One unscored media item about an instrument."""

    source: str
    title: str
    url: str
    published_at: datetime | None


class SentimentSource(ABC):
    """Interface for a media channel that yields items about an instrument."""

    name: str = "base"

    @abstractmethod
    def fetch(self, instrument: Instrument, limit: int = 10) -> list[RawItem]:
        """Fetch recent items mentioning the instrument.

        Args:
            instrument: The instrument to search for.
            limit: Maximum items to return.

        Returns:
            list[RawItem]: Recent items, newest first; [] on any failure.
        """


def _parse_feed(url: str, source_name: str, limit: int) -> list[RawItem]:
    """Download and parse an RSS/Atom feed into RawItems.

    Args:
        url: Feed URL.
        source_name: Source tag to attach to items.
        limit: Maximum items.

    Returns:
        list[RawItem]: Parsed items; [] on any network/parse failure.
    """
    try:
        resp = httpx.get(url, timeout=20, headers={"User-Agent": "AITrader2/0.1"},
                         follow_redirects=True)
        resp.raise_for_status()
        feed = feedparser.parse(resp.text)
    except Exception:  # noqa: BLE001 — a dead source must not kill the pipeline
        logger.warning("Sentiment source %s failed for %s", source_name, url)
        return []
    items: list[RawItem] = []
    for entry in feed.entries[:limit]:
        published = None
        raw_date = entry.get("published") or entry.get("updated")
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date)
            except (TypeError, ValueError):
                published = None
        items.append(
            RawItem(
                source=source_name,
                title=entry.get("title", "").strip(),
                url=entry.get("link", ""),
                published_at=published,
            )
        )
    return items


class YahooFinanceRSS(SentimentSource):
    """Per-symbol headlines from Yahoo Finance's RSS feed."""

    name = "yahoo_rss"

    def fetch(self, instrument: Instrument, limit: int = 10) -> list[RawItem]:
        """Fetch Yahoo Finance headlines for the symbol."""
        url = (
            "https://feeds.finance.yahoo.com/rss/2.0/headline?"
            f"s={instrument.symbol}&region=US&lang=en-US"
        )
        return _parse_feed(url, self.name, limit)


class GoogleNewsRSS(SentimentSource):
    """Company-name search on Google News RSS."""

    name = "google_news"

    def fetch(self, instrument: Instrument, limit: int = 10) -> list[RawItem]:
        """Fetch Google News results for the company name + 'stock'."""
        query = httpx.QueryParams({"q": f"{instrument.name} stock"})
        url = f"https://news.google.com/rss/search?{query}&hl=en-US&gl=US&ceid=US:en"
        return _parse_feed(url, self.name, limit)


class RedditSearch(SentimentSource):
    """Reddit post titles mentioning the ticker (r/stocks + r/wallstreetbets)."""

    name = "reddit"

    def fetch(self, instrument: Instrument, limit: int = 10) -> list[RawItem]:
        """Search Reddit's public JSON API for the bare ticker."""
        ticker = instrument.symbol.removesuffix(".TA")
        url = (
            "https://www.reddit.com/r/stocks+wallstreetbets/search.json"
            f"?q={ticker}&restrict_sr=1&sort=new&limit={limit}"
        )
        try:
            resp = httpx.get(url, timeout=20, headers={"User-Agent": "AITrader2/0.1"})
            resp.raise_for_status()
            posts = resp.json().get("data", {}).get("children", [])
        except Exception:  # noqa: BLE001 — a dead source must not kill the pipeline
            logger.warning("Reddit search failed for %s", ticker)
            return []
        items: list[RawItem] = []
        for post in posts[:limit]:
            data = post.get("data", {})
            created = data.get("created_utc")
            items.append(
                RawItem(
                    source=self.name,
                    title=data.get("title", "").strip(),
                    url=f"https://reddit.com{data.get('permalink', '')}",
                    published_at=(
                        datetime.fromtimestamp(created, tz=UTC) if created else None
                    ),
                )
            )
        return items


class GlobesRSS(SentimentSource):
    """Israeli financial press (Globes English RSS), filtered by company name.

    Only applied to TASE instruments; returns [] for US names.
    """

    name = "globes"
    FEED_URL = "https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=1725"

    def fetch(self, instrument: Instrument, limit: int = 10) -> list[RawItem]:
        """Fetch Globes headlines mentioning the company (TASE names only)."""
        if instrument.exchange != Exchange.tase:
            return []
        needle = instrument.name.split()[0].lower()  # first word of company name
        items = _parse_feed(self.FEED_URL, self.name, limit=50)
        return [i for i in items if needle in i.title.lower()][:limit]


def default_sources() -> list[SentimentSource]:
    """Return the launch sentiment channels (PRD FR-5: >=3 channels).

    Returns:
        list[SentimentSource]: Yahoo RSS, Google News, Reddit, Globes.
    """
    return [YahooFinanceRSS(), GoogleNewsRSS(), RedditSearch(), GlobesRSS()]
