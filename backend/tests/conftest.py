# conftest.py — shared pytest fixtures: an isolated SQLite database per test and a
# FastAPI test client with the DB dependency overridden.

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 — register all tables on Base.metadata
from app.core.db import Base, get_db
from app.main import create_app


@pytest.fixture()
def db_session():
    """Yield a session bound to a fresh in-memory SQLite database."""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, expire_on_commit=False)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture()
def client(db_session):
    """Yield a TestClient whose requests share the test database session."""
    app = create_app()

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers(client):
    """Sign up a default user and return Bearer headers for them."""
    resp = client.post(
        "/api/v1/auth/signup",
        json={"email": "trader@example.com", "password": "s3cretpass"},
    )
    assert resp.status_code == 201
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}
