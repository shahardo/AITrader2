# support_resistance.py — pivot-based Support & Resistance: finds swing highs/lows
# (fractal pivots), clusters nearby levels within an ATR band, and scores them by
# touch count and recency.

from dataclasses import dataclass

import pandas as pd

from app.ta.indicators import atr


@dataclass(frozen=True)
class Level:
    """One support or resistance level.

    Attributes:
        price: Level price (mean of clustered pivots).
        kind: "support" (below last close) or "resistance" (above).
        touches: Number of pivots merged into this level.
        last_touch_age: Bars since the most recent touch.
        strength: Heuristic score: touches weighted by recency.
    """

    price: float
    kind: str
    touches: int
    last_touch_age: int
    strength: float


@dataclass(frozen=True)
class SRAnalysis:
    """Support/resistance summary for one symbol.

    Attributes:
        levels: All detected levels, strongest first.
        nearest_support: Closest level below the last close, if any.
        nearest_resistance: Closest level above the last close, if any.
        support_distance_atr: Distance from close down to nearest support, in ATRs.
        resistance_distance_atr: Distance from close up to nearest resistance, in ATRs.
    """

    levels: list[Level]
    nearest_support: Level | None
    nearest_resistance: Level | None
    support_distance_atr: float | None
    resistance_distance_atr: float | None


def _find_pivots(high: pd.Series, low: pd.Series, wing: int) -> list[tuple[int, float]]:
    """Locate fractal swing highs and lows.

    Args:
        high: High prices.
        low: Low prices.
        wing: Bars on each side that must be lower (for highs) / higher (for lows).

    Returns:
        list[tuple[int, float]]: (bar index position, pivot price) pairs.
    """
    pivots: list[tuple[int, float]] = []
    h, lo = high.to_numpy(), low.to_numpy()
    for i in range(wing, len(h) - wing):
        if h[i] == max(h[i - wing : i + wing + 1]):
            pivots.append((i, float(h[i])))
        if lo[i] == min(lo[i - wing : i + wing + 1]):
            pivots.append((i, float(lo[i])))
    return pivots


def analyze_support_resistance(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    window: int = 180,
    wing: int = 5,
    cluster_atr: float = 1.0,
) -> SRAnalysis:
    """Detect S/R levels from recent price action.

    Args:
        high: High prices (ascending dates).
        low: Low prices.
        close: Close prices.
        window: How many recent bars to analyze.
        wing: Fractal wing size for pivot detection.
        cluster_atr: Pivots within this many ATRs are merged into one level.

    Returns:
        SRAnalysis: Levels plus nearest support/resistance relative to last close.
    """
    high, low, close = high.tail(window), low.tail(window), close.tail(window)
    n = len(close)
    if n < 2 * wing + 1:
        return SRAnalysis([], None, None, None, None)

    last_close = float(close.iloc[-1])
    atr_now = float(atr(high, low, close).iloc[-1]) or last_close * 0.02
    pivots = sorted(_find_pivots(high, low, wing), key=lambda p: p[1])

    levels: list[Level] = []
    cluster: list[tuple[int, float]] = []

    def flush() -> None:
        """Convert the current pivot cluster into a Level."""
        if not cluster:
            return
        price = sum(p for _, p in cluster) / len(cluster)
        last_idx = max(i for i, _ in cluster)
        age = n - 1 - last_idx
        levels.append(
            Level(
                price=price,
                kind="support" if price < last_close else "resistance",
                touches=len(cluster),
                last_touch_age=age,
                strength=len(cluster) / (1 + age / window),
            )
        )

    for pivot in pivots:
        if cluster and pivot[1] - cluster[-1][1] > cluster_atr * atr_now:
            flush()
            cluster = []
        cluster.append(pivot)
    flush()

    levels.sort(key=lambda level: level.strength, reverse=True)
    supports = [level for level in levels if level.kind == "support"]
    resistances = [level for level in levels if level.kind == "resistance"]
    nearest_support = max(supports, key=lambda level: level.price) if supports else None
    nearest_resistance = min(resistances, key=lambda level: level.price) if resistances else None

    return SRAnalysis(
        levels=levels,
        nearest_support=nearest_support,
        nearest_resistance=nearest_resistance,
        support_distance_atr=(
            (last_close - nearest_support.price) / atr_now if nearest_support else None
        ),
        resistance_distance_atr=(
            (nearest_resistance.price - last_close) / atr_now if nearest_resistance else None
        ),
    )
