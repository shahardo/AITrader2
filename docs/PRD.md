# AITrader2 — Product Requirements Document

**Version:** 1.0 | **Date:** 2026-06-11 | **Status:** Approved scope for v1

---

## 1. Product overview

**AITrader2** is an AI-powered stock analysis and paper-trading bot for **US and Israeli (TASE) equities** — no derivatives. It scans the market, builds and maintains personalized portfolios per user, issues daily buy/sell recommendations with explanations, adapts its strategies weekly, surfaces trending investment themes, and performs LLM-driven deep dives into themes on request.

v1 trades **virtual (paper) portfolios** only; real-broker execution is a designed-for later phase. Users interact through a **web dashboard** and receive **Telegram notifications**.

> **Disclaimer requirement:** every recommendation surface must carry a clear "not financial advice" disclaimer.

## 2. Goals

- **G1**: Personalized initial portfolio recommendation at account creation.
- **G2**: Daily reassessment producing actionable BUY/SELL/HOLD recommendations with confidence and rationale.
- **G3**: Optional automatic execution of recommendations against paper portfolios with P&L tracking; users can run **multiple paper portfolios with different strategies** and compare their performance.
- **G4**: Market scan covering famous large caps AND lesser-known mid/small caps; re-runnable on demand.
- **G5**: Hot-topics radar (e.g., quantum computing, nuclear fusion) + user-triggered topic deep dives producing ranked stock opportunities.
- **G6**: Each stock scored by **≥10 technical indicators** + multi-channel **sentiment analysis**.
- **G7**: Weekly strategy analysis: evaluate candidate strategies on trailing-year data (**10 months training / 2 months out-of-sample testing**), recommend & apply best fit; strategies fully **inspectable** (rules, backtests, trade-by-trade history).
- **G8**: LLM fully pluggable; launch on **Groq Llama 4** (paid plan).
- **G9**: Web dashboard + Telegram notifications; multi-user accounts.

## 3. Non-goals (v1)

Derivatives/options/crypto · real-money execution · intraday/HFT (EOD cadence only) · paid data feeds (free channels first; paid swap-in designed for) · mobile app · regulatory-grade investment advice.

## 4. Users & accounts

Small group (owner + family/friends). Email+password auth with JWT sessions, optional Telegram account linking. Per-user profile: risk level (conservative / balanced / aggressive), market preference (US / TASE / both), and one or more paper portfolios.

## 5. Functional requirements

**FR-1 Accounts**: signup/login; profile with risk level, markets, Telegram link; per-portfolio virtual capital and auto-execute flag.

**FR-2 Market data**: EOD OHLCV for the full universe via a provider interface; ≥2 years history per symbol; nightly refresh; TASE covered via Yahoo `.TA` tickers; provider swappable (paid providers later).

**FR-3 Universe & scan**: base = S&P 500 + Nasdaq-100 + TA-125; a discovery layer screens beyond the indices for unusual volume/momentum/news buzz (~700–1000 symbols total); full scan runs at first onboarding and on user demand; results timestamped and shared across users.

**FR-4 Technical analysis**: 14 indicators/analyses computed per symbol per day:
SMA(50/200) cross, EMA(20), MACD, RSI(14), Stochastic, Bollinger Bands, ATR, OBV, VWAP-distance, ADX, Williams %R, CCI, **Trend Channel Analysis** (linear-regression channel: slope, width, position-in-channel), **Support & Resistance** (pivot-based levels + price distance to nearest level).
Normalized composite technical score (0–100) with per-indicator signal breakdown stored for transparency; trend channel and S/R levels rendered as chart overlays in the UI.

**FR-5 Sentiment analysis**: ≥3 channels at launch (financial news RSS, Google News, Reddit; + Israeli financial press for TASE names); the LLM scores each item for sentiment (−1..+1) and relevance; composite per-symbol sentiment score with recency-decay weighting; source items kept for drill-down in the UI.

**FR-6 Initial portfolio**: at onboarding (or re-run), construct a diversified portfolio from top-scored stocks subject to risk-profile constraints (position count, max weight per stock/sector, US/TASE mix); LLM writes the rationale; user approves before paper positions open.

**FR-7 Daily recommendations**: for each paper portfolio, every trading day: evaluate holdings (SELL/HOLD) and top non-held candidates (BUY) under that portfolio's strategy; each recommendation = action, ticker, quantity, confidence, key signals, LLM-written explanation; delivered in-app + Telegram; user approves/rejects, or auto-mode executes immediately as paper trades.

**FR-8 Strategy engine**: library of ≥4 named strategies (momentum, mean-reversion, trend-following, balanced); weekly job evaluates each over the trailing 12 months using a **train/test split — fit on the first 10 months, validate out-of-sample on the last 2 months**; only out-of-sample performance drives selection; recommends a strategy per portfolio given risk profile; switches applied automatically (with notification) or after user approval — user setting.

**FR-9 Multiple paper portfolios**: each user can create several paper portfolios, each with its own virtual capital, assigned strategy, and auto-execute setting; trades execute at next-day open (or last close for immediate manual approval); full trade history per portfolio; dashboard compares portfolios side by side — equity curves, P&L, performance vs. benchmarks (S&P 500 and TA-125).

**FR-10 Strategy inspection**: a Strategy Lab view lets users interrogate any strategy: its rules in plain language (LLM-rendered), every historical backtest run (train and test windows shown separately), equity curve, drawdowns, and a trade-by-trade decision log showing which signals triggered each simulated trade.

**FR-11 Hot topics & deep dives**: rolling list of trending themes derived from news-buzz clustering + LLM synthesis; user can trigger a deep dive on any listed or free-text topic → report with theme summary and 5–15 candidate tickers (validated as real, tradable, non-derivative listings), each fully analyzed and ranked by opportunity score.

**FR-12 Notifications**: Telegram messages for daily recommendations, executed trades, strategy changes, completed scans/deep-dives; in-app feed mirrors all.

**FR-13 LLM plug-in**: all LLM use behind one interface (model selection, temperature, JSON schema per call site, retries, token/cost accounting); Groq Llama 4 (Maverick for deep analysis, Scout for bulk scoring) at launch; provider switchable by config.

## 6. Development principles

- **Visibility first**: every backend feature gets a frontend surface in the same milestone it's built — no invisible/API-only features.
- **Test first**: every feature is covered by tests on both ends — pytest for the backend (unit + API), Vitest + React Testing Library for the frontend; tests run in CI on every push.
- **Documented code**: every file opens with a comment describing its content/role; every function carries a Google-style docstring (Args/Returns/Raises).

## 7. Non-functional requirements

- Daily pipeline completes within 2 hours for ~1000 symbols on free-tier rate limits (batching + caching + backoff).
- Graceful degradation: if a sentiment source or the LLM is down, the pipeline proceeds with technical-only scores and flags reduced confidence.
- All recommendations stored immutably for later accuracy evaluation (hit-rate of past calls).
- Local deployment: single `docker compose up` (api, worker, beat, db, redis, web).
- Secrets via `.env`; no keys in the repo.

## 8. Success metrics

- Recommendation hit-rate (% of BUY recommendations positive after 30 days), visible in-app.
- Paper portfolio P&L vs. benchmarks, per portfolio.
- Pipeline reliability: ≥95% successful nightly runs.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| yfinance instability / rate limits (unofficial API) | aggressive caching, batching, retry/backoff; provider interface ready for paid swap |
| TASE data gaps on Yahoo | validate TA-125 coverage early (Milestone 1); reduced TASE universe fallback |
| LLM hallucinating tickers in deep dives | validate every ticker against real listing data before showing |
| Free sentiment sources are thin | confidence weighting; sentiment is one input, never a sole trigger |
| Strategy overfitting to the past year | 10-month-train / 2-month-test split; only out-of-sample results drive selection; cap week-over-week strategy churn |

## 10. Milestones

Per the visibility-first principle, every milestone delivers backend + the UI exposing it, with tests on both ends.

1. **M1 — Foundation & data**: repo scaffolding, Docker Compose, CI with test runners, DB schema, auth + login UI, yfinance provider + universe loading with a universe-browser page, TASE coverage validation.
2. **M2 — Analysis engines**: TA indicators (incl. trend channels & S/R) + composite scoring with stock-detail chart page; LLM provider (Groq) + sentiment pipeline with sentiment drill-down UI.
3. **M3 — Strategies & portfolios**: strategy engine with 10/2 train-test evaluation + weekly job + Strategy Lab UI; initial portfolio builder; daily recommendation pipeline + recommendations feed; multi-portfolio paper trading with comparison dashboard.
4. **M4 — Product surface completion**: Telegram notifications, topic radar + deep dives, scan re-run, onboarding wizard polish.
5. **M5 — Hardening**: hit-rate tracking, degradation paths, docs, end-to-end test with 2–3 real users.

## 11. Future phases (designed for, not built in v1)

- Real broker execution: `ExecutionBroker` interface → IBKR (US+TASE) implementation; per-user opt-in with safety limits.
- Paid market data (EODHD/Polygon) and premium sentiment (StockTwits, X) behind the existing interfaces.
- Cloud deployment (Compose → any VPS).
