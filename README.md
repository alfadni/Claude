# XRP price forecasts

> This repository also contains **Masroof**, an offline-first personal finance app — see [`masroof/README.md`](masroof/README.md).

Statistical forecasts of future XRP/USD prices, with uncertainty bands and a
walk-forward backtest so you can see how much to trust them.

> **Not financial advice.** These models only look at past prices. They know
> nothing about news, regulation, or market structure, and crypto regularly
> moves outside any band.

## Quick start

```bash
pip install -r requirements.txt
python -m xrp_forecast                 # fetch last 365 days from CoinGecko
python -m xrp_forecast --csv xrp.csv   # or use your own history (date + close columns)
```

This prints a backtest table and forecasts for 7, 30, 90, 180 and 365 days,
and writes `xrp_forecast.html` — a chart of the last year plus the ensemble
median with 50% and 90% bands.

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--horizons 30,90` | Horizons in days |
| `--model gbm` | Report one model instead of the ensemble |
| `--weighted` | Weight the ensemble by inverse backtest error |
| `--out-csv fc.csv` | Save the full daily forecast path |
| `--no-backtest` | Skip the backtest |

For longer history than CoinGecko's free 365 days, export a CSV from any
exchange or data site (e.g. Yahoo Finance `XRP-USD`) and pass `--csv`.

## Models

All models work on log prices, so forecasts stay positive and moves are in
percentage terms. Each returns 5/25/50/75/95% quantiles per day.

| Model | Idea |
| --- | --- |
| `random_walk` | Median = today's price; bands from historical volatility. The baseline. |
| `gbm` | Geometric Brownian motion; drift (shrunk 50% toward zero) and volatility from the last year. |
| `bootstrap` | Monte Carlo resampling blocks of real daily returns — keeps fat tails and volatility clusters. |
| `log_trend` | Linear trend on log price over the last year, extrapolated. |
| `holt_damped` | Damped-trend exponential smoothing, parameters by grid search. |
| `ensemble` | Average of the four non-baseline models' quantiles in log space. |

## Reading the results

The backtest refits each model at 12 past dates and checks the 30-day-ahead
forecast against what happened. Two numbers matter:

- **MAPE** — typical % miss of the median. If no model beats `random_walk`,
  the up/down tilt in the forecast is noise; read the bands, not the median.
- **90% coverage** — should be near 90%. Much lower means the bands are too
  narrow.

## Tests

```bash
python -m unittest discover tests
```
