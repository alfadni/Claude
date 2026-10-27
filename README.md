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

## HTTP API

`xrp_forecast/api.py` serves the same forecasts over HTTP for the mobile app
in [`mobile/`](mobile/README.md).

```bash
pip install -r requirements-api.txt
uvicorn xrp_forecast.api:app --port 8000
curl 'localhost:8000/v1/forecast?horizon=30&model=ensemble'
```

| Endpoint | Returns |
| --- | --- |
| `GET /v1/forecast?horizon=1..365&model=ensemble` | Last close, recent history, daily p05–p95 forecast, horizon summary, 30-day backtest, `stale` flag, disclaimer |
| `GET /v1/health` | Liveness plus price-snapshot status (never calls CoinGecko) |

How it behaves when things go wrong:

- **Caching.** Prices are fetched at most once per `XRP_PRICE_TTL_SECONDS`
  (default 1 h), and each forecast and backtest is computed once per price
  snapshot. Client traffic never turns into CoinGecko traffic. Concurrent
  requests on an expired snapshot share a single refresh.
- **CoinGecko down.** The last good snapshot keeps being served with
  `stale: true`, a `stale_reason` and `Cache-Control: no-store`, for up to
  `XRP_MAX_SERVE_AGE_SECONDS` (default 3 days). After that, or with no
  snapshot at all, the API returns `503 upstream_unavailable` with
  `Retry-After: 60`.
- **Feed stopped updating.** A last close more than 2 days old is flagged
  stale even if the fetch itself succeeded.
- **Bad input.** Returns `422 invalid_request` before any upstream call.
  Errors are always `{"error": {"code", "message"}}`, and internal exception
  text is never sent to clients.

Other settings: `XRP_PRICES_CSV` serves prices from a CSV instead of
CoinGecko (useful offline or for longer history), and `XRP_API_CORS_ORIGINS`
restricts allowed origins (default `*`; the API is read-only and uses no
credentials).

## Tests

```bash
pip install -r requirements-api.txt
python -m unittest discover tests
```
