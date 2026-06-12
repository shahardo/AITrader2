# main.py — FastAPI application factory: CORS, router mounting, and health check.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analysis, auth, instruments, portfolios, strategies, users
from app.core.config import get_settings


def create_app() -> FastAPI:
    """Build the configured FastAPI application.

    Returns:
        FastAPI: Application with CORS and all v1 routers mounted.
    """
    app = FastAPI(title="AITrader2 API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    prefix = "/api/v1"
    app.include_router(auth.router, prefix=prefix)
    app.include_router(users.router, prefix=prefix)
    app.include_router(instruments.router, prefix=prefix)
    app.include_router(analysis.router, prefix=prefix)
    app.include_router(portfolios.router, prefix=prefix)
    app.include_router(strategies.router, prefix=prefix)

    @app.get("/health", tags=["ops"])
    def health() -> dict:
        """Liveness probe used by Docker Compose and CI smoke tests.

        Returns:
            dict: {"status": "ok"}.
        """
        return {"status": "ok"}

    return app


app = create_app()
