"""Command-line entry point: ``python -m xrp_forecast``."""

from __future__ import annotations

import argparse
import sys

import pandas as pd

from .backtest import backtest, inverse_error_weights
from .data import fetch_coingecko, load_csv
from .models import MODELS, ensemble
from .report import render_html


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="xrp_forecast", description="Forecast future XRP/USD prices.")
    p.add_argument("--csv", help="Load prices from a CSV (date + close columns) instead of CoinGecko")
    p.add_argument("--days", type=int, default=365, help="Days of history to fetch from CoinGecko (max 365 on free API)")
    p.add_argument("--horizons", default="7,30,90,180,365", help="Comma-separated forecast horizons in days")
    p.add_argument("--model", default="ensemble", choices=["ensemble", *MODELS], help="Model to report")
    p.add_argument("--no-backtest", action="store_true", help="Skip the walk-forward backtest")
    p.add_argument("--weighted", action="store_true", help="Weight the ensemble by inverse backtest error")
    p.add_argument("--out-csv", help="Write the daily forecast path to this CSV")
    p.add_argument("--out-html", default="xrp_forecast.html", help="Write an HTML report here ('' to skip)")
    a = p.parse_args(argv)

    horizons = sorted({int(h) for h in a.horizons.split(",")})
    prices = load_csv(a.csv) if a.csv else fetch_coingecko(a.days)
    print(f"Loaded {len(prices)} days, {prices.index[0]:%Y-%m-%d} → {prices.index[-1]:%Y-%m-%d}, "
          f"last close ${prices.iloc[-1]:.4f}")

    scores = None
    if not a.no_backtest:
        bt_h = min(30, len(prices) // 6)
        try:
            scores = backtest(prices, horizon=bt_h)
            print(f"\nBacktest ({bt_h}-day horizon):")
            print(scores.to_string(formatters={"mape": "{:.1%}".format, "coverage": "{:.0%}".format}))
        except ValueError as e:
            print(f"\nBacktest skipped: {e}")

    if a.model == "ensemble":
        weights = inverse_error_weights(scores) if (a.weighted and scores is not None) else None
        fc = ensemble(prices, max(horizons), weights)
    else:
        fc = MODELS[a.model](prices, max(horizons))

    summary = pd.concat({(h, fc.index[h - 1]): fc.iloc[h - 1] for h in horizons}, axis=1).T
    summary.index.names = ["horizon", "date"]
    print(f"\nForecast ({a.model}):")
    print(summary.to_string(float_format=lambda v: f"{v:.4f}"))

    if a.out_csv:
        fc.rename_axis("date").to_csv(a.out_csv)
        print(f"\nWrote {a.out_csv}")
    if a.out_html:
        with open(a.out_html, "w") as f:
            f.write(render_html(prices, fc, summary, scores))
        print(f"Wrote {a.out_html}")
    print("\nStatistical projection only — not financial advice.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
