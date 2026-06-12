# celery_app.py — Celery application and beat schedule: nightly daily_pipeline,
# Sunday weekly_strategy (both in app/jobs/pipelines.py), and a heartbeat task.

from celery import Celery
from celery.schedules import crontab

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
    # Mon-Fri 23:45 Asia/Jerusalem — after the US close (dev plan §7).
    "daily-pipeline": {
        "task": "app.jobs.daily_pipeline",
        "schedule": crontab(hour=23, minute=45, day_of_week="mon-fri"),
    },
    # Sunday 08:00 — weekly 10/2 strategy re-evaluation.
    "weekly-strategy": {
        "task": "app.jobs.weekly_strategy",
        "schedule": crontab(hour=8, minute=0, day_of_week="sun"),
    },
}

celery_app.autodiscover_tasks(["app.jobs"])
import app.jobs.pipelines  # noqa: E402,F401 — register pipeline tasks with the worker
