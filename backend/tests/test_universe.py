# test_universe.py — tests for constituent parsing/fallbacks and universe upserts.

from app.models.instrument import Exchange, Instrument, UniverseSource
from app.universe import constituents
from app.universe.constituents import ConstituentEntry, normalize_us_symbol
from app.universe.loader import upsert_universe


def test_normalize_us_symbol_converts_class_shares():
    assert normalize_us_symbol("BRK.B") == "BRK-B"
    assert normalize_us_symbol(" aapl ") == "AAPL"


def test_fallback_lists_parse_and_are_tagged():
    sp = constituents._read_fallback(
        "sp500_fallback.csv", Exchange.us, UniverseSource.sp500, "USD"
    )
    ta = constituents.fetch_ta125()
    assert any(e.symbol == "AAPL" for e in sp)
    assert all(e.universe_source == UniverseSource.sp500 for e in sp)
    assert all(e.symbol.endswith(".TA") for e in ta)
    assert all(e.exchange == Exchange.tase for e in ta)


def test_fetchers_use_fallback_when_wikipedia_unreachable(monkeypatch):
    monkeypatch.setattr(constituents, "_fetch_wikipedia_table", lambda *a, **k: None)
    sp = constituents.fetch_sp500()
    nd = constituents.fetch_nasdaq100()
    assert any(e.symbol == "TSLA" for e in sp)
    assert any(e.universe_source == UniverseSource.nasdaq100 for e in nd)


def test_base_universe_dedupes_with_sp500_priority(monkeypatch):
    monkeypatch.setattr(constituents, "_fetch_wikipedia_table", lambda *a, **k: None)
    merged = constituents.fetch_base_universe()
    aapl = [e for e in merged if e.symbol == "AAPL"]
    assert len(aapl) == 1
    assert aapl[0].universe_source == UniverseSource.sp500


def _entry(symbol, name="X", source=UniverseSource.sp500):
    return ConstituentEntry(symbol, name, "Tech", Exchange.us, "USD", source)


def test_upsert_inserts_then_updates(db_session):
    counts = upsert_universe(db_session, [_entry("AAPL", "Apple")])
    assert counts == {"inserted": 1, "updated": 0}

    counts = upsert_universe(db_session, [_entry("AAPL", "Apple Inc."), _entry("MSFT")])
    assert counts == {"inserted": 1, "updated": 1}
    apple = db_session.query(Instrument).filter_by(symbol="AAPL").one()
    assert apple.name == "Apple Inc."


def test_upsert_leaves_absent_instruments_untouched(db_session):
    upsert_universe(db_session, [_entry("AAPL"), _entry("MSFT")])
    upsert_universe(db_session, [_entry("AAPL")])
    assert db_session.query(Instrument).count() == 2
