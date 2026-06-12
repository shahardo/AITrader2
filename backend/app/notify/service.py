# service.py — notification service: persists in-app notifications and mirrors
# them to Telegram when the user has linked a chat (PRD FR-12). Also implements
# the one-time-code Telegram account linking via the Bot API getUpdates poll.

import logging
import secrets

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.product import Notification
from app.models.user import User

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org"


def _bot_url(method: str) -> str | None:
    """Build a Bot API URL, or None when no token is configured.

    Args:
        method: Bot API method name.

    Returns:
        str | None: Full URL or None (Telegram disabled).
    """
    token = get_settings().telegram_bot_token
    return f"{TELEGRAM_API}/bot{token}/{method}" if token else None


def send_telegram(chat_id: str, text: str) -> bool:
    """Send one Telegram message (best-effort).

    Args:
        chat_id: Destination chat.
        text: Message text (markdown disabled to avoid escaping issues).

    Returns:
        bool: True when the API accepted the message.
    """
    url = _bot_url("sendMessage")
    if url is None:
        return False
    try:
        resp = httpx.post(url, json={"chat_id": chat_id, "text": text}, timeout=15)
        return bool(resp.json().get("ok"))
    except Exception:  # noqa: BLE001 — notifications must never break a pipeline
        logger.warning("Telegram send failed for chat %s", chat_id)
        return False


def notify(db: Session, user: User, kind: str, title: str, body: str = "") -> Notification:
    """Create an in-app notification and mirror it to Telegram when linked.

    Args:
        db: Database session (flushed, not committed).
        user: Recipient.
        kind: Notification kind (daily_recs, trade_executed, strategy_change,
            scan_done, deep_dive_done).
        title: Short headline.
        body: Longer text.

    Returns:
        Notification: The persisted row.
    """
    row = Notification(user_id=user.id, kind=kind, title=title, body=body[:2000])
    if user.telegram_chat_id:
        row.sent_telegram = send_telegram(user.telegram_chat_id, f"{title}\n\n{body}"[:4000])
    db.add(row)
    db.flush()
    return row


def start_telegram_link(db: Session, user: User) -> str:
    """Generate a one-time code the user sends to the bot to link accounts.

    Args:
        db: Database session (committed).
        user: User requesting the link.

    Returns:
        str: The code to send to the bot (e.g. "/start ab12cd34").
    """
    code = secrets.token_hex(4)
    user.telegram_link_code = code
    db.commit()
    return code


def complete_telegram_links(db: Session) -> int:
    """Poll Bot API updates and link users whose codes appear in messages.

    Called from the "check link" endpoint and the nightly pipeline.

    Args:
        db: Database session (committed).

    Returns:
        int: Number of users linked in this poll.
    """
    url = _bot_url("getUpdates")
    if url is None:
        return 0
    try:
        updates = httpx.get(url, params={"limit": 100}, timeout=15).json().get("result", [])
    except Exception:  # noqa: BLE001 — linking is retried on the next poll
        logger.warning("Telegram getUpdates failed")
        return 0
    pending = {u.telegram_link_code: u
               for u in db.scalars(select(User).where(User.telegram_link_code.is_not(None)))}
    linked = 0
    for update in updates:
        message = update.get("message") or {}
        text = (message.get("text") or "").replace("/start", "").strip()
        chat_id = str((message.get("chat") or {}).get("id", ""))
        user = pending.get(text)
        if user and chat_id:
            user.telegram_chat_id = chat_id
            user.telegram_link_code = None
            linked += 1
            send_telegram(chat_id, "AITrader2 linked ✅ — you'll receive daily "
                                   "recommendations and trade alerts here.")
    if linked:
        db.commit()
    return linked
