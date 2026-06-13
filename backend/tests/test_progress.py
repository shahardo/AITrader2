# test_progress.py — tests for the in-process progress registry used to expose
# live status for long-running scan/deep-dive endpoints.

from app.core.progress import get_progress, set_progress


def test_set_and_get_progress_round_trip():
    set_progress("scan:1", {"stage": "loading_universe"})
    assert get_progress("scan:1") == {"stage": "loading_universe"}


def test_set_progress_none_clears_entry():
    set_progress("scan:2", {"stage": "discovery"})
    set_progress("scan:2", None)
    assert get_progress("scan:2") is None


def test_get_progress_missing_key_returns_none():
    assert get_progress("scan:does-not-exist") is None
