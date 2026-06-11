# test_marketdata.py — tests for the price-history sync service using a fake
# provider, covering backfill, incremental top-up, and idempotency.

from datetime import date, timedelta

from app.marketdata.provider import Bar, MarketDataProvider
from app.marketdata.service import sync_price_history
from app.models.instrument import Exchange, Instrument, UniverseSource
from app.models.price_bar import PriceBar


class FakeProvider(MarketDataProvider):
    """In-memory provider serving deterministic bars and recording calls."""

    def __init__(self, bars_by_symbol):
        self.bars_by_symbol = bars_by_symbol
        self.calls = []

    def fetch_daily_bars(self, symbols, start, end):
        self.calls.append((tuple(symbols), start, end))
        return {
            s: [b for b in self.bars_by_symbol.get(s, []) if start <= b.date <= end]
            for s in symbols
        }


def _bars(symbol, start, n):
    return [
        Bar(symbol, start + timedelta(days=i), 10 + i, 11 + i, 9 + i, 10.5 + i, 1000.0)
        for i in range(n)
    ]


def _instrument(db, symbol, exchange=Exchange.us):
    inst = Instrument(symbol=symbol, name=symbol, exchange=exchange,
                      universe_source=UniverseSource.sp500)
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return inst


def test_initial_backfill_inserts_all_bars(db_session):
    today = date(2026, 6, 10)
    inst = _instrument(db_session, "AAPL")
    provider = FakeProvider({"AAPL": _bars("AAPL", today - timedelta(days=9), 10)})

    inserted = sync_price_history(db_session, provider, [inst], history_days=30, today=today)

    assert inserted == {"AAPL": 10}
    assert db_session.query(PriceBar).count() == 10


def test_incremental_sync_fetches_only_missing_days(db_session):
    today = date(2026, 6, 10)
    inst = _instrument(db_session, "AAPL")
    all_bars = _bars("AAPL", today - timedelta(days=9), 10)
    provider = FakeProvider({"AAPL": all_bars})
    earlier = today - timedelta(days=5)
    sync_price_history(db_session, provider, [inst], history_days=30, today=earlier)

    provider.calls.clear()
    inserted = sync_price_history(db_session, provider, [inst], history_days=30, today=today)

    assert provider.calls[0][1] == today - timedelta(days=4)  # day after last cached bar
    assert inserted == {"AAPL": 5}
    assert db_session.query(PriceBar).count() == 10


def test_sync_is_idempotent_when_up_to_date(db_session):
    today = date(2026, 6, 10)
    inst = _instrument(db_session, "AAPL")
    provider = FakeProvider({"AAPL": _bars("AAPL", today - timedelta(days=4), 5)})
    sync_price_history(db_session, provider, [inst], history_days=10, today=today)

    provider.calls.clear()
    inserted = sync_price_history(db_session, provider, [inst], history_days=10, today=today)

    assert inserted == {}
    assert provider.calls == []  # nothing to fetch, provider untouched
    assert db_session.query(PriceBar).count() == 5


def test_symbol_with_no_data_is_skipped_not_fatal(db_session):
    today = date(2026, 6, 10)
    good = _instrument(db_session, "AAPL")
    bad = _instrument(db_session, "GHOST.TA", exchange=Exchange.tase)
    provider = FakeProvider({"AAPL": _bars("AAPL", today - timedelta(days=2), 3)})

    inserted = sync_price_history(db_session, provider, [good, bad], history_days=10, today=today)

    assert inserted == {"AAPL": 3}
