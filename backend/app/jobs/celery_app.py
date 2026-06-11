# celery_app.py — Celery application and beat schedule. M1 ships the wiring and a
# heartbeat task; the daily/weekly pipelines plug in here in Milestones 2-3.

from celery import Celery

from app.core.config import get_settings

celery_app = Celery(
    "aitrader2",
    broker=get_settings().redis_url,
    backend=get_settings().redis_url,
)
celery_app.conf.timezone = "Asia/Jerusalem"


@celery_app.task
def heartbeat() -> str:
    """No-op task proving the worker/beat/redis wiring is alive.

    Returns:
        str: The literal "ok".
    """
    return "ok"


celery_app.conf.beat_schedule = {
    "heartbeat-hourly": {"task": "app.jobs.celery_app.heartbeat", "schedule": 3600.0},
}
