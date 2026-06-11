# users.py — current-user profile endpoints: fetch and update /me.

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.auth import UserOut, UserUpdate

router = APIRouter(prefix="/me", tags=["users"])


def _to_user_out(user: User) -> UserOut:
    """Map a User row to its public schema.

    Args:
        user: The ORM user.

    Returns:
        UserOut: Public representation including telegram_linked flag.
    """
    out = UserOut.model_validate(user)
    out.telegram_linked = user.telegram_chat_id is not None
    return out


@router.get("", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)) -> UserOut:
    """Return the authenticated user's profile.

    Args:
        user: The authenticated user (from the access token).

    Returns:
        UserOut: The profile.
    """
    return _to_user_out(user)


@router.patch("", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Update editable profile fields (risk level, markets, strategy-switch mode).

    Args:
        payload: Fields to change; unset fields are left untouched.
        user: The authenticated user.
        db: Request-scoped database session.

    Returns:
        UserOut: The updated profile.
    """
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_out(user)
