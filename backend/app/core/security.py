# security.py — password hashing (bcrypt) and JWT creation/validation helpers
# used by the auth API and the current-user dependency.

from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import get_settings


def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt.

    Args:
        password: The plaintext password.

    Returns:
        str: The bcrypt hash, utf-8 decoded for DB storage.
    """
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash.

    Args:
        password: The plaintext password to verify.
        password_hash: The stored bcrypt hash.

    Returns:
        bool: True if the password matches.
    """
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: int, kind: str) -> str:
    """Create a signed JWT for a user.

    Args:
        user_id: The subject user's primary key.
        kind: Token kind, "access" or "refresh"; controls expiry.

    Returns:
        str: Encoded JWT.

    Raises:
        ValueError: If `kind` is not "access" or "refresh".
    """
    settings = get_settings()
    if kind == "access":
        delta = timedelta(minutes=settings.access_token_minutes)
    elif kind == "refresh":
        delta = timedelta(days=settings.refresh_token_days)
    else:
        raise ValueError(f"Unknown token kind: {kind}")
    payload = {
        "sub": str(user_id),
        "kind": kind,
        "exp": datetime.now(UTC) + delta,
        "iat": datetime.now(UTC),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_kind: str) -> int:
    """Decode and validate a JWT, returning the user id.

    Args:
        token: The encoded JWT.
        expected_kind: Required token kind ("access" or "refresh").

    Returns:
        int: The user id from the token subject.

    Raises:
        jwt.InvalidTokenError: If the token is expired, malformed, or of the wrong kind.
    """
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if payload.get("kind") != expected_kind:
        raise jwt.InvalidTokenError(f"Expected a {expected_kind} token")
    return int(payload["sub"])
