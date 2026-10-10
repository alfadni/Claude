"""Load XRP daily closing prices from CoinGecko or a local CSV."""

from __future__ import annotations

import json
import urllib.request

import pandas as pd

COINGECKO_URL = (
    "https://api.coingecko.com/api/v3/coins/ripple/market_chart"
    "?vs_currency=usd&days={days}&interval=daily"
)


def fetch_coingecko(days: int = 365, timeout: float = 30.0) -> pd.Series:
    """Fetch daily XRP/USD closes. The free API serves up to 365 days."""
    req = urllib.request.Request(
        COINGECKO_URL.format(days=days), headers={"User-Agent": "xrp-forecast/0.1"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    rows = payload["prices"]  # [[ms_timestamp, price], ...]
    s = pd.Series(
        [p for _, p in rows],
        index=pd.to_datetime([t for t, _ in rows], unit="ms").normalize(),
        name="close",
    )
    return _clean(s)


def load_csv(path: str) -> pd.Series:
    """Load a CSV with a date column and a close/price column.

    Column names are matched case-insensitively: the date column is one of
    ``date``, ``timestamp``, ``time``; the price column one of ``close``,
    ``price``, ``adj close``.
    """
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    date_col = next((cols[c] for c in ("date", "timestamp", "time") if c in cols), None)
    price_col = next((cols[c] for c in ("close", "price", "adj close") if c in cols), None)
    if date_col is None or price_col is None:
        raise ValueError(f"CSV needs a date and a close/price column, got {list(df.columns)}")
    s = pd.Series(
        pd.to_numeric(df[price_col], errors="coerce").values,
        index=pd.to_datetime(df[date_col]).dt.tz_localize(None).dt.normalize(),
        name="close",
    )
    return _clean(s)


def _clean(s: pd.Series) -> pd.Series:
    s = s[~s.index.duplicated(keep="last")].sort_index()
    s = s[s > 0].dropna()
    # Fill calendar gaps so every model sees a regular daily series.
    s = s.asfreq("D").ffill()
    if len(s) < 60:
        raise ValueError(f"Need at least 60 days of prices, got {len(s)}")
    return s
