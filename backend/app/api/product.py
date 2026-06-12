# product.py — Milestone 4 endpoints: hot topics + deep dives, the notification
# feed, Telegram account linking, and on-demand universe scans.

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.llm.groq_provider import build_default_provider
from app.llm.provider import LLMUnavailable
from app.marketdata.service import sync_price_history
from app.marketdata.yfinance_provider import YFinanceProvider
from app.models.instrument import Instrument
from app.models.product import Notification, Scan, Topic, TopicReport
from app.models.user import User
from app.notify.service import complete_telegram_links, start_telegram_link
from app.topics.service import refresh_topic_radar, run_deep_dive
from app.universe.constituents import fetch_base_universe
from app.universe.discovery import run_discovery
from app.universe.loader import upsert_universe

router = APIRouter(tags=["product"])


class TopicOut(BaseModel):
    """One radar topic."""

    id: int
    name: str
    buzz_score: float
    status: str
    summary: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class TopicReportOut(BaseModel):
    """One deep-dive report."""

    id: int
    topic_id: int
    topic_name: str = ""
    summary: str
    candidates: list
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DeepDiveRequest(BaseModel):
    """Deep-dive trigger payload."""

    topic: str = Field(min_length=2, max_length=200)
    analyze: bool = True


class NotificationOut(BaseModel):
    """One in-app notification."""

    id: int
    kind: str
    title: str
    body: str
    read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ScanOut(BaseModel):
    """One scan run record."""

    id: int
    status: str
    stats: dict
    started_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}


@router.get("/topics/hot", response_model=list[TopicOut])
def hot_topics(refresh: bool = False, db: Session = Depends(get_db),
               _user=Depends(get_current_user)) -> list[TopicOut]:
    """List radar topics by buzz; optionally refresh the radar via the LLM first."""
    if refresh:
        refresh_topic_radar(db, build_default_provider())
    rows = db.scalars(select(Topic).order_by(Topic.buzz_score.desc()).limit(20))
    return [TopicOut.model_validate(t) for t in rows]


@router.post("/topics/deep-dive", response_model=TopicReportOut)
def deep_dive(payload: DeepDiveRequest, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)) -> TopicReportOut:
    """Run a deep dive on a listed or free-text topic (synchronous)."""
    try:
        report = run_deep_dive(db, build_default_provider(), YFinanceProvider(),
                               payload.topic, user, analyze=payload.analyze)
    except LLMUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Deep dives require the LLM (set GROQ_API_KEY)") from exc
    out = TopicReportOut.model_validate(report)
    topic = db.get(Topic, report.topic_id)
    out.topic_name = topic.name if topic else ""
    return out


@router.get("/topic-reports", response_model=list[TopicReportOut])
def list_reports(db: Session = Depends(get_db), _user=Depends(get_current_user)
                 ) -> list[TopicReportOut]:
    """List recent deep-dive reports, newest first."""
    rows = db.execute(
        select(TopicReport, Topic.name).join(Topic, Topic.id == TopicReport.topic_id)
        .order_by(TopicReport.created_at.desc()).limit(30)).all()
    out = []
    for report, topic_name in rows:
        item = TopicReportOut.model_validate(report)
        item.topic_name = topic_name
        out.append(item)
    return out


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)) -> list[NotificationOut]:
    """List the user's notifications, newest first."""
    rows = db.scalars(select(Notification).where(Notification.user_id == user.id)
                      .order_by(Notification.created_at.desc()).limit(100))
    return [NotificationOut.model_validate(n) for n in rows]


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(notification_id: int, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)) -> None:
    """Mark one notification as read."""
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    row.read = True
    db.commit()


@router.post("/me/telegram-link")
def telegram_link(db: Session = Depends(get_db), user: User = Depends(get_current_user)
                  ) -> dict:
    """Start Telegram linking: returns the one-time code to send to the bot."""
    code = start_telegram_link(db, user)
    return {"code": code, "instructions":
            f"Open the bot in Telegram and send: /start {code}"}


@router.post("/me/telegram-link/check")
def telegram_link_check(db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)) -> dict:
    """Poll the bot for the link code; returns the current link state."""
    complete_telegram_links(db)
    db.refresh(user)
    return {"linked": user.telegram_chat_id is not None}


@router.post("/scans", response_model=ScanOut)
def trigger_scan(db: Session = Depends(get_db), user: User = Depends(get_current_user)
                 ) -> ScanOut:
    """Re-run the universe scan (PRD FR-3 're-run initial scan').

    Refreshes index constituents, runs the discovery layer, and syncs price
    history for any newly added instruments.
    """
    scan = Scan(triggered_by=user.id)
    db.add(scan)
    db.commit()
    try:
        counts = upsert_universe(db, fetch_base_universe())
        discovered = run_discovery(db)
        new_instruments = list(db.scalars(
            select(Instrument).where(Instrument.is_active.is_(True))))
        synced = sync_price_history(db, YFinanceProvider(), new_instruments)
        scan.stats = {**counts, "discovered": discovered,
                      "synced_symbols": len(synced), "bars": sum(synced.values())}
        scan.status = "done"
    except Exception:  # noqa: BLE001 — record the failure on the scan row
        scan.status = "failed"
        raise
    finally:
        scan.finished_at = datetime.now(UTC)
        db.commit()
    return ScanOut.model_validate(scan)


@router.get("/scans/latest", response_model=ScanOut | None)
def latest_scan(db: Session = Depends(get_db), _user=Depends(get_current_user)
                ) -> ScanOut | None:
    """Return the most recent scan run, if any."""
    row = db.scalar(select(Scan).order_by(Scan.started_at.desc()).limit(1))
    return ScanOut.model_validate(row) if row else None
