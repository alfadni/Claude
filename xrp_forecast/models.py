"""Forecasting models.

Every model takes a daily price series and a horizon in days and returns a
DataFrame indexed by future dates with quantile columns (p05 .. p95). All
models work on log prices, which keeps forecasts positive and treats moves
as percentages.
"""

from __future__ import annotations

from statistics import NormalDist

import numpy as np
import pandas as pd

QUANTILES = (0.05, 0.25, 0.50, 0.75, 0.95)
COLUMNS = [f"p{int(q * 100):02d}" for q in QUANTILES]
_Z = np.array([NormalDist().inv_cdf(q) for q in QUANTILES])


def _future_index(prices: pd.Series, horizon: int) -> pd.DatetimeIndex:
    return pd.date_range(prices.index[-1] + pd.Timedelta(days=1), periods=horizon, freq="D")


def _normal_bands(prices, horizon, center_log, sigma_log) -> pd.DataFrame:
    vals = np.exp(center_log[:, None] + sigma_log[:, None] * _Z[None, :])
    return pd.DataFrame(vals, index=_future_index(prices, horizon), columns=COLUMNS)


def random_walk(prices: pd.Series, horizon: int, lookback: int = 365) -> pd.DataFrame:
    """Driftless random walk: median stays at today's price, bands widen with
    historical volatility. The baseline every other model must beat."""
    r = np.diff(np.log(prices.values[-lookback:]))
    h = np.arange(1, horizon + 1)
    return _normal_bands(prices, horizon, np.full(horizon, np.log(prices.iloc[-1])), r.std(ddof=1) * np.sqrt(h))


def gbm(prices: pd.Series, horizon: int, lookback: int = 365, drift_shrink: float = 0.5) -> pd.DataFrame:
    """Geometric Brownian motion with drift and volatility from recent log
    returns. Drift is shrunk toward zero because sample drift is noisy."""
    r = np.diff(np.log(prices.values[-lookback:]))
    mu, sigma = r.mean() * drift_shrink, r.std(ddof=1)
    h = np.arange(1, horizon + 1)
    return _normal_bands(prices, horizon, np.log(prices.iloc[-1]) + mu * h, sigma * np.sqrt(h))


def bootstrap(
    prices: pd.Series,
    horizon: int,
    lookback: int = 730,
    block: int = 10,
    n_paths: int = 5000,
    seed: int | None = 42,
) -> pd.DataFrame:
    """Monte Carlo by stationary-block bootstrap of historical daily log
    returns. Keeps XRP's fat tails and volatility clustering that a normal
    model misses. Returns are demeaned so past trend is not extrapolated."""
    rng = np.random.default_rng(seed)
    r = np.diff(np.log(prices.values[-lookback:]))
    r = r - r.mean()
    n = len(r)
    n_blocks = -(-horizon // block)
    starts = rng.integers(0, n - block + 1, size=(n_paths, n_blocks))
    idx = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(n_paths, -1)[:, :horizon]
    paths = np.log(prices.iloc[-1]) + np.cumsum(r[idx], axis=1)
    vals = np.exp(np.quantile(paths, QUANTILES, axis=0).T)
    return pd.DataFrame(vals, index=_future_index(prices, horizon), columns=COLUMNS)


def log_trend(prices: pd.Series, horizon: int, lookback: int = 365) -> pd.DataFrame:
    """Linear regression of log price on time, extrapolated forward. Bands
    combine residual spread with random-walk growth so they don't stay
    unrealistically narrow far out."""
    y = np.log(prices.values[-lookback:])
    t = np.arange(len(y))
    slope, intercept = np.polyfit(t, y, 1)
    resid_sd = (y - (intercept + slope * t)).std(ddof=2)
    daily_sd = np.diff(y).std(ddof=1)
    h = np.arange(1, horizon + 1)
    # Anchor at the last observed price so the forecast starts where we are.
    center = np.log(prices.iloc[-1]) + slope * h
    sigma = np.sqrt(resid_sd**2 * (1 - np.exp(-h / 30)) + daily_sd**2 * h * 0.5)
    return _normal_bands(prices, horizon, center, sigma)


def holt_damped(prices: pd.Series, horizon: int, lookback: int = 365) -> pd.DataFrame:
    """Damped-trend exponential smoothing (Holt) on log prices. Parameters
    are chosen by grid search on one-step-ahead squared error."""
    y = np.log(prices.values[-lookback:])
    best = None
    for alpha in (0.2, 0.4, 0.6, 0.8, 0.95):
        for beta in (0.01, 0.05, 0.1, 0.2):
            for phi in (0.8, 0.9, 0.95, 0.98):
                sse, level, trend = _holt_pass(y, alpha, beta, phi)
                if best is None or sse < best[0]:
                    best = (sse, alpha, beta, phi, level, trend)
    sse, alpha, beta, phi, level, trend = best
    sigma1 = np.sqrt(sse / (len(y) - 1))
    h = np.arange(1, horizon + 1)
    damp = np.cumsum(phi**h)
    center = level + damp * trend
    # Approximate prediction variance for damped Holt (Hyndman et al.).
    cj = alpha * (1 + beta * np.cumsum(phi ** np.arange(1, horizon + 1)))
    var = sigma1**2 * (1 + np.concatenate([[0], np.cumsum(cj[:-1] ** 2)]))
    return _normal_bands(prices, horizon, center, np.sqrt(var))


def _holt_pass(y, alpha, beta, phi):
    level, trend, sse = y[0], y[1] - y[0], 0.0
    for obs in y[1:]:
        pred = level + phi * trend
        sse += (obs - pred) ** 2
        new_level = alpha * obs + (1 - alpha) * pred
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    return sse, level, trend


MODELS = {
    "random_walk": random_walk,
    "gbm": gbm,
    "bootstrap": bootstrap,
    "log_trend": log_trend,
    "holt_damped": holt_damped,
}


def ensemble(prices: pd.Series, horizon: int, weights: dict[str, float] | None = None) -> pd.DataFrame:
    """Weighted average of model quantiles in log space. Defaults to equal
    weights over every model except the random-walk baseline."""
    weights = weights or {k: 1.0 for k in MODELS if k != "random_walk"}
    total = sum(weights.values())
    acc = None
    for name, w in weights.items():
        f = np.log(MODELS[name](prices, horizon)) * (w / total)
        acc = f if acc is None else acc + f
    return np.exp(acc)
