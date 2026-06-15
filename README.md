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
- React frontend: login/signup + universe browser (multi-select Exchange/Sector filters,
  last-close change vs. previous close with colored up/down arrow)
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
- UI: stock detail page (company info card with logo/website/description always
  shown left-to-right, candlestick chart with channel & S/R overlays, a headline
  BUY/SELL/HOLD recommendation with a plain-language explanation derived from the
  indicators and sentiment, indicator panel with per-indicator info explanations,
  sentiment drill-down, manual analysis-run trigger with a loading spinner) and
  the Scores leaderboard, also with a manual run trigger; the Universe browser
  shows a colored BUY/SELL/HOLD recommendation badge with its weighted (combined)
  score for any instrument with a latest score

**M3 — Strategies & portfolios**
- Strategy library (momentum, mean-reversion, trend-following, balanced, evolved) behind a
  `TradingStrategy` interface with per-strategy parameter grids
- Backtest engine: signals on close, fills at next open with commission+slippage,
  equity curves, CAGR/Sharpe/maxDD/win-rate metrics, full trade log with reasons
- Weekly evaluator: **10-month train (grid search) / 2-month out-of-sample test**;
  only test metrics drive selection, with a churn guard (+0.3 Sharpe to switch)
- Genetic algorithm evolves the "evolved" strategy's signal-weight/threshold gene
  (stdlib `random`; tournament selection, crossover, mutation, elitism), triggered
  manually from the Strategy Lab (with live generation/fitness progress) or weekly;
  keeps the top-5 candidates with their own train/test metrics, equity curves and trades
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
- Settings danger zone: clear all app data (keeps accounts), or clear all data
  and every user account (signs everyone out)

**M5 — Hardening**
- Outcome tracker (daily 06:00): fills 30-day signed returns on past BUY/SELL
  calls; hit-rate + average-return stats shown on the dashboard
- Degradation paths: LLM down → technical-only scoring (Null provider);
  dead sentiment sources/screeners are skipped; failed scans recorded
- Disclaimers on all recommendation surfaces
- First-login onboarding wizard (`/onboarding`): guides new users through
  profile setup → universe load → first analysis → portfolio creation → initial
  recommendations, skipping steps already done (`GET /onboarding/status`);
  login redirects there until setup is complete or the wizard is skipped
- Light/dark mode toggle, persisted per browser
- Per-section accent colors: each nav destination (Portfolios, Recommendations, Strategy Lab,
  Universe, Scores, Topics, Settings, stock detail) gets its own accent hue across both themes
- Hebrew translation with full RTL layout support, alongside English; switchable from the
  page header and persisted per browser
- Universe browser: sortable columns (symbol, name, exchange, sector, last close,
  recommendation) with ascending/descending toggle, a multi-select recommendation filter, and
  a sticky title/search/header while only the row list scrolls
- Live progress status lines for long-running operations, backed by an in-process progress
  registry (`app/core/progress.py`) polled by the frontend: the Settings universe re-scan
  shows e.g. "Scanning for new listings: TSLA (3/10)", and Topics deep dives show e.g.
  "Reading article for AAPL (3/12)"; starting a new deep dive clears any previously shown
  report until the new one is ready

## Operations runbook

| Job | Schedule (Asia/Jerusalem) | What it does |
|---|---|---|
| `daily_pipeline` | Mon-Fri 23:45 | price refresh → indicators+sentiment → scores → per-portfolio recommendations → Telegram digests |
| `weekly_strategy` | Sun 08:00 | 10-month-train / 2-month-test evaluation → per-portfolio strategy reassignment (per user setting); also refreshes the "evolved" strategy's gene via the genetic algorithm |
| `outcome_tracker` | daily 06:00 | fills `outcome_30d` on month-old recommendations |

Manual triggers (all available in the UI): `POST /analysis/run`,
`POST /strategies/evaluate`, `POST /strategies/evolve` (async, poll
`GET /strategy-evolution-runs/{id}` or `GET /strategy-evolution-runs`), `POST /scans`,
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

Alternatively, just sign up in the web app: the first-login onboarding wizard can load
the universe, run the first analysis, and set up your first portfolio from the UI.

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

Background jobs — `POST /strategies/evolve` and the daily/weekly/outcome-tracker jobs in the
[Operations runbook](#operations-runbook) — run via Celery and need a local Redis as the
broker plus a worker process consuming the queue; `uvicorn` alone won't run them:

```bash
# Redis: run a local redis-server so REDIS_URL (default redis://localhost:6379/0) connects.
# On Windows, scripts/start-redis.ps1 launches the redis-windows-fork build (winget install
# taizod1024.redis-windows-fork) with its dump.rdb under .redis-data/ (gitignored):
powershell -ExecutionPolicy Bypass -File scripts\start-redis.ps1
# Elsewhere, use your package manager's redis-server.

uv run celery -A app.jobs.celery_app worker --pool=solo --loglevel=info  # --pool=solo required on Windows
uv run celery -A app.jobs.celery_app beat --loglevel=info                # optional: scheduled jobs
```

Without a running Redis and worker, `POST /strategies/evolve` now fails fast with a 503
("task queue unavailable") and marks the run `failed` instead of leaving it `pending`
forever. With Redis up but no worker, `.delay()`-dispatched tasks (e.g. a Strategy Lab
"Build strategy" click) queue in Redis but never execute, leaving
`StrategyEvolutionRun.status` stuck at `pending` and the UI stuck on "Evolving…".

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
- `frontend/src/` — React SPA: `api/` client, `pages/` (one per nav section), `contexts/`
  (theme/locale), `i18n/locales/{en,he}/` (translations)
- `docs/` — PRD and development plan

## Development principles

- **Visibility first** — every backend feature ships with a UI surface in the same milestone.
- **Test first** — pytest + Vitest/RTL cover every feature; CI runs on every push.
- **Documented code** — every file starts with a header comment; functions carry Google-style docstrings.
