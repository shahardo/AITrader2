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

**M4 — Product surface**
- Telegram notifications: one-time-code account linking, daily recommendation
  digests, trade/strategy-change alerts; in-app notification feed with bell
- Hot-topics radar: LLM clusters recent headlines into themes; topic deep dives
  propose 5-15 candidates, **validate every ticker against real price data**
  (hallucinations dropped), add new names to the universe, and rank them
- On-demand universe scan: constituents refresh + discovery layer (Yahoo
  screeners: day gainers / most actives / small-cap gainers) + history sync
- Settings page: risk/markets/strategy-switch mode, Telegram link, re-scan

**M5 — Hardening**
- Outcome tracker (daily 06:00): fills 30-day signed returns on past BUY/SELL
  calls; hit-rate + average-return stats shown on the dashboard
- Degradation paths: LLM down → technical-only scoring (Null provider);
  dead sentiment sources/screeners are skipped; failed scans recorded
- Disclaimers on all recommendation surfaces

## Operations runbook

| Job | Schedule (Asia/Jerusalem) | What it does |
|---|---|---|
| `daily_pipeline` | Mon-Fri 23:45 | price refresh → indicators+sentiment → scores → per-portfolio recommendations → Telegram digests |
| `weekly_strategy` | Sun 08:00 | 10-month-train / 2-month-test evaluation → per-portfolio strategy reassignment (per user setting) |
| `outcome_tracker` | daily 06:00 | fills `outcome_30d` on month-old recommendations |

Manual triggers (all available in the UI): `POST /analysis/run`,
`POST /strategies/evaluate`, `POST /scans`,
`POST /portfolios/{id}/recommendations/generate`.

Degradation behavior: with no `GROQ_API_KEY` the pipeline runs technical-only
(sentiment and deep dives disabled); with no `TELEGRAM_BOT_TOKEN` notifications
stay in-app only. yfinance failures retry with backoff and skip dead symbols.

Known limits (free-data v1): TA-125 seed list is a partial snapshot — run
`scripts.validate_tase_coverage` and prune; Yahoo rate limits make the first
full history backfill slow; benchmark-index comparison (vs S&P 500 / TA-125)
is not yet wired into the performance charts.

## Quick start (Docker)

Requires Docker Desktop (Mac/Windows) or Docker Engine + the Compose plugin (Linux):

- Install: https://docs.docker.com/get-docker/
- Verify: `docker --version && docker compose version`

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

Backend (Python 3.11+), using [uv](https://docs.astral.sh/uv/) for the virtualenv and
package installs instead of `pip`:

Requires a running PostgreSQL 16+ instance and a `.env` file **inside `backend/`**
(`pydantic-settings` resolves `env_file=".env"` relative to the working directory, so the
root `.env` used by Docker isn't picked up when running commands from `backend/` — copy it:
`cp ../.env backend/.env`, or create one from `.env.example`).

`DATABASE_URL` must point at a database that already exists:

- If using a fresh Postgres install, create the `aitrader` role/database to match the
  default (`postgresql+psycopg://aitrader:aitrader@localhost:5432/aitrader`).
- If you already have a local Postgres instance, instead point `DATABASE_URL` at an
  existing superuser and run `CREATE DATABASE aitrader;` under that user, e.g.
  `postgresql+psycopg://postgres:<password>@localhost:5432/aitrader`.

```bash
# Install uv (if not already): https://docs.astral.sh/uv/getting-started/installation/

cd backend
uv venv
uv pip install -e ".[dev]" "pydantic[email]" lxml

uv run alembic upgrade head    # needs DATABASE_URL pointing at PostgreSQL
uv run uvicorn app.main:app --reload
uv run pytest && uv run ruff check app scripts tests
```

`uv run` executes inside `.venv` without needing to activate it (works the same in
PowerShell, cmd, and bash). To activate the venv directly instead: PowerShell
`.venv\Scripts\Activate.ps1`, cmd `.venv\Scripts\activate.bat`, bash `source .venv/Scripts/activate`.

Populate the universe and price history (run from `backend/`, with `.venv` active or via
`uv run`; first run takes a while on free Yahoo data):

```bash
uv run python -m scripts.load_universe
```

Useful flags: `--skip-prices` (only upsert instruments, no history sync), `--history-days N`
(default 730), `--limit N` (sync prices for only the first N instruments — handy for a quick
smoke test).

Validate TASE coverage on Yahoo (Milestone 1 go/no-go check):

```bash
uv run python -m scripts.validate_tase_coverage
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
