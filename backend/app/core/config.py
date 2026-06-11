# config.py — application settings loaded from environment variables (.env supported).
# Single source of truth for DB/Redis URLs, JWT parameters, CORS, and external API keys.

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration sourced from environment variables.

    Attributes:
        database_url: SQLAlchemy database URL for PostgreSQL (psycopg driver).
        redis_url: Redis URL used as Celery broker/result backend.
        jwt_secret: Secret key for signing JWT tokens. MUST be overridden in production.
        jwt_algorithm: Signing algorithm for JWTs.
        access_token_minutes: Lifetime of access tokens, in minutes.
        refresh_token_days: Lifetime of refresh tokens, in days.
        cors_origins: Comma-separated list of allowed CORS origins (frontend URLs).
        groq_api_key: Groq API key for LLM calls (used from Milestone 2 onward).
        environment: Deployment environment name ("dev", "test", "prod").
    """

    database_url: str = "postgresql+psycopg://aitrader:aitrader@localhost:5432/aitrader"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    cors_origins: str = "http://localhost:5173"
    groq_api_key: str = ""
    environment: str = "dev"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        """Return CORS origins as a list parsed from the comma-separated setting."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide cached Settings instance."""
    return Settings()
