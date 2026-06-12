# AITrader2

AI-powered stock analysis and **paper-trading** bot for US and Israeli (TASE) equities.
It scans the market, recommends portfolios, issues daily buy/sell recommendations with
LLM-written rationales, re-evaluates strategies weekly, and surfaces hot investment topics.

> **Not financial advice.** v1 trades virtual portfolios only.

Docs: [PRD](docs/PRD.md) · [Development plan](docs/DEVELOPMENT_PLAN.md)

## Status

Milestones 1-2 are implemented:

**M1 — Foundation & data**
- FastAPI backend with JWT auth (signup/login/refresh, profile)
- PostgreSQL schema via Alembic (users, instruments, price_bars)
- Market data provider interface + yfinance implementation (US + TASE via `.TA`)
- Universe loader: S&P 500 + Nasdaq-100 live from Wikipedia (bundled fallbacks),
  TA-125 from a bundled seed list (`backend/app/universe/data/ta125.csv` — partial
  snapshot, verified by the coverage script)
- React frontend: login/signup + universe browser
- Tests on both ends, CI via GitHub Actions

**M2 — Analysis engines**
- 14 technical indicators implemented in pure pandas/numpy (`app/ta/`):
  SMA cross, EMA20, MACD, RSI, Stochastic, Bollinger, ATR, OBV, VWAP distance,
  ADX, Williams %R, CCI, trend-channel regression, pivot-based support/resistance
- Composite technical score (0-100) with strategy-overridable indicator weights
- LLM plug-in layer: `LLMProvider` interface, Groq Llama 4 implementation
  (Scout for bulk, Maverick for deep), call/cost audit log, Null fallback
- Sentiment pipeline: Yahoo RSS, Google News, Reddit, Globes (TASE) → LLM item
  scoring → recency-decayed composite with confidence weighting
- Blended stock scores + universe ranking; graceful technical-only degradation
- UI: stock detail page (candlestick chart with channel & S/R overlays, indicator
  panel, sentiment drill-down) and the Scores leaderboard with a manual run trigger

**M3 — Strategies & portfolios**
- Strategy library (momentum, mean-reversion, trend-following, balanced) behind a
  `TradingStrategy` interface with per-strategy parameter grids
- Backtest engine: signals on close, fills at next open with commission+slippage,
  equity curves, CAGR/Sharpe/maxDD/win-rate metrics, full trade log with reasons
- Weekly evaluator: **10-month train (grid search) / 2-month out-of-sample test**;
  only test metrics drive selection, with a churn guard (+0.3 Sharpe to switch)
- Multiple paper portfolios per user, each bound to a strategy; paper broker with
  cash/holdings invariants; equity-curve reconstruction and comparison
- Recommendation engine: onboarding initial proposal (approve-to-open) and daily
  SELL/BUY passes per portfolio with LLM rationales; auto-execute mode
- Celery beat wiring: nightly `daily_pipeline` (23:45 IL, Mon-Fri) and Sunday
  `weekly_strategy`
- UI: Portfolios dashboard (cards, create form, onboarding proposal, holdings,
  normalized comparison chart), Recommendations feed (approve/reject/generate),
  Strategy Lab (train vs test metrics, equity curves, trade-by-trade drill-down)

## Quick start (Docker)

```bash
cp .env.example .env       # set JWT_SECRET (and GROQ_API_KEY from M2 on)
docker compose up --build
```

- Web app: http://localhost:5173
- API docs: http://localhost:8000/docs

Populate the universe and price history (first run takes a while on free Yahoo data):

```bash
docker compose exec api python -m scripts.load_universe
```

Validate TASE coverage on Yahoo (Milestone 1 go/no-go check):

```bash
docker compose exec api python -m scripts.validate_tase_coverage
```

## Development without Docker

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" "pydantic[email]" lxml
alembic upgrade head          # needs DATABASE_URL pointing at PostgreSQL
uvicorn app.main:app --reload
pytest && ruff check app scripts tests
```

Frontend (Node 22):

```bash
cd frontend
npm install
npm run dev                   # proxies /api to http://localhost:8000
npm test && npx eslint src && npx tsc -b
```

## Repository layout

- `backend/app/` — FastAPI service: `core/` (config, DB, auth), `models/`, `api/`,
  `marketdata/` (provider interface + yfinance), `universe/` (constituents + loader),
  `jobs/` (Celery wiring)
- `backend/scripts/` — `load_universe`, `validate_tase_coverage`
- `frontend/src/` — React SPA: `api/` client, `pages/` (Login, Universe)
- `docs/` — PRD and development plan

## Development principles

- **Visibility first** — every backend feature ships with a UI surface in the same milestone.
- **Test first** — pytest + Vitest/RTL cover every feature; CI runs on every push.
- **Documented code** — every file starts with a header comment; functions carry Google-style docstrings.
