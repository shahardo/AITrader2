# db.py — SQLAlchemy engine/session setup and the declarative base shared by all models.
# Provides the FastAPI dependency `get_db` yielding a request-scoped session.

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Declarative base class for all ORM models."""


def _make_engine():
    """Create the SQLAlchemy engine from configured settings.

    Returns:
        Engine: engine bound to the configured database URL.
    """
    return create_engine(get_settings().database_url, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Yield a database session for one request, closing it afterwards.

    Yields:
        Session: SQLAlchemy session tied to the request lifecycle.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
