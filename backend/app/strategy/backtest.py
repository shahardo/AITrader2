# backtest.py — event-driven daily backtest engine: signals on day T's close fill
# at day T+1's open with commission+slippage (dev plan §5.4), producing an equity
# curve, metrics (CAGR/Sharpe/maxDD/win-rate), and a trade log with reasons.

import math
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from app.strategy.base import TradingStrategy

COMMISSION = 0.001  # 0.1% per side
SLIPPAGE = 0.0005  # 0.05% adverse fill
TRADING_DAYS = 252


@dataclass
class SimTrade:
    """One simulated fill."""

    symbol: str
    side: str  # BUY|SELL
    date: date
    price: float
    qty: float
    reasons: dict = field(default_factory=dict)
    pnl: float | None = None  # realized on SELL


@dataclass
class BacktestResult:
    """Backtest output: equity curve, fills, and summary metrics."""

    equity_curve: list[tuple[date, float]]
    trades: list[SimTrade]
    metrics: dict


def compute_metrics(equity: list[tuple[date, float]], trades: list[SimTrade]) -> dict:
    """Summarize an equity curve and trade list.

    Args:
        equity: (date, portfolio value) points, ascending.
        trades: Simulated fills (SELLs carry realized pnl).

    Returns:
        dict: cagr, sharpe, max_drawdown (negative fraction), win_rate,
        trade_count, final_value.
    """
    if len(equity) < 2:
        return {"cagr": 0.0, "sharpe": 0.0, "max_drawdown": 0.0, "win_rate": 0.0,
                "trade_count": len(trades), "final_value": equity[-1][1] if equity else 0.0}
    values = pd.Series([v for _, v in equity], dtype=float)
    returns = values.pct_change().dropna()
    years = max(len(values) / TRADING_DAYS, 1e-9)
    cagr = (values.iloc[-1] / values.iloc[0]) ** (1 / years) - 1
    vol = float(returns.std(ddof=0))
    sharpe = float(returns.mean() / vol * math.sqrt(TRADING_DAYS)) if vol > 0 else 0.0
    peak = values.cummax()
    max_dd = float(((values - peak) / peak).min())
    sells = [t for t in trades if t.side == "SELL" and t.pnl is not None]
    win_rate = (sum(1 for t in sells if t.pnl > 0) / len(sells)) if sells else 0.0
    return {"cagr": round(float(cagr), 4), "sharpe": round(sharpe, 3),
            "max_drawdown": round(max_dd, 4), "win_rate": round(win_rate, 3),
            "trade_count": len(trades), "final_value": round(float(values.iloc[-1]), 2)}


def run_backtest(
    strategy: TradingStrategy,
    features_by_symbol: dict[str, pd.DataFrame],
    start: date,
    end: date,
    initial_capital: float = 100_000.0,
    max_positions: int = 10,
) -> BacktestResult:
    """Simulate the strategy across symbols between start and end (inclusive).

    Decisions use day T's features; fills happen at day T+1's open with
    commission and slippage. Position sizing is equal-weight across open slots.

    Args:
        strategy: Configured strategy instance.
        features_by_symbol: build_features output per symbol (full history,
            so indicators have warm-up data before `start`).
        start: First decision date.
        end: Last decision date.
        initial_capital: Starting cash.
        max_positions: Maximum simultaneous holdings.

    Returns:
        BacktestResult: Equity curve (valued at close), fills, and metrics.
    """
    # Build the union trading calendar inside the window.
    all_dates = sorted({d for df in features_by_symbol.values()
                        for d in df.index if start <= d <= end})
    cash = initial_capital
    positions: dict[str, tuple[float, float]] = {}  # symbol -> (qty, avg_cost)
    pending: list[tuple[str, str, dict]] = []  # (symbol, side, reasons) to fill at next open
    trades: list[SimTrade] = []
    equity: list[tuple[date, float]] = []

    index_cache = {s: {d: i for i, d in enumerate(df.index)}
                   for s, df in features_by_symbol.items()}

    for day in all_dates:
        # 1) Fill orders queued from the previous session at today's open.
        for symbol, side, reasons in pending:
            df = features_by_symbol[symbol]
            i = index_cache[symbol].get(day)
            if i is None:
                continue  # symbol didn't trade today; drop the order
            open_px = float(df["open"].iloc[i])
            if open_px <= 0 or pd.isna(open_px):
                continue
            if side == "BUY" and symbol not in positions and len(positions) < max_positions:
                slot_cash = cash / (max_positions - len(positions))
                fill = open_px * (1 + SLIPPAGE)
                qty = math.floor(slot_cash / (fill * (1 + COMMISSION)))
                if qty < 1:
                    continue
                cost = qty * fill * (1 + COMMISSION)
                cash -= cost
                positions[symbol] = (qty, cost / qty)
                trades.append(SimTrade(symbol, "BUY", day, round(fill, 4), qty, reasons))
            elif side == "SELL" and symbol in positions:
                qty, avg_cost = positions.pop(symbol)
                fill = open_px * (1 - SLIPPAGE)
                proceeds = qty * fill * (1 - COMMISSION)
                cash += proceeds
                pnl = proceeds - qty * avg_cost
                trades.append(SimTrade(symbol, "SELL", day, round(fill, 4), qty, reasons,
                                       pnl=round(pnl, 2)))
        pending = []

        # 2) Decide on today's close for tomorrow's open.
        candidates: list[tuple[float, str, dict]] = []
        for symbol, df in features_by_symbol.items():
            i = index_cache[symbol].get(day)
            if i is None:
                continue
            decision = strategy.decide(df, i, holding=symbol in positions)
            if decision.action == "SELL":
                pending.append((symbol, "SELL", decision.reasons or {}))
            elif decision.action == "BUY":
                candidates.append((decision.score, symbol, decision.reasons or {}))
        sells = {s for s, side, _ in pending if side == "SELL"}
        open_slots = max_positions - (len(positions) - len(sells))
        for score, symbol, reasons in sorted(candidates, reverse=True)[:max(0, open_slots)]:
            pending.append((symbol, "BUY", reasons))

        # 3) Mark portfolio to market at today's close.
        value = cash
        for symbol, (qty, _) in positions.items():
            i = index_cache[symbol].get(day)
            if i is not None:
                value += qty * float(features_by_symbol[symbol]["close"].iloc[i])
            else:  # stale price: last known close
                df = features_by_symbol[symbol]
                prior = df.loc[df.index <= day, "close"]
                if not prior.empty:
                    value += qty * float(prior.iloc[-1])
        equity.append((day, round(value, 2)))

    return BacktestResult(equity_curve=equity, trades=trades,
                          metrics=compute_metrics(equity, trades))
