# XRP price forecasts

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

---

# Sudan news agent

Retrieves the latest Sudan news from worldwide sources. It has two layers:

1. **`sudan_news`**: a Python aggregator (standard library only) that fetches
   sources in parallel, filters for Sudan relevance, merges duplicate stories,
   tags topics and ranks the results.
2. **`.claude/agents/sudan-news.md`**: a Claude Code subagent. It runs the
   aggregator, falls back to web search in English, Arabic and French when
   sources fail, checks the top stories and writes a briefing that cites a
   source for every claim.

## Architecture

```
 sources (parallel, 8 workers, per-source failure isolation)
 ├─ gdelt            GDELT DOC 2.0 API — global monitor, 65+ languages
 ├─ gnews-en/gb/ar/fr Google News search, 4 editions (EN-US, EN-GB, AR-EG, FR-FR)
 ├─ reliefweb        UN OCHA ReliefWeb, primary country = Sudan
 ├─ dabanga, sudantribune                     Sudan-focused outlets
 └─ aljazeera, bbc-africa, guardian, un-news, france24, africanews
            │  raw Article records (title, url, source, published UTC, lang, country)
            ▼
 relevance   time window → language filter → Sudan term match
             (EN/FR/AR place names, actors; "South Sudan" masked out unless
             --include-south-sudan; ambiguous "RSF"/"SAF" never match alone)
            ▼
 dedupe      canonical URL (tracking params stripped) + title-token Jaccard ≥ 0.7;
             keeps the copy from the highest-priority feed (direct outlet > aggregator),
             records other outlets in also_reported_by, published = first seen
            ▼
 tag + rank  topics: conflict, humanitarian, diplomacy, politics, economy, rights
             sort: --sort recent (default) | coverage (number of outlets)
            ▼
 render      text | md | json   (+ source_errors so gaps are visible)
```

## Usage

```bash
python -m sudan_news                                  # last 24h, all sources
python -m sudan_news --hours 6 --sort coverage        # most widely reported first
python -m sudan_news --lang ar --topic humanitarian
python -m sudan_news --format md --out sudan.md
python -m sudan_news --format json --limit 0 --out sudan.json
python -m sudan_news --list-sources
```

| Flag | Meaning |
| --- | --- |
| `--hours N` | Look-back window (default 24) |
| `--sources a,b` | Subset of sources (see `--list-sources`) |
| `--lang en,ar,fr` | Language filter |
| `--topic t1,t2` | Topic filter |
| `--sort recent\|coverage` | Ranking |
| `--include-south-sudan` | Keep South Sudan-only stories |
| `--format text\|md\|json`, `--out FILE` | Output |

Exit code is `2` when every selected source fails, so a cron or CI job can
alert on that. A partial failure is reported in `source_errors` and on stderr.

From Python:

```python
from sudan_news import collect
stories, errors = collect(hours=12, languages={"en", "ar"}, sort="coverage")
```

## Using the subagent

In Claude Code, from this repository, ask for a briefing. For example:
"Use the sudan-news agent to brief me on the last 24 hours", or
"sudan-news: humanitarian situation in El Fasher this week".

## Network requirements

The machine needs outbound HTTPS to `api.gdeltproject.org`, `news.google.com`,
`reliefweb.int` and the outlet domains listed in `sudan_news/sources.py`. In a
restricted sandbox, add these domains to the allowlist. Otherwise the
subagent uses web search for the sources it cannot reach.
