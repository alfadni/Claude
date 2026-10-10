import os
import tempfile
import unittest

import numpy as np
import pandas as pd

from xrp_forecast.__main__ import main
from xrp_forecast.backtest import backtest, inverse_error_weights
from xrp_forecast.data import load_csv
from xrp_forecast.models import COLUMNS, MODELS, ensemble


def synthetic_prices(n=800, seed=0, drift=0.0005, vol=0.04):
    rng = np.random.default_rng(seed)
    logp = np.log(0.5) + np.cumsum(rng.normal(drift, vol, n))
    return pd.Series(np.exp(logp), index=pd.date_range("2024-01-01", periods=n, freq="D"), name="close")


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.prices = synthetic_prices()

    def test_models_return_ordered_positive_quantiles(self):
        for name, fn in {**MODELS, "ensemble": ensemble}.items():
            with self.subTest(model=name):
                fc = fn(self.prices, 90)
                self.assertEqual(list(fc.columns), COLUMNS)
                self.assertEqual(len(fc), 90)
                self.assertEqual(fc.index[0], self.prices.index[-1] + pd.Timedelta(days=1))
                self.assertTrue((fc.values > 0).all())
                self.assertTrue((np.diff(fc.values, axis=1) >= 0).all(), "quantiles must be non-decreasing")

    def test_bands_widen_with_horizon(self):
        for name, fn in MODELS.items():
            with self.subTest(model=name):
                fc = fn(self.prices, 180)
                width = np.log(fc["p95"] / fc["p05"])
                self.assertGreater(width.iloc[-1], width.iloc[0])

    def test_random_walk_median_is_last_price(self):
        fc = MODELS["random_walk"](self.prices, 30)
        np.testing.assert_allclose(fc["p50"], self.prices.iloc[-1])


class BacktestTests(unittest.TestCase):
    def test_coverage_is_reasonable_on_random_walk_data(self):
        prices = synthetic_prices(n=900, drift=0.0, seed=3)
        scores = backtest(prices, horizon=30, n_cutoffs=20, step=20)
        self.assertIn("ensemble", scores.index)
        self.assertGreaterEqual(scores.loc["random_walk", "coverage"], 0.7)
        w = inverse_error_weights(scores)
        self.assertNotIn("random_walk", w)
        self.assertTrue(all(v > 0 for v in w.values()))


class CliTests(unittest.TestCase):
    def test_csv_end_to_end(self):
        prices = synthetic_prices(n=400)
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "xrp.csv")
            # Drop a few days to exercise gap filling.
            prices.drop(prices.index[[10, 11, 50]]).rename_axis("Date").rename("Close").to_csv(src)
            self.assertEqual(len(load_csv(src)), 400)
            out_csv, out_html = os.path.join(d, "fc.csv"), os.path.join(d, "fc.html")
            rc = main(["--csv", src, "--horizons", "7,30", "--weighted", "--out-csv", out_csv, "--out-html", out_html])
            self.assertEqual(rc, 0)
            self.assertEqual(len(pd.read_csv(out_csv)), 30)
            with open(out_html) as f:
                self.assertIn("<svg", f.read())


if __name__ == "__main__":
    unittest.main()
