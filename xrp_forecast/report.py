"""Render forecasts as a self-contained HTML report with an inline SVG chart."""

from __future__ import annotations

import html

import numpy as np
import pandas as pd


def _fmt(p: float) -> str:
    return f"${p:,.4f}" if p < 1 else f"${p:,.3f}"


def _chart(history: pd.Series, fc: pd.DataFrame, width=900, height=380) -> str:
    pad_l, pad_r, pad_t, pad_b = 64, 16, 16, 32
    x0, x1 = history.index[0], fc.index[-1]
    lo = min(history.min(), fc["p05"].min())
    hi = max(history.max(), fc["p95"].max())
    llo, lhi = np.log(lo * 0.95), np.log(hi * 1.05)
    span = (x1 - x0).days or 1

    def X(d):
        return pad_l + (d - x0).days / span * (width - pad_l - pad_r)

    def Y(v):
        return pad_t + (lhi - np.log(v)) / (lhi - llo) * (height - pad_t - pad_b)

    def line(s):
        return " ".join(f"{X(d):.1f},{Y(v):.1f}" for d, v in s.items())

    def band(lo_s, hi_s):
        pts = [f"{X(d):.1f},{Y(v):.1f}" for d, v in hi_s.items()]
        pts += [f"{X(d):.1f},{Y(v):.1f}" for d, v in reversed(list(lo_s.items()))]
        return " ".join(pts)

    ticks = np.exp(np.linspace(llo, lhi, 6))
    grid = "".join(
        f'<line x1="{pad_l}" x2="{width - pad_r}" y1="{Y(t):.1f}" y2="{Y(t):.1f}" class="grid"/>'
        f'<text x="{pad_l - 6}" y="{Y(t) + 4:.1f}" text-anchor="end" class="axis">{_fmt(t)}</text>'
        for t in ticks
    )
    months = pd.date_range(x0, x1, freq="QS")
    xt = "".join(
        f'<text x="{X(m):.1f}" y="{height - 10}" text-anchor="middle" class="axis">{m:%b %Y}</text>' for m in months
    )
    return f"""<svg viewBox="0 0 {width} {height}" role="img" aria-label="XRP price history and forecast">
{grid}{xt}
<polygon points="{band(fc['p05'], fc['p95'])}" class="b90"/>
<polygon points="{band(fc['p25'], fc['p75'])}" class="b50"/>
<polyline points="{line(history)}" class="hist"/>
<polyline points="{line(fc['p50'])}" class="med"/>
<line x1="{X(history.index[-1]):.1f}" x2="{X(history.index[-1]):.1f}" y1="{pad_t}" y2="{height - pad_b}" class="today"/>
</svg>"""


def render_html(prices: pd.Series, fc: pd.DataFrame, summary: pd.DataFrame, scores: pd.DataFrame | None) -> str:
    rows = "".join(
        f"<tr><td>{h}d</td><td>{d:%Y-%m-%d}</td>"
        + "".join(f"<td>{_fmt(r[c])}</td>" for c in ("p05", "p25", "p50", "p75", "p95"))
        + f"<td>{r['p50'] / prices.iloc[-1] - 1:+.1%}</td></tr>"
        for (h, d), r in summary.iterrows()
    )
    score_html = ""
    if scores is not None:
        score_rows = "".join(
            f"<tr><td>{html.escape(m)}</td><td>{r['mape']:.1%}</td><td>{r['coverage']:.0%}</td><td>{int(r['n'])}</td></tr>"
            for m, r in scores.iterrows()
        )
        score_html = f"""<h2>Backtest</h2>
<p class="note">Walk-forward test: each model refit at past dates and scored on the price that followed.
Lower MAPE is better; a well-calibrated 90% band should cover ~90% of outcomes.
If no model beats <code>random_walk</code>, treat the trend in the median as noise.</p>
<table><thead><tr><th>Model</th><th>MAPE</th><th>90% coverage</th><th>Cutoffs</th></tr></thead><tbody>{score_rows}</tbody></table>"""

    history = prices.iloc[-365:]
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>XRP Price Forecast</title>
<style>
:root{{--bg:#fbfbfa;--fg:#1d1d1f;--muted:#6b6b70;--line:#e3e3e0;--hist:#3a3a3c;--accent:#1f6feb;--b50:rgba(31,111,235,.28);--b90:rgba(31,111,235,.12)}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151517;--fg:#ececee;--muted:#9a9aa0;--line:#2c2c30;--hist:#d0d0d4;--accent:#5b9bff;--b50:rgba(91,155,255,.32);--b90:rgba(91,155,255,.14)}}}}
body{{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px 16px}}
h1{{margin:0 0 4px;font-size:24px}} h2{{font-size:18px;margin-top:32px}}
.note{{color:var(--muted);font-size:13px}} svg{{width:100%;height:auto}}
.grid{{stroke:var(--line)}} .axis{{fill:var(--muted);font-size:11px}}
.hist{{fill:none;stroke:var(--hist);stroke-width:1.5}} .med{{fill:none;stroke:var(--accent);stroke-width:2}}
.b50{{fill:var(--b50)}} .b90{{fill:var(--b90)}} .today{{stroke:var(--muted);stroke-dasharray:3 3}}
.tw{{overflow-x:auto}} table{{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:14px}}
th,td{{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right}} th:first-child,td:first-child{{text-align:left}}
</style></head><body>
<h1>XRP / USD forecast</h1>
<p class="note">Last close {_fmt(prices.iloc[-1])} on {prices.index[-1]:%Y-%m-%d} · ensemble median with 50% and 90% bands (log scale)</p>
{_chart(history, fc)}
<h2>Forecast by horizon</h2>
<div class="tw"><table><thead><tr><th>Horizon</th><th>Date</th><th>5%</th><th>25%</th><th>Median</th><th>75%</th><th>95%</th><th>Median Δ</th></tr></thead>
<tbody>{rows}</tbody></table></div>
<div class="tw">{score_html}</div>
<p class="note">Statistical projections from past prices only. They ignore news, regulation, and market structure,
and crypto prices regularly move outside any band. Not financial advice.</p>
</body></html>"""
