# user.py — User account ORM model: credentials, risk profile, market preference,
# Telegram linkage, and strategy-switch behavior setting.

import enum
from datetime import UTC, datetime

from sqlalchemy import DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RiskLevel(str, enum.Enum):
    """User risk appetite, driving position-sizing constraints."""

    conservative = "conservative"
    balanced = "balanced"
    aggressive = "aggressive"


class MarketPreference(str, enum.Enum):
    """Which exchanges a user wants exposure to."""

    us = "us"
    tase = "tase"
    both = "both"


class StrategySwitchMode(str, enum.Enum):
    """Whether weekly strategy changes apply automatically or need user approval."""

    auto = "auto"
    approve = "approve"


class User(Base):
    """A registered account holder."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    risk_level: Mapped[RiskLevel] = mapped_column(
        Enum(RiskLevel, name="risk_level"), default=RiskLevel.balanced
    )
    markets: Mapped[MarketPreference] = mapped_column(
        Enum(MarketPreference, name="market_preference"), default=MarketPreference.both
    )
    strategy_switch_mode: Mapped[StrategySwitchMode] = mapped_column(
        Enum(StrategySwitchMode, name="strategy_switch_mode"), default=StrategySwitchMode.approve
    )
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), default=None)
    telegram_link_code: Mapped[str | None] = mapped_column(String(16), default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
