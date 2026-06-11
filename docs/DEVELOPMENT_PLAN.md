# AITrader2 — Development Plan

**Version:** 1.0 | **Date:** 2026-06-11 | **Status:** Pending approval
Companion to [PRD.md](./PRD.md). This document is the implementation blueprint: stack, repo layout, data model, APIs, algorithms, LLM call sites, and a milestone-by-milestone task breakdown with verification steps.

---

## 1. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2 | async API service |
| ORM / migrations | SQLAlchemy 2.0 + Alembic | |
| DB | PostgreSQL 16 | prices, scores, portfolios, everything |
| Jobs | Celery + Redis (broker/result), Celery Beat | daily/weekly pipelines, on-demand scans |
| Market data | `yfinance` behind `MarketDataProvider` interface | US + TASE (`.TA` suffix) |
| Technical analysis | `pandas` + `pandas-ta`; custom code for trend channel & S/R | |
| LLM | `groq` SDK behind `LLMProvider` interface | Llama 4 Maverick (deep) + Scout (bulk) |
| Sentiment ingestion | `feedparser` (RSS), Reddit public JSON API, `httpx` | |
| Notifications | `python-telegram-bot` | linked per user via one-time code |
| Frontend | React 18 + TypeScript + Vite, TanStack Query, Tailwind CSS | |
| Charts | `lightweight-charts` (TradingView) for candles/overlays; `recharts` for equity curves | |
| Auth | JWT (access+refresh), `passlib[bcrypt]` | |
| Backend tests | `pytest`, `pytest-asyncio`, `httpx` test client, `factory_boy` | |
| Frontend tests | Vitest + React Testing Library | |
| CI | GitHub Actions: lint (ruff, eslint), typecheck (mypy, tsc), tests both ends | |
| Deployment | Docker Compose: `api`, `worker`, `beat`, `db`, `redis`, `web` | local-first |

## 2. Repository layout

```
AITrader2/
├── docker-compose.yml
├── .env.example
├── .github/workflows/ci.yml
├── docs/                      # PRD.md, DEVELOPMENT_PLAN.md, ADRs
├── backend/
│   ├── pyproject.toml
│   ├── alembic/               # migrations
│   ├── app/
│   │   ├── main.py            # FastAPI app factory, router mounting
│   │   ├── core/              # config.py, db.py, security.py, logging.py
│   │   ├── models/            # SQLAlchemy models (one file per domain)
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── api/               # routers: auth, users, instruments, scores,
│   │   │                      #  portfolios, recommendations, strategies,
│   │   │                      #  topics, scans, notifications
│   │   ├── marketdata/        # provider.py (ABC), yfinance_provider.py, cache.py
│   │   ├── universe/          # constituents.py, discovery.py
│   │   ├── ta/                # indicators.py, trend_channel.py, support_resistance.py, scoring.py
│   │   ├── sentiment/         # source.py (ABC), rss_news.py, google_news.py,
│   │   │                      #  reddit.py, israeli_press.py, scoring.py
│   │   ├── llm/               # provider.py (ABC), groq_provider.py, prompts/, budget.py
│   │   ├── strategy/          # base.py (ABC), momentum.py, mean_reversion.py,
│   │   │                      #  trend_following.py, balanced.py,
│   │   │                      #  backtest.py, evaluator.py
│   │   ├── recommend/         # engine.py, initial_portfolio.py, explanations.py
│   │   ├── portfolio/         # service.py, paper_broker.py, performance.py
│   │   ├── topics/            # radar.py, deep_dive.py
│   │   ├── notify/            # telegram_bot.py, feed.py
│   │   └── jobs/              # celery_app.py, daily_pipeline.py,
│   │                          #  weekly_strategy.py, scan.py
│   └── tests/                 # mirrors app/ structure
└── frontend/
    ├── package.json, vite.config.ts
    └── src/
        ├── api/               # typed client (generated from OpenAPI)
        ├── components/        # shared UI
        ├── pages/             # Dashboard, Onboarding, Recommendations,
        │                      #  StockDetail, StrategyLab, Portfolios,
        │                      #  Topics, ScanResults, Settings, Login
        └── __tests__/
```

Every file opens with a header comment describing its role; every function has a Google-style docstring (enforced by ruff `D` rules / eslint jsdoc).

## 3. Data model (PostgreSQL)

Key tables (columns abridged; all have `id`, `created_at`):

- **users** — email, password_hash, risk_level, markets, telegram_chat_id, strategy_switch_mode (auto/approve)
- **instruments** — symbol, exchange (US/TASE), name, sector, currency, is_active, in_universe_since
- **price_bars** — instrument_id, date, open, high, low, close, volume; unique(instrument_id, date)
- **indicator_snapshots** — instrument_id, date, JSONB of all 14 indicator values + per-indicator signal (−1/0/+1), technical_score (0–100)
- **sentiment_items** — instrument_id, source, url, title, published_at, llm_sentiment (−1..+1), llm_relevance (0..1), summary
- **sentiment_scores** — instrument_id, date, composite_score, item_count, confidence
- **stock_scores** — instrument_id, date, technical_score, sentiment_score, combined_score, rank
- **scans** — triggered_by, started_at, finished_at, status, stats JSONB; discovery additions linked via instruments
- **strategies** — name, kind, params JSONB, risk_fit, description
- **strategy_runs** — strategy_id, run_date, train_start/end, test_start/end, train_metrics JSONB, test_metrics JSONB (CAGR, Sharpe, max drawdown, win rate), equity_curve JSONB, status
- **backtest_trades** — strategy_run_id, instrument_id, side, date, price, qty, triggering_signals JSONB ← powers Strategy Lab trade-by-trade drill-down
- **portfolios** — user_id, name, strategy_id, initial_capital, cash, auto_execute, benchmark
- **holdings** — portfolio_id, instrument_id, qty, avg_cost
- **trades** — portfolio_id, instrument_id, side, qty, price, executed_at, recommendation_id
- **recommendations** — portfolio_id, instrument_id, action (BUY/SELL/HOLD), qty, confidence, signals JSONB, explanation, status (pending/approved/rejected/executed/expired), outcome_30d (filled later for hit-rate)
- **topics** — name, buzz_score, status (hot/user_requested), summary
- **topic_reports** — topic_id, report markdown, candidates JSONB (ticker, score, rationale)
- **notifications** — user_id, kind, payload JSONB, read, sent_telegram
- **llm_calls** — call_site, model, tokens_in/out, cost, latency, success — budget observability

## 4. API surface (FastAPI, `/api/v1`)

- **auth**: `POST /auth/signup`, `/auth/login`, `/auth/refresh`
- **users**: `GET/PATCH /me`, `POST /me/telegram-link` (one-time code)
- **instruments**: `GET /instruments` (filter/sort by scores), `GET /instruments/{symbol}` (detail: bars, indicators, S/R, channel, sentiment items)
- **scans**: `POST /scans` (trigger full re-scan), `GET /scans/{id}`, `GET /scans/latest`
- **portfolios**: `GET/POST /portfolios`, `PATCH/DELETE /portfolios/{id}`, `GET /portfolios/{id}/performance` (equity curve vs benchmark), `GET /portfolios/compare?ids=...`
- **onboarding**: `POST /portfolios/{id}/initial-proposal`, `POST /portfolios/{id}/initial-proposal/approve`
- **recommendations**: `GET /recommendations?portfolio_id=`, `POST /recommendations/{id}/approve|reject`
- **strategies**: `GET /strategies`, `GET /strategies/{id}` (rules + plain-language), `GET /strategies/{id}/runs`, `GET /strategy-runs/{id}` (metrics, equity curve), `GET /strategy-runs/{id}/trades`
- **topics**: `GET /topics/hot`, `POST /topics/deep-dive` (topic name or free text), `GET /topic-reports/{id}`
- **notifications**: `GET /notifications`, `POST /notifications/{id}/read`

Frontend API client generated from the OpenAPI schema (`openapi-typescript`) so backend changes surface as type errors.

## 5. Analysis algorithms

### 5.1 Technical scoring
Each indicator emits a signal in {−1, 0, +1} (sell/neutral/buy) plus a strength value. Composite:

```
technical_score = 50 + 50 * Σ(w_i * signal_i * strength_i) / Σ(w_i)
```

Default weights: trend indicators (SMA cross, ADX, trend channel slope) ×1.5; oscillators (RSI, Stoch, W%R, CCI) ×1.0; volume (OBV, VWAP-dist) ×1.0; volatility (BB, ATR) ×0.75; MACD ×1.25; S/R proximity ×1.25. Weights are strategy-overridable (each strategy can re-weight indicators).

- **Trend channel**: 90-day linear regression on log-close; channel = fit ± k·σ of residuals; outputs slope (annualized %), width, and position-in-channel (0=lower band, 1=upper). Buy bias near the lower band of an up-sloping channel; sell bias near the upper band of a down-sloping channel.
- **Support/Resistance**: swing-point pivots (fractal window=5) clustered within 1×ATR; levels scored by touch count and recency. Output: nearest support/resistance and distance in ATR units.

### 5.2 Sentiment scoring
Per item the LLM (Scout, JSON-schema output) returns `{sentiment: −1..1, relevance: 0..1, summary}`. Composite per symbol per day:

```
sentiment_score = Σ(sent_i * rel_i * exp(-age_days_i / 7)) / Σ(rel_i * exp(-age_days_i / 7))
confidence = f(item_count, source_diversity)
```

### 5.3 Combined score
`combined = 0.6 * technical + 0.4 * scaled_sentiment` by default; when sentiment confidence is low, weight shifts toward technical (degradation path).

### 5.4 Strategy evaluation (weekly)
1. Window = trailing 365 days. **Train = first 10 months** (parameter grid search per strategy: e.g., momentum lookback, RSI bounds, channel-position thresholds). **Test = last 2 months**, run once with the chosen params — never re-fit on test.
2. Metrics on both windows: CAGR, Sharpe, max drawdown, win rate, turnover. **Selection uses test metrics only**, with a churn guard: switch a portfolio's strategy only if the challenger's test Sharpe beats the incumbent's by >0.3.
3. Every run persists equity curve + each simulated trade with its triggering signals → Strategy Lab.
4. Execution model in backtests: signals on day T's close, fills at day T+1's open, commission 0.1%/side + 0.05% slippage.

### 5.5 Daily recommendation engine
Per portfolio: strategy maps holdings + top-N scored candidates → actions; position sizing = risk-profile-bounded equal-risk weighting (max weight per stock: conservative 8%, balanced 12%, aggressive 20%; sector cap 30%). Confidence = blend of signal strength, sentiment confidence, and strategy test-window performance.

## 6. LLM call sites (all via `LLMProvider`, JSON-schema validated, logged to `llm_calls`)

| # | Call site | Model | Purpose |
|---|---|---|---|
| 1 | `sentiment.score_item` | Scout | sentiment/relevance/summary per news item (batched) |
| 2 | `recommend.explain` | Maverick | human-readable rationale per recommendation |
| 3 | `recommend.initial_portfolio_rationale` | Maverick | onboarding portfolio narrative |
| 4 | `topics.radar` | Maverick | cluster news buzz into named themes |
| 5 | `topics.deep_dive` | Maverick | theme summary + candidate tickers (each validated against `instruments` / yfinance before use) |
| 6 | `strategy.describe` | Scout | plain-language strategy rules for Strategy Lab |
| 7 | `strategy.change_rationale` | Maverick | weekly strategy-switch explanation |

Provider interface: `complete(prompt, schema, model_tier, temperature)` with retry/backoff, per-day token budget, and circuit breaker (on LLM outage → technical-only mode, FR degradation path).

## 7. Scheduled jobs (Celery Beat, times in Asia/Jerusalem)

| Job | Schedule | Steps |
|---|---|---|
| `daily_pipeline` | Mon–Fri 23:45 (post-US close; TASE data already final) | refresh EOD bars → indicators → fetch+score sentiment → stock_scores → per-portfolio recommendations → auto-execute paper trades → notify |
| `weekly_strategy` | Sunday 08:00 | strategy evaluation (§5.4) → per-portfolio strategy recommendation → apply/ask per user setting → notify |
| `scan` | on-demand | rebuild universe (indices + discovery) → full pipeline for new symbols → refresh hot topics |
| `outcome_tracker` | daily | fill `outcome_30d` on month-old recommendations → hit-rate stats |

## 8. Milestone task breakdown

Every feature lands with: backend tests (pytest), frontend tests (Vitest/RTL), and a visible UI surface — in the same milestone (visibility-first, test-first).

### M1 — Foundation & data (est. effort: ~20%)
1. Scaffolding: docker-compose (6 services), backend/frontend skeletons, ruff+mypy+eslint+tsc, GitHub Actions CI running both test suites.
2. Core: config via env, DB session, Alembic baseline migration, JWT auth.
3. `MarketDataProvider` ABC + yfinance implementation with Postgres bar cache, batching, retry/backoff.
4. Universe loader: S&P 500 + Nasdaq-100 + TA-125 constituents; **TASE coverage validation script** (report % of TA-125 with usable Yahoo data — go/no-go on TASE scope).
5. UI: Login/Signup, app shell with nav, **Universe browser page** (instrument table: symbol, name, exchange, last close, history depth).
6. Tests: auth flows, provider (recorded fixtures), universe loading; UI: login + universe table rendering.

**Verification**: `docker compose up` → sign up → browse universe with real fetched TASE+US prices; CI green.

### M2 — Analysis engines (~25%)
1. `ta/`: 12 pandas-ta indicators + custom trend channel + S/R; signal extraction; composite scoring; nightly snapshot persistence.
2. `llm/`: provider ABC, Groq implementation, prompt templates, JSON validation, `llm_calls` logging, budget guard.
3. `sentiment/`: 4 sources (Yahoo RSS, Google News RSS, Reddit, Globes/TheMarker RSS), item dedup, LLM scoring (call site 1), composite score.
4. `stock_scores` + ranking; manual pipeline trigger endpoint for dev.
5. UI: **Stock detail page** — candlestick chart with SMA/EMA/BB/channel/S&R overlays, indicator panel with per-indicator signals, sentiment feed with per-item LLM scores; **Scores leaderboard** on the universe page.
6. Tests: each indicator against known fixture series (golden values), channel/S&R unit tests, sentiment scoring with mocked LLM, score formula properties; UI: chart page render + indicator panel.

**Verification**: run pipeline for ~50 symbols; inspect AAPL & a TA-125 name end-to-end in the UI; verify `llm_calls` costs are logged.

### M3 — Strategies & portfolios (~30%)
1. `strategy/`: ABC + 4 strategies; backtest engine (fills, costs, equity curve, trade log persistence); evaluator with 10/2 split + grid search + churn guard.
2. `portfolio/`: multi-portfolio CRUD, paper broker (cash/holdings/trades), performance service (equity curve, benchmark comparison).
3. `recommend/`: initial portfolio builder (FR-6, call sites 2–3), daily recommendation engine, approve/reject/auto-execute flows.
4. Jobs: `daily_pipeline`, `weekly_strategy` wired into Beat.
5. UI: **Onboarding wizard** (risk → capital → proposal → approve), **Recommendations feed**, **Portfolios page** (create several, assign strategies, comparison chart), **Dashboard** (per-portfolio cards + comparison), **Strategy Lab** (strategy list → runs → train/test metrics, equity curves, trade-by-trade table with triggering signals).
6. Tests: backtest engine on synthetic series with known outcomes; train/test split boundaries; paper broker accounting (cash/holdings invariants); recommendation engine with fixed scores; API tests for all flows; UI tests for wizard, feed actions, comparison, Strategy Lab tables.

**Verification**: create 2 portfolios with different strategies → run daily pipeline twice (simulated dates) → recommendations appear, auto-portfolio executes, comparison chart diverges; Strategy Lab shows the weekly run with separated train/test metrics and drill-down trades.

### M4 — Product surface completion (~15%)
1. `notify/`: Telegram bot, account linking via one-time code, message templates for all event kinds; in-app notification feed.
2. `topics/`: radar job (call site 4), deep dive (call site 5 + ticker validation + full analysis of candidates), report persistence.
3. On-demand scan endpoint + discovery layer (volume/momentum/news-buzz screen over a broader symbol list).
4. UI: **Topics page** (hot list, deep-dive trigger with progress, report view), **Scan results page** + "re-run initial scan" in Settings, **Settings** (Telegram link, auto-trade toggles, strategy-switch mode), notification bell.
5. Tests: telegram formatting (mocked transport), deep-dive ticker validation (hallucinated tickers rejected), scan job; UI tests for topics flow and settings.

**Verification**: link a real Telegram account and receive the daily digest; deep-dive "quantum computing" → validated ticker report; trigger re-scan from Settings.

### M5 — Hardening (~10%)
1. `outcome_tracker` job + hit-rate stats on dashboard and per stock-detail page.
2. Degradation paths: LLM/sentiment outage → technical-only with flagged confidence; data-gap handling; pipeline run-report with alerting on failure.
3. Disclaimer banners on all recommendation surfaces; README + ops docs (runbook, .env reference).
4. Load test: full pipeline on the complete ~1000-symbol universe within the 2h budget; tune batching.
5. End-to-end onboarding of 2–3 real users.

**Verification**: kill the LLM key mid-pipeline → run completes technical-only and flags it; nightly runs green 5 days straight; hit-rate populates after a simulated 30-day fast-forward in tests.

## 9. Sequencing & dependencies

M1 → M2 → M3 → M4 → M5 strictly; within milestones, backend module + its tests + its UI page proceed together per feature. Each milestone ends with a tagged commit and a working `docker compose up` demo state.

## 10. Out-of-scope guardrails for v1

No real-money paths anywhere; `ExecutionBroker` ABC defined with only `PaperBroker` implementing it. No intraday data. No paid API keys except Groq.
