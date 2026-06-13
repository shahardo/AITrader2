# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AITrader2 is an AI-assisted **paper-trading** research app for US and Israeli (TASE) equities:
FastAPI backend + Celery jobs + PostgreSQL, React/Vite frontend. It scans the market, scores
stocks (technical + LLM-scored sentiment), backtests/evaluates strategies, runs paper
portfolios, and issues daily BUY/SELL recommendations with LLM rationales. See
[docs/PRD.md](docs/PRD.md) and [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for full
specs.

## Commands

### Backend (Python 3.11+, uses `uv` instead of pip)

```bash
cd backend
uv venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
uv pip install -e ".[dev]" "pydantic[email]" lxml

alembic upgrade head                   # needs DATABASE_URL pointing at PostgreSQL
uvicorn app.main:app --reload

pytest                                  # full suite
pytest tests/test_backtest.py           # one file
pytest tests/test_backtest.py::test_name  # one test
pytest -k "expr"                        # by name pattern

ruff check app scripts tests            # lint (E/F/I/D — Google docstrings)
```

### Frontend (Node 22)

```bash
cd frontend
npm install
npm run dev                             # proxies /api to http://localhost:8000

npm test                                 # vitest run (all)
npx vitest run src/__tests__/Login.test.tsx  # one file
npx eslint src
npx tsc -b
```

### Docker (full stack: db, redis, api, worker, beat, web)

```bash
cp .env.example .env                    # set JWT_SECRET, GROQ_API_KEY, TELEGRAM_BOT_TOKEN
docker compose up --build

docker compose exec api python -m scripts.load_universe         # populate universe + history
docker compose exec api python -m scripts.validate_tase_coverage # TA-125 seed list check
```

## Architecture

### Layering

`app/api/*.py` (FastAPI routers, mounted under `/api/v1` in `app/main.py`) →
`app/schemas/*.py` (Pydantic I/O) → domain service modules → `app/models/*.py` (SQLAlchemy).
DB sessions come from `core.db.get_db` (per-request session); authenticated routes depend on
`api.deps.get_current_user`, which decodes the JWT bearer token (`core/security.py`) into a
`User`. All new ORM models must be imported in `app/models/__init__.py` so
`Base.metadata` (and Alembic autogeneration / test `create_all`) sees them.

### Scheduled pipeline (Celery beat, `app/jobs/celery_app.py`, Asia/Jerusalem tz)

- **`daily_pipeline`** (Mon-Fri 23:45): `marketdata.service.sync_price_history` →
  `analysis.service.run_analysis` (technical + sentiment + blend + rank) →
  `recommend.engine.generate_daily_recommendations` per portfolio (auto-executes if
  `portfolio.auto_execute`) → Telegram/in-app `notify`.
- **`weekly_strategy`** (Sun 08:00): `strategy.evaluator.evaluate_all_strategies` (10-month
  train / 2-month test) → `recommend_strategy` per portfolio. If
  `user.strategy_switch_mode == auto`, reassigns immediately (subject to the churn guard);
  otherwise just notifies the user to approve in the Strategy Lab.
- **`outcome_tracker`** (daily 06:00, `app/jobs/outcomes.py`): fills `outcome_30d` on
  month-old recommendations for hit-rate stats.

### Analysis pipeline (`app/analysis/service.py`)

1. `analyze_technical` — loads recent OHLCV (`load_ohlcv`), runs the 14 indicators in
   `app/ta/indicators.py` through `ta.scoring.compute_signals`/`composite_score` (0-100),
   plus `ta.trend_channel` and `ta.support_resistance` → persists `IndicatorSnapshot`.
2. `analyze_sentiment` — pulls items from `sentiment.sources` (Yahoo RSS, Google News,
   Reddit, Globes for TASE), LLM-scores each item (`sentiment.scoring.score_item`), combines
   into a recency-decayed, confidence-weighted composite → persists `SentimentItem`/
   `SentimentScore`.
3. `blend_and_store` — `combined = (1 - 0.4*confidence) * technical + 0.4*confidence *
   scaled_sentiment`. When sentiment is unavailable, `combined == technical` and
   `sentiment_score` is `None` (technical-only degradation). Results land in `StockScore`,
   ranked per day.

### LLM provider abstraction (`app/llm/`)

`LLMProvider` (ABC, `provider.py`) exposes one method, `complete(call_site, system, user,
tier=ModelTier.bulk|deep, json_mode=...)`, returning an `LLMResult` (with `.parsed` for JSON
mode) or raising `LLMUnavailable`. `groq_provider.py` implements it with Groq's Llama 4
(Scout=bulk, Maverick=deep) and logs every call to `LLMCall` for cost/latency auditing.
`build_default_provider()` returns `NullLLMProvider` when `GROQ_API_KEY` is empty — **every
call site must catch `LLMUnavailable` and degrade** (this is the project-wide pattern for
"LLM down → technical-only"). `parse_json_content` handles markdown-fenced JSON output.

### Strategies & backtesting (`app/strategy/`)

- `base.py`: `TradingStrategy` ABC. `build_features(df)` precomputes sma20/50/200, rsi,
  ret_63/ret_126, atr, adx/+DI/-DI once per symbol (vectorized). `decide(features, day,
  holding)` returns a `Decision(action, score, reasons)`.
- `library.py`: registry of four strategies — momentum, mean_reversion, trend_following,
  balanced — each with a `param_grid` (grid-search space) and a default `risk_fit`.
- `backtest.py`: signals evaluated on close, fills simulated at next open, with commission +
  slippage; produces equity curve, CAGR/Sharpe/maxDD/win-rate, and a full trade log
  (`triggering_signals` JSON powers the Strategy Lab drill-down).
- `evaluator.py`: `evaluate_all_strategies` runs **10-month train (grid search) / 2-month
  out-of-sample test** per strategy/symbol set, recording `StrategyRun` rows — only test
  metrics drive selection. `recommend_strategy` picks the best fit for a user's risk level,
  requiring a **+0.3 Sharpe improvement** (churn guard) before suggesting a switch away from
  the current strategy.

### Portfolios & recommendations (`app/portfolio/`, `app/recommend/`)

Paper portfolios (`PortfolioModel`/`Holding`/`TradeModel`) enforce cash/holdings invariants
via the paper broker in `portfolio/service.py`, with equity-curve reconstruction for the
comparison chart. `recommend/engine.py` runs the portfolio's assigned strategy's `decide()`
against each candidate/held symbol's latest features, writes `Recommendation` rows
(BUY/SELL/HOLD, confidence, signals, LLM-written explanation via deep tier), and
auto-executes against the paper broker when `auto_execute` is set.

### Universe (`app/universe/`)

`constituents.py` loads S&P 500 + Nasdaq-100 live from Wikipedia (bundled CSV fallbacks) and
TA-125 from the bundled seed `app/universe/data/ta125.csv` (a partial snapshot — validate with
`scripts.validate_tase_coverage`). `discovery.py` adds candidates from Yahoo screeners (day
gainers / most actives / small-cap gainers) during on-demand scans
(`POST /scans`). `marketdata/` wraps `yfinance` behind the `MarketDataProvider` interface
(`.TA` suffix for TASE symbols), with retry/backoff and dead-symbol skipping.
`YFinanceProvider.fetch_company_profile` does a separate best-effort, non-retrying lookup of
`website`/`longBusinessSummary` via `yf.Ticker(symbol).info`; `GET /instruments/{symbol}` lazily
fetches and persists these onto `Instrument` on first view (`profile_fetched_at` marks the
attempt, success or not, so it's never repeated) for the stock detail page's company info card.

### Frontend (`frontend/src/`)

React 19 + Vite + TanStack Query + Tailwind v4 + react-router-dom v7. `api/client.ts` is a
single typed fetch client whose interfaces mirror the backend Pydantic schemas, plus
token storage (`getTokens`/`clearTokens`, localStorage). `App.tsx` defines the route table, a
left `SideBar` of nav links, a top `components/Header.tsx` (logo + notification bell, theme
toggle, language toggle, logout — all hidden on `/login`), and a `RequireAuth` guard that
redirects to `/login` when no tokens are stored. Pages map ~1:1 to backend domains
(Portfolios, Recommendations, StrategyLab, Universe, Scores, Topics, Settings, StockDetail,
Login, Onboarding). Charts use `lightweight-charts` (`CandleChart` — candles +
trend channel + S/R overlays) and a custom `LineCompareChart` for normalized equity-curve
comparisons. Shared components include `MultiSelectFilter` (checkbox-dropdown column filter,
used by Universe's Exchange/Sector columns) and `CompanyLogo` (Clearbit → Google favicon →
initials fallback chain for the stock detail company card; pass `key={website}` so callers
reset the fallback index on a company change).

### Theming, i18n & RTL (`frontend/src/index.css`, `contexts/ThemeContext.tsx`, `i18n/`)

`index.css` maps semantic Tailwind utilities (`bg-panel`, `text-ink-2`, `text-accent`,
`border-edge`, `text-positive`/`text-negative`/`text-warning`, etc.) via the Tailwind v4
`@theme` directive to `--c-*` CSS custom properties, which are redefined per `.dark`/`.light`
class and per `[data-section]` attribute on `<html>` — so the same class names resolve to
different colors for light/dark mode and for each nav section's accent hue (portfolios:
emerald default, recommendations: blue, strategies: violet, universe: amber, scores: cyan,
topics: rose, settings: orange, stock-detail: teal). `ThemeProvider`
(`contexts/ThemeContext.tsx`, wraps `<App/>` inside `BrowserRouter` in `main.tsx`) holds
`scheme: 'dark'|'light'` (persisted to `localStorage` as `aitrader-color-scheme`, default
`dark`), applies the `.dark`/`.light` class to `<html>`, and sets `data-section` from the
current route via `sectionForPath()`. `useTheme()` exposes `{ scheme, toggleScheme }` for the
header's theme toggle and for chart components. Canvas-based `lightweight-charts` components
(`CandleChart`, `LineCompareChart`) can't use Tailwind classes, so they get colors from the
static `lib/chartTheme.ts#chartTheme(scheme)` palette (mirroring the `--c-*` values) and
re-create the chart when `scheme` changes. A static palette (rather than reading `--c-*` via
`getComputedStyle`) avoids a race with `ThemeProvider`'s effect that toggles the `.dark`/`.light`
class on `<html>` — child effects run before parent effects, so a DOM read would always see the
previous scheme's class.

Translations live in `i18n/locales/{en,he}/*.json`, one namespace per page plus shared
`common`/`nav` namespaces, loaded synchronously by `i18n/index.ts` (react-i18next +
`i18next-browser-languagedetector`, persisted to `localStorage` as `aitrader-language`,
`fallbackLng: 'en'`). Pages call `useTranslation('<namespace>')` (or an array to also reach
`common:*` keys). `ThemeProvider` also keeps `<html lang>`/`<html dir>` in sync with
`i18n.language` — Hebrew (`he`) sets `dir="rtl"`. RTL-aware components use Tailwind logical
properties (`ms-*`/`me-*`/`ps-*`/`pe-*`/`text-start`/`text-end`/`border-s*`/`border-e*`/
`start-*`/`end-*`) instead of physical ones (`ml-*`/`mr-*`/`pl-*`/`pr-*`/`text-left`/
`text-right`/`left-*`/`right-*`) so layouts mirror automatically. API-returned data (symbols,
strategy names/descriptions, LLM-written rationales) is never translated — only UI chrome.
Backend `HTTPException` `detail` strings are the one exception: they're plain English, but
Login/Onboarding/Recommendations show them verbatim as alerts, so
`lib/apiErrors.ts#translateApiError` maps known `detail` strings to `common:apiErrors.*` keys
(falling back to the raw English for unmapped messages) — add new entries there when a new
user-facing `HTTPException` detail is introduced.

### Onboarding (`app/api/onboarding.py`, `frontend/src/pages/Onboarding.tsx`)

`GET /onboarding/status` reports first-login setup progress (universe/prices/scores are
global checks; portfolio/recommendations are scoped to the user). After login the frontend
redirects to the `/onboarding` wizard while `complete` is false, unless the account
dismissed it (`isOnboardingDismissed`/`dismissOnboarding` in `api/client.ts`, localStorage
keyed by email). The wizard derives its starting step from the status flags (already-done
steps are skipped) and reuses existing endpoints per step: `PATCH /me` → `POST /scans` →
`POST /analysis/run` → `POST /portfolios` → initial-proposal generate/approve.

### Admin / danger zone (`app/api/admin.py`, Settings page)

`POST /admin/clear-data` deletes every row from all app-data tables (universe, prices,
indicator/sentiment/stock scores, LLM call log, topics, notifications, scans, strategies +
runs + backtest trades, portfolios, holdings, trades, recommendations) in
children-before-parents order, but leaves `users` untouched — sessions stay valid.
`POST /admin/clear-data-and-users` does the same and additionally deletes all `User` rows,
invalidating every access/refresh token. The Settings page's "Danger zone" section exposes
both behind an inline confirm step; the second one calls `clearTokens()` and redirects to
`/login` on success.

### Testing conventions

Backend `tests/conftest.py` provides: `db_session` (fresh in-memory SQLite per test, all
models registered via `import app.models`), `client` (FastAPI `TestClient` with `get_db`
overridden to the test session), and `auth_headers` (signs up a default user, returns a
Bearer header). Frontend tests live in `src/__tests__/`, one file per page, using Vitest + RTL
with `src/test-setup.ts`.

### Config & degradation (`app/core/config.py`)

`Settings` (pydantic-settings, `.env`-backed): `database_url`, `redis_url`, `jwt_secret`,
`groq_api_key`, `telegram_bot_token`, `cors_origins`, `environment`. Empty `GROQ_API_KEY` →
technical-only pipeline (sentiment/deep-dives disabled, `NullLLMProvider`). Empty
`TELEGRAM_BOT_TOKEN` → notifications stay in-app only.

## Conventions

- Every file opens with a one/two-line header comment describing its role; every function
  carries a Google-style docstring (enforced by ruff's `D` rules, `tool.ruff.lint.pydocstyle`
  in `backend/pyproject.toml`).
- Backend features ship with a corresponding UI surface in the same milestone — check
  `frontend/src/pages/` and `api/client.ts` when adding a new backend capability.
- After any change in the app model/structure/functionality, update readme.md and claude.md.
- For new features, allways include tests. After editting features, run their respective tests.
