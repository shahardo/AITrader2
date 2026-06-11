# auth.py — Pydantic request/response schemas for signup, login, and token refresh.

from pydantic import BaseModel, EmailStr, Field

from app.models.user import MarketPreference, RiskLevel, StrategySwitchMode


class SignupRequest(BaseModel):
    """Payload to create a new account."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    risk_level: RiskLevel = RiskLevel.balanced
    markets: MarketPreference = MarketPreference.both


class LoginRequest(BaseModel):
    """Payload to authenticate an existing account."""

    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    """Payload to exchange a refresh token for new tokens."""

    refresh_token: str


class TokenPair(BaseModel):
    """Access + refresh token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """Public representation of a user account."""

    id: int
    email: EmailStr
    risk_level: RiskLevel
    markets: MarketPreference
    strategy_switch_mode: StrategySwitchMode
    telegram_linked: bool = False

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """Editable profile fields; all optional for PATCH semantics."""

    risk_level: RiskLevel | None = None
    markets: MarketPreference | None = None
    strategy_switch_mode: StrategySwitchMode | None = None
