"""HTTP API for the forecasts: ``uvicorn xrp_forecast.api:app``.

Prices are fetched at most once per ``XRP_PRICE_TTL_SECONDS`` and every
forecast/backtest is cached against that price snapshot, so client traffic
never turns into CoinGecko traffic. If a refresh fails, the last good
snapshot keeps being served (flagged stale) for up to
``XRP_MAX_SERVE_AGE_SECONDS``; after that, or with no snapshot at all, the
API answers 503 rather than serve data it can't vouch for.

Environment:
  XRP_PRICES_CSV              load prices from this CSV instead of CoinGecko
  XRP_PRICE_TTL_SECONDS       refresh interval (default 3600)
  XRP_MAX_SERVE_AGE_SECONDS   oldest snapshot served after failed refreshes (default 259200 = 3 days)
  XRP_API_CORS_ORIGINS        comma-separated allowed origins (default *)
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .backtest import backtest
from .data import fetch_coingecko, load_csv
from .models import COLUMNS, MODELS, ensemble

log = logging.getLogger("xrp_forecast.api")

DISCLAIMER = (
    "Statistical projection from past prices only. Not financial advice. "
    "Crypto prices regularly move outside any forecast band."
)
MAX_HORIZON = 365
BACKTEST_HORIZON = 30
# Daily closes: a last close more than this many days old means the feed has
# stopped updating, even if the fetch itself succeeded.
STALE_AFTER_DAYS = 2

ModelName = Literal["ensemble", "random_walk", "gbm", "bootstrap", "log_trend", "holt_damped"]
_FORECASTERS: dict[str, Callable[[pd.Series, int], pd.DataFrame]] = {**MODELS, "ensemble": ensemble}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


@dataclass
class Snapshot:
    prices: pd.Series
    fetched_at: float  # epoch seconds of the successful upstream fetch
    cache: dict = field(default_factory=dict)


def default_loader() -> pd.Series:
    path = os.environ.get("XRP_PRICES_CSV")
    return load_csv(path) if path else fetch_coingecko(365, timeout=10.0)


class PriceStore:
    """Holds the current price snapshot and refreshes it on a TTL.

    Refreshes are single-flight: concurrent requests on an expired snapshot
    trigger one upstream call, not one each.
    """

    def __init__(
        self,
        loader: Callable[[], pd.Series] = default_loader,
        ttl: float = 3600,
        max_serve_age: float = 3 * 86400,
        clock: Callable[[], float] = time.time,
    ):
        self.loader, self.ttl, self.max_serve_age, self.clock = loader, ttl, max_serve_age, clock
        self._snap: Snapshot | None = None
        self._last_error: str | None = None
        self._lock = threading.Lock()

    def get(self) -> tuple[Snapshot, str | None]:
        """Return (snapshot, refresh_error). refresh_error is set when the
        snapshot is being served because a refresh just failed."""
        now = self.clock()
        snap = self._snap
        if snap and now - snap.fetched_at < self.ttl:
            return snap, None
        with self._lock:
            snap = self._snap
            if snap and self.clock() - snap.fetched_at < self.ttl:
                return snap, None  # another request refreshed while we waited
            try:
                prices = self.loader()
            except Exception as e:  # network, HTTP, parse, too-short history
                self._last_error = f"{type(e).__name__}: {e}"
                log.warning("price refresh failed: %s", self._last_error)
                if snap and self.clock() - snap.fetched_at < self.max_serve_age:
                    return snap, "Latest price refresh failed; serving the last good data."
                raise ApiError(
                    503, "upstream_unavailable",
                    "Price data is temporarily unavailable. Try again shortly.", retry_after=60,
                ) from e
            self._snap, self._last_error = Snapshot(prices, self.clock()), None
            return self._snap, None

    def status(self) -> dict:
        snap = self._snap
        return {
            "has_data": snap is not None,
            "data_as_of": snap.prices.index[-1].date().isoformat() if snap else None,
            "fetched_at": _iso(snap.fetched_at) if snap else None,
            "last_refresh_error": self._last_error,
        }


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def _num(v: float) -> float:
    return float(f"{v:.8g}")


def _backtest_payload(snap: Snapshot) -> dict | None:
    if "backtest" not in snap.cache:
        h = min(BACKTEST_HORIZON, len(snap.prices) // 6)
        try:
            scores = backtest(snap.prices, horizon=h)
            rows = [
                {"model": m, "mape": _num(r.mape), "coverage_90": _num(r.coverage), "n": int(r.n)}
                for m, r in scores.iterrows()
            ]
            snap.cache["backtest"] = {"horizon_days": h, "models": rows}
        except ValueError as e:
            log.info("backtest skipped: %s", e)
            snap.cache["backtest"] = None
    return snap.cache["backtest"]


def build_forecast(snap: Snapshot, model: str, horizon: int) -> dict:
    """Snapshot-dependent part of the response, cached per (model, horizon)."""
    key = ("forecast", model, horizon)
    if key not in snap.cache:
        prices = snap.prices
        fc = _FORECASTERS[model](prices, horizon)
        if not np.isfinite(fc.values).all():
            raise ApiError(500, "model_failed", f"Model {model!r} produced invalid values.")
        last = float(prices.iloc[-1])
        end = fc.iloc[-1]
        hist = prices.iloc[-max(60, min(MAX_HORIZON, horizon)):]
        snap.cache[key] = {
            "asset": "XRP",
            "currency": "USD",
            "model": model,
            "horizon_days": horizon,
            "data_as_of": prices.index[-1].date().isoformat(),
            "last_close": _num(last),
            "history": [{"date": d.date().isoformat(), "close": _num(v)} for d, v in hist.items()],
            "forecast": [
                {"date": d.date().isoformat(), **{c: _num(row[c]) for c in COLUMNS}}
                for d, row in fc.iterrows()
            ],
            "summary": {
                "date": fc.index[-1].date().isoformat(),
                **{c: _num(end[c]) for c in COLUMNS},
                "median_change_pct": _num((end["p50"] / last - 1) * 100),
            },
            "backtest": _backtest_payload(snap),
        }
    return snap.cache[key]


def create_app(store: PriceStore | None = None) -> FastAPI:
    store = store or PriceStore(
        ttl=float(os.environ.get("XRP_PRICE_TTL_SECONDS", 3600)),
        max_serve_age=float(os.environ.get("XRP_MAX_SERVE_AGE_SECONDS", 3 * 86400)),
    )
    app = FastAPI(title="XRP Forecast API", version=__version__)
    origins = [o.strip() for o in os.environ.get("XRP_API_CORS_ORIGINS", "*").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_credentials=False)

    def error(status: int, code: str, message: str, headers: dict | None = None) -> JSONResponse:
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
        return error(e.status, e.code, e.message, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, e: RequestValidationError):
        msg = "; ".join(f"{'.'.join(map(str, d['loc'][1:]))}: {d['msg']}" for d in e.errors())
        return error(422, "invalid_request", msg)

    @app.get("/v1/health")
    def health():
        return {"status": "ok", "version": __version__, "prices": store.status()}

    @app.get("/v1/forecast")
    def forecast(
        horizon: int = Query(30, ge=1, le=MAX_HORIZON, description="Days ahead"),
        model: ModelName = Query("ensemble"),
    ):
        snap, refresh_error = store.get()
        body = dict(build_forecast(snap, model, horizon))
        age_days = (pd.Timestamp(store.clock(), unit="s").normalize() - snap.prices.index[-1]).days
        reasons = []
        if refresh_error:
            reasons.append(refresh_error)
        if age_days > STALE_AFTER_DAYS:
            reasons.append(f"Latest price is {age_days} days old.")
        body.update(
            generated_at=_iso(store.clock()),
            fetched_at=_iso(snap.fetched_at),
            stale=bool(reasons),
            stale_reason=" ".join(reasons) or None,
            disclaimer=DISCLAIMER,
        )
        # Fresh data may be cached briefly by clients/CDNs; stale data must not be.
        cache = "no-store" if reasons else "public, max-age=300"
        return JSONResponse(body, headers={"Cache-Control": cache})

    return app


app = create_app()
