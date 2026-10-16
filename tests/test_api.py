import threading
import time
import unittest

import pandas as pd
from fastapi.testclient import TestClient

from xrp_forecast.api import PriceStore, create_app
from xrp_forecast.models import COLUMNS

from test_forecast import synthetic_prices

DAY = 86400.0


class FakeClock:
    def __init__(self, prices: pd.Series):
        # Start "today" = the day of the last close, midday UTC.
        self.now = prices.index[-1].timestamp() + DAY / 2

    def __call__(self):
        return self.now


class FakeLoader:
    def __init__(self, prices):
        self.prices, self.calls, self.fail = prices, 0, False

    def __call__(self):
        self.calls += 1
        if self.fail:
            raise ConnectionError("upstream down")
        return self.prices


def make(prices=None, ttl=3600, max_serve_age=3 * DAY):
    prices = synthetic_prices(400) if prices is None else prices
    loader, clock = FakeLoader(prices), FakeClock(prices)
    store = PriceStore(loader, ttl=ttl, max_serve_age=max_serve_age, clock=clock)
    return TestClient(create_app(store)), loader, clock


class ForecastEndpointTests(unittest.TestCase):
    def test_happy_path_shape(self):
        client, _, _ = make()
        r = client.get("/v1/forecast", params={"horizon": 30})
        self.assertEqual(r.status_code, 200)
        b = r.json()
        self.assertEqual(b["horizon_days"], 30)
        self.assertEqual(b["model"], "ensemble")
        self.assertEqual(len(b["forecast"]), 30)
        self.assertEqual(len(b["history"]), 60)
        self.assertFalse(b["stale"])
        self.assertIsNone(b["stale_reason"])
        self.assertIn("Not financial advice", b["disclaimer"])
        self.assertEqual(r.headers["cache-control"], "public, max-age=300")
        for row in b["forecast"]:
            vals = [row[c] for c in COLUMNS]
            self.assertEqual(vals, sorted(vals))
            self.assertTrue(all(v > 0 for v in vals))
        self.assertEqual(b["summary"]["p50"], b["forecast"][-1]["p50"])
        self.assertEqual(b["history"][-1]["date"], b["data_as_of"])
        self.assertGreater(b["forecast"][0]["date"], b["data_as_of"])
        models = {m["model"] for m in b["backtest"]["models"]}
        self.assertIn("random_walk", models)
        self.assertIn("ensemble", models)

    def test_every_model_and_long_horizon(self):
        client, _, _ = make()
        for model in ["ensemble", "random_walk", "gbm", "bootstrap", "log_trend", "holt_damped"]:
            with self.subTest(model=model):
                b = client.get("/v1/forecast", params={"horizon": 365, "model": model}).json()
                self.assertEqual(len(b["forecast"]), 365)
                self.assertEqual(len(b["history"]), 365)

    def test_rejects_bad_params(self):
        client, loader, _ = make()
        for params in ({"horizon": 0}, {"horizon": 366}, {"horizon": "abc"}, {"model": "magic"}):
            with self.subTest(params=params):
                r = client.get("/v1/forecast", params=params)
                self.assertEqual(r.status_code, 422)
                self.assertEqual(r.json()["error"]["code"], "invalid_request")
        self.assertEqual(loader.calls, 0, "invalid requests must not hit upstream")

    def test_caches_prices_within_ttl_and_refreshes_after(self):
        client, loader, clock = make(ttl=3600)
        client.get("/v1/forecast", params={"horizon": 7})
        client.get("/v1/forecast", params={"horizon": 30})
        self.assertEqual(loader.calls, 1)
        clock.now += 3601
        client.get("/v1/forecast", params={"horizon": 7})
        self.assertEqual(loader.calls, 2)

    def test_concurrent_expired_requests_refresh_once(self):
        prices = synthetic_prices(400)
        calls = []

        def slow_loader():
            calls.append(1)
            time.sleep(0.2)
            return prices

        store = PriceStore(slow_loader, ttl=3600, clock=FakeClock(prices))
        threads = [threading.Thread(target=store.get) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(calls), 1)

    def test_upstream_down_with_no_data_is_503(self):
        client, loader, _ = make()
        loader.fail = True
        r = client.get("/v1/forecast")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"]["code"], "upstream_unavailable")
        self.assertEqual(r.headers["retry-after"], "60")
        self.assertNotIn("upstream down", r.text, "internal errors must not leak to clients")

    def test_upstream_down_serves_last_good_data_flagged_stale(self):
        client, loader, clock = make(ttl=3600)
        self.assertFalse(client.get("/v1/forecast").json()["stale"])
        loader.fail = True
        clock.now += 7200
        r = client.get("/v1/forecast")
        self.assertEqual(r.status_code, 200)
        b = r.json()
        self.assertTrue(b["stale"])
        self.assertIn("refresh failed", b["stale_reason"])
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertIn("ConnectionError", client.get("/v1/health").json()["prices"]["last_refresh_error"])

    def test_upstream_down_too_long_stops_serving(self):
        client, loader, clock = make(ttl=3600, max_serve_age=DAY)
        client.get("/v1/forecast")
        loader.fail = True
        clock.now += DAY + 1
        self.assertEqual(client.get("/v1/forecast").status_code, 503)

    def test_recovers_after_upstream_comes_back(self):
        client, loader, clock = make(ttl=3600)
        client.get("/v1/forecast")
        loader.fail = True
        clock.now += 7200
        self.assertTrue(client.get("/v1/forecast").json()["stale"])
        loader.fail = False
        b = client.get("/v1/forecast").json()
        self.assertFalse(b["stale"])
        self.assertIsNone(client.get("/v1/health").json()["prices"]["last_refresh_error"])

    def test_old_last_close_is_stale_even_when_fetch_succeeds(self):
        client, _, clock = make(ttl=1e12)
        clock.now += 3 * DAY
        b = client.get("/v1/forecast").json()
        self.assertTrue(b["stale"])
        self.assertIn("days old", b["stale_reason"])

    def test_short_history_skips_backtest(self):
        client, _, _ = make(prices=synthetic_prices(120))
        b = client.get("/v1/forecast").json()
        self.assertIsNone(b["backtest"])
        self.assertEqual(len(b["forecast"]), 30)

    def test_health_does_not_call_upstream(self):
        client, loader, _ = make()
        b = client.get("/v1/health").json()
        self.assertEqual(b["status"], "ok")
        self.assertFalse(b["prices"]["has_data"])
        self.assertEqual(loader.calls, 0)


if __name__ == "__main__":
    unittest.main()
