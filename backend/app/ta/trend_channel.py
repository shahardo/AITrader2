# trend_channel.py — Trend Channel Analysis: fits a linear-regression channel on
# log-closes and reports slope, width, and where price sits inside the channel.

from dataclasses import dataclass

import numpy as np
import pandas as pd

TRADING_DAYS_PER_YEAR = 252


@dataclass(frozen=True)
class TrendChannel:
    """A fitted regression channel over the lookback window.

    Attributes:
        slope_annual_pct: Annualized channel slope as percent (e.g. 25.0 = +25%/yr).
        width_pct: Full channel width as percent of the midline price.
        position: Where the last close sits in the channel: 0=lower band,
            0.5=midline, 1=upper band (may exceed [0,1] on breakouts).
        upper: Channel upper-band price at the last bar.
        mid: Channel midline price at the last bar.
        lower: Channel lower-band price at the last bar.
    """

    slope_annual_pct: float
    width_pct: float
    position: float
    upper: float
    mid: float
    lower: float


def fit_trend_channel(close: pd.Series, window: int = 90, num_std: float = 2.0
                      ) -> TrendChannel | None:
    """Fit a linear-regression channel to the last `window` log-closes.

    Args:
        close: Close prices (ascending dates).
        window: Bars in the regression window.
        num_std: Channel half-width in residual standard deviations.

    Returns:
        TrendChannel | None: The fitted channel, or None when there is not
        enough data (fewer than `window` bars) or prices are non-positive.
    """
    tail = close.dropna().tail(window)
    if len(tail) < window or (tail <= 0).any():
        return None
    y = np.log(tail.to_numpy())
    x = np.arange(len(y), dtype=float)
    slope, intercept = np.polyfit(x, y, 1)
    fitted = intercept + slope * x
    resid_std = float(np.std(y - fitted))

    mid_log = fitted[-1]
    upper_log = mid_log + num_std * resid_std
    lower_log = mid_log - num_std * resid_std
    last_log = y[-1]
    denom = (upper_log - lower_log) or np.nan
    position = (last_log - lower_log) / denom if denom == denom else 0.5

    return TrendChannel(
        slope_annual_pct=float((np.exp(slope * TRADING_DAYS_PER_YEAR) - 1) * 100),
        width_pct=float((np.exp(upper_log - lower_log) - 1) * 100),
        position=float(position),
        upper=float(np.exp(upper_log)),
        mid=float(np.exp(mid_log)),
        lower=float(np.exp(lower_log)),
    )
