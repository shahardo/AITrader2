# auth.py — authentication endpoints: signup, login, and refresh-token exchange.

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, SignupRequest, TokenPair

router = APIRouter(prefix="/auth", tags=["auth"])


def _token_pair(user_id: int) -> TokenPair:
    """Build an access+refresh token pair for a user.

    Args:
        user_id: The user's primary key.

    Returns:
        TokenPair: Freshly signed tokens.
    """
    return TokenPair(
        access_token=create_token(user_id, "access"),
        refresh_token=create_token(user_id, "refresh"),
    )


@router.post("/signup", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Create a new account and return its first token pair.

    Args:
        payload: Email, password, and initial profile preferences.
        db: Request-scoped database session.

    Returns:
        TokenPair: Tokens for the new account.

    Raises:
        HTTPException: 409 if the email is already registered.
    """
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        risk_level=payload.risk_level,
        markets=payload.markets,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_pair(user.id)


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Authenticate with email/password and return a token pair.

    Args:
        payload: Login credentials.
        db: Request-scoped database session.

    Returns:
        TokenPair: Tokens for the authenticated account.

    Raises:
        HTTPException: 401 on unknown email or wrong password.
    """
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _token_pair(user.id)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenPair:
    """Exchange a valid refresh token for a new token pair.

    Args:
        payload: The refresh token.
        db: Request-scoped database session.

    Returns:
        TokenPair: New tokens.

    Raises:
        HTTPException: 401 if the refresh token is invalid or the user is gone.
    """
    try:
        user_id = decode_token(payload.refresh_token, expected_kind="refresh")
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token") from exc
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return _token_pair(user_id)
