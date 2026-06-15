# strategy.py — strategy ORM models: the strategy library, weekly evaluation runs
# (train/test backtest results), and the per-trade decision log that powers the
# Strategy Lab drill-down.

from datetime import UTC, datetime
from datetime import date as date_type

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Strategy(Base):
    """One named strategy in the library (momentum, mean-reversion, ...)."""

    __tablename__ = "strategies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    kind: Mapped[str] = mapped_column(String(50))  # registry key, e.g. "momentum"
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # chosen (fitted) params
    risk_fit: Mapped[str] = mapped_column(String(20), default="balanced")
    description: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class StrategyRun(Base):
    """One evaluation of a strategy.

    Grid-search fit on the train window, out-of-sample result on the held-out
    test window (dev plan §5.4).
    """

    __tablename__ = "strategy_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_id: Mapped[int] = mapped_column(
        ForeignKey("strategies.id", ondelete="CASCADE"), index=True
    )
    run_date: Mapped[date_type] = mapped_column(Date, index=True)
    train_start: Mapped[date_type] = mapped_column(Date)
    train_end: Mapped[date_type] = mapped_column(Date)
    test_start: Mapped[date_type] = mapped_column(Date)
    test_end: Mapped[date_type] = mapped_column(Date)
    chosen_params: Mapped[dict] = mapped_column(JSON, default=dict)
    train_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    test_metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    equity_curve: Mapped[list] = mapped_column(JSON, default=list)  # test window [[date, value]]
    status: Mapped[str] = mapped_column(String(20), default="done")  # done|failed
    # 0 = normal run; 1-5 = GA candidate rank (1=best) from one evolution run,
    # sharing the same run_date (see StrategyEvolutionRun).
    rank: Mapped[int] = mapped_column(Integer, default=0)


class BacktestTrade(Base):
    """One simulated trade inside a strategy run's test window.

    Carries the signals that triggered it (Strategy Lab trade-by-trade view).
    """

    __tablename__ = "backtest_trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    strategy_run_id: Mapped[int] = mapped_column(
        ForeignKey("strategy_runs.id", ondelete="CASCADE"), index=True
    )
    symbol: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(4))  # BUY|SELL
    date: Mapped[date_type] = mapped_column(Date)
    price: Mapped[float] = mapped_column(Float)
    qty: Mapped[float] = mapped_column(Float)
    triggering_signals: Mapped[dict] = mapped_column(JSON, default=dict)
    pnl: Mapped[float | None] = mapped_column(Float, default=None)  # set on SELL legs


class StrategyEvolutionRun(Base):
    """One genetic-algorithm run that evolves the 'evolved' strategy's gene.

    Tracks live progress (current_generation, fitness_history) for polling
    while a manual run is in flight, and links to the rank-1 StrategyRun once
    done.
    """

    __tablename__ = "strategy_evolution_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending|running|done|failed|cancelled
    cancel_requested: Mapped[bool] = mapped_column(default=False)
    triggered_by: Mapped[str] = mapped_column(String(20), default="manual")  # manual|weekly
    population_size: Mapped[int] = mapped_column(Integer)
    generations: Mapped[int] = mapped_column(Integer)
    current_generation: Mapped[int] = mapped_column(Integer, default=0)
    # Fraction (0..1) of the current generation's population evaluated so far.
    generation_progress: Mapped[float] = mapped_column(Float, default=0.0)
    risk_weight: Mapped[float] = mapped_column(Float, default=1.0)
    max_symbols: Mapped[int] = mapped_column(Integer, default=25)
    fitness_history: Mapped[list] = mapped_column(JSON, default=list)
    strategy_run_id: Mapped[int | None] = mapped_column(
        ForeignKey("strategy_runs.id", ondelete="SET NULL"), default=None
    )  # the rank-1 (best) StrategyRun, once done
    error_message: Mapped[str | None] = mapped_column(String(1000), default=None)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class PortfolioModel(Base):
    """A user's paper portfolio bound to one strategy (PRD FR-9)."""

    __tablename__ = "portfolios"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    strategy_id: Mapped[int | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL"), default=None
    )
    initial_capital: Mapped[float] = mapped_column(Float)
    cash: Mapped[float] = mapped_column(Float)
    auto_execute: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Holding(Base):
    """Current position of one instrument inside a portfolio."""

    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"), index=True
    )
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    qty: Mapped[float] = mapped_column(Float)
    avg_cost: Mapped[float] = mapped_column(Float)


class TradeModel(Base):
    """An executed paper trade (immutable ledger row)."""

    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"), index=True
    )
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    side: Mapped[str] = mapped_column(String(4))  # BUY|SELL
    qty: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    recommendation_id: Mapped[int | None] = mapped_column(
        ForeignKey("recommendations.id", ondelete="SET NULL"), default=None
    )


class Recommendation(Base):
    """One BUY/SELL/HOLD call issued for a portfolio (immutable; PRD FR-7)."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    portfolio_id: Mapped[int] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"), index=True
    )
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(4))  # BUY|SELL|HOLD
    qty: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)  # 0..1
    signals: Mapped[dict] = mapped_column(JSON, default=dict)
    explanation: Mapped[str] = mapped_column(String(2000), default="")
    kind: Mapped[str] = mapped_column(String(20), default="daily")  # daily|initial
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # pending|approved|rejected|executed|expired
    price_at_recommendation: Mapped[float | None] = mapped_column(Float, default=None)
    outcome_30d: Mapped[float | None] = mapped_column(Float, default=None)  # pct return
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
