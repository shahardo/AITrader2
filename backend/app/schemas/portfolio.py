# portfolio.py — Pydantic schemas for portfolios, recommendations, strategies,
# and strategy runs (Strategy Lab).

from datetime import date, datetime

from pydantic import BaseModel, Field


class PortfolioCreate(BaseModel):
    """Payload to create a paper portfolio."""

    name: str = Field(min_length=1, max_length=100)
    initial_capital: float = Field(gt=0, le=1e9)
    strategy_id: int | None = None
    auto_execute: bool = False


class PortfolioUpdate(BaseModel):
    """Editable portfolio fields."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    strategy_id: int | None = None
    auto_execute: bool | None = None


class PortfolioOut(BaseModel):
    """Portfolio summary row."""

    id: int
    name: str
    strategy_id: int | None
    strategy_name: str | None = None
    initial_capital: float
    cash: float
    auto_execute: bool
    value: float = 0.0
    pnl_pct: float = 0.0
    created_at: datetime

    model_config = {"from_attributes": True}


class HoldingOut(BaseModel):
    """One position inside a portfolio."""

    symbol: str
    name: str
    qty: float
    avg_cost: float
    last_close: float | None
    market_value: float | None
    pnl_pct: float | None


class PortfolioDetail(PortfolioOut):
    """Portfolio with holdings."""

    holdings: list[HoldingOut] = []


class EquityPoint(BaseModel):
    """One equity-curve point."""

    date: date
    value: float


class PerformanceOut(BaseModel):
    """Equity curve for one portfolio."""

    portfolio_id: int
    name: str
    curve: list[EquityPoint]


class RecommendationOut(BaseModel):
    """One recommendation row for the feed."""

    id: int
    portfolio_id: int
    symbol: str
    instrument_name: str
    action: str
    qty: float
    confidence: float
    signals: dict
    explanation: str
    kind: str
    status: str
    price_at_recommendation: float | None
    created_at: datetime


class StrategyOut(BaseModel):
    """Strategy library row."""

    id: int
    name: str
    kind: str
    params: dict
    risk_fit: str
    description: str

    model_config = {"from_attributes": True}


class StrategyRunOut(BaseModel):
    """One evaluation run (train/test) for the Strategy Lab."""

    id: int
    strategy_id: int
    run_date: date
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    chosen_params: dict
    train_metrics: dict
    test_metrics: dict
    equity_curve: list
    status: str
    rank: int

    model_config = {"from_attributes": True}


class StrategyEvolutionRunOut(BaseModel):
    """One genetic-algorithm run that evolves the 'evolved' strategy's gene."""

    id: int
    status: str
    cancel_requested: bool
    triggered_by: str
    population_size: int
    generations: int
    current_generation: int
    generation_progress: float
    risk_weight: float
    max_symbols: int
    fitness_history: list
    strategy_run_id: int | None
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class BacktestTradeOut(BaseModel):
    """One simulated trade in a run (trade-by-trade drill-down)."""

    symbol: str
    side: str
    date: date
    price: float
    qty: float
    triggering_signals: dict
    pnl: float | None

    model_config = {"from_attributes": True}
