# test_backtest.py — tests for the backtest engine on synthetic series with known
# outcomes: next-open fills, costs, equity accounting, and metrics.

from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.strategy.backtest import COMMISSION, SLIPPAGE, compute_metrics, run_backtest
from app.strategy.base import Decision, TradingStrategy, build_features


class BuyAndHoldOnce(TradingStrategy):
    """Test strategy: buys on the first decision day, never sells."""

    kind = "test_bh"
    label = "Buy and hold"
    param_grid = [{}]

    def decide(self, features, day, holding):
        if holding:
            return Decision("HOLD")
        return Decision("BUY", score=1.0, reasons={"why": "first day"})


class BuyThenSellNextDay(TradingStrategy):
    """Test strategy: buys day 1, sells as soon as it holds."""

    kind = "test_flip"
    label = "Flip"
    param_grid = [{}]

    def decide(self, features, day, holding):
        if holding:
            return Decision("SELL", reasons={"why": "exit"})
        return Decision("BUY", score=1.0, reasons={"why": "enter"})


def _features(prices: list[float], start="2026-01-05") -> pd.DataFrame:
    idx = pd.bdate_range(start, periods=len(prices))
    close = pd.Series(prices, index=idx, dtype=float)
    df = pd.DataFrame({
        "open": close.values, "high": close.values, "low": close.values,
        "close": close.values, "volume": np.full(len(close), 1e6)}, index=[d.date() for d in idx])
    return build_features(df)


def test_buy_fills_at_next_open_with_costs():
    feats = _features([100, 110, 120, 130])
    dates = list(feats.index)
    result = run_backtest(BuyAndHoldOnce(), {"XYZ": feats}, dates[0], dates[-1],
                          initial_capital=10_000, max_positions=1)
    buys = [t for t in result.trades if t.side == "BUY"]
    assert len(buys) == 1
    # Decision on day0 (open=100) fills at day1 open=110 plus slippage.
    assert buys[0].date == dates[1]
    assert buys[0].price == pytest.approx(110 * (1 + SLIPPAGE), rel=1e-6)
    assert buys[0].reasons == {"why": "first day"}
    # Cash spent = qty*fill*(1+commission) <= initial capital.
    qty = buys[0].qty
    assert qty * buys[0].price * (1 + COMMISSION) <= 10_000


def test_sell_realizes_pnl():
    feats = _features([100, 100, 200, 200])
    dates = list(feats.index)
    result = run_backtest(BuyThenSellNextDay(), {"XYZ": feats}, dates[0], dates[-1],
                          initial_capital=10_000, max_positions=1)
    sells = [t for t in result.trades if t.side == "SELL"]
    assert len(sells) == 1
    assert sells[0].pnl is not None and sells[0].pnl > 0  # bought ~100, sold ~200


def test_equity_curve_tracks_market_value():
    feats = _features([100, 100, 150, 150])
    dates = list(feats.index)
    result = run_backtest(BuyAndHoldOnce(), {"XYZ": feats}, dates[0], dates[-1],
                          initial_capital=10_000, max_positions=1)
    values = dict(result.equity_curve)
    # After the +50% move the portfolio (99 shares-ish) should be well above start.
    assert values[dates[2]] > values[dates[0]] * 1.4


def test_max_positions_respected():
    frames = {f"S{i}": _features([100] * 10) for i in range(6)}
    dates = list(next(iter(frames.values())).index)
    result = run_backtest(BuyAndHoldOnce(), frames, dates[0], dates[-1],
                          initial_capital=60_000, max_positions=3)
    open_positions = {t.symbol for t in result.trades if t.side == "BUY"}
    assert len(open_positions) == 3


def test_metrics_known_values():
    equity = [(date(2026, 1, i + 1), v) for i, v in enumerate([100.0, 110.0, 99.0])]
    metrics = compute_metrics(equity, [])
    assert metrics["max_drawdown"] == pytest.approx(-0.1, rel=1e-6)  # 110 -> 99
    assert metrics["final_value"] == 99.0
    assert metrics["trade_count"] == 0


def test_empty_window_yields_zero_metrics():
    feats = _features([100, 101])
    result = run_backtest(BuyAndHoldOnce(), {"XYZ": feats},
                          date(2030, 1, 1), date(2030, 2, 1), 10_000)
    assert result.equity_curve == []
    assert result.metrics["cagr"] == 0.0
