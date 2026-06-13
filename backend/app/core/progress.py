# progress.py — in-process registry for live status of long-running
# synchronous jobs (universe scans, topic deep dives), polled by the frontend
# while the triggering request is still in flight. The API runs as a single
# uvicorn worker (docker-compose.yml), so FastAPI's threadpool lets a polling
# request's thread read updates written by the in-flight request's thread.

import threading

_lock = threading.Lock()
_progress: dict[str, dict] = {}


def set_progress(key: str, data: dict | None) -> None:
    """Set or clear the current status payload for a job key.

    Args:
        key: Job identifier (e.g. ``f"scan:{scan.id}"``).
        data: Status payload, or ``None`` to clear it.
    """
    with _lock:
        if data is None:
            _progress.pop(key, None)
        else:
            _progress[key] = data


def get_progress(key: str) -> dict | None:
    """Return the current status payload for a job key, or ``None``.

    Args:
        key: Job identifier (e.g. ``f"scan:{scan.id}"``).

    Returns:
        dict | None: The last status payload set for this key, if any.
    """
    with _lock:
        return _progress.get(key)
