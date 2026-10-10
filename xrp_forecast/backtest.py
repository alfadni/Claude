"""Walk-forward backtest: refit each model at past cutoffs and score its
forecast against what actually happened."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .models import MODELS, ensemble


def backtest(
    prices: pd.Series,
    horizon: int = 30,
    n_cutoffs: int = 12,
    step: int = 15,
    min_train: int = 180,
    models: dict | None = None,
) -> pd.DataFrame:
    """Score models at ``n_cutoffs`` past dates spaced ``step`` days apart.

    Returns one row per model with:
      mape      mean absolute % error of the median forecast at ``horizon``
      coverage  share of outcomes inside the 90% (p05-p95) band
      n         number of cutoffs scored
    """
    models = dict(models or MODELS)
    models.setdefault("ensemble", ensemble)
    last_cutoff = len(prices) - horizon - 1
    cutoffs = [c for c in range(last_cutoff, last_cutoff - n_cutoffs * step, -step) if c >= min_train]
    if not cutoffs:
        raise ValueError("Not enough history to backtest this horizon")

    rows = []
    for name, fn in models.items():
        errs, hits = [], []
        for c in cutoffs:
            f = fn(prices.iloc[: c + 1], horizon).iloc[-1]
            actual = prices.iloc[c + horizon]
            errs.append(abs(f["p50"] / actual - 1))
            hits.append(f["p05"] <= actual <= f["p95"])
        rows.append({"model": name, "mape": np.mean(errs), "coverage": np.mean(hits), "n": len(cutoffs)})
    return pd.DataFrame(rows).set_index("model").sort_values("mape")


def inverse_error_weights(scores: pd.DataFrame) -> dict[str, float]:
    """Ensemble weights proportional to 1/MAPE, excluding the baseline and the
    ensemble itself."""
    s = scores.drop(index=[m for m in ("random_walk", "ensemble") if m in scores.index])
    return {m: 1.0 / max(v, 1e-9) for m, v in s["mape"].items()}
