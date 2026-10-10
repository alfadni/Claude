"""Fetch all sources in parallel, then filter, de-duplicate, tag and rank."""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from .models import Article
from .relevance import is_about_sudan, tag_topics
from .sources import Source, build_sources

_TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|ocid$|cmpid$|ref$|src$|at_)", re.I)


def canonical_url(url: str) -> str:
    p = urllib.parse.urlsplit(url.strip())
    host = p.netloc.lower().removeprefix("www.").removeprefix("m.")
    query = urllib.parse.urlencode(
        [(k, v) for k, v in urllib.parse.parse_qsl(p.query) if not _TRACKING.match(k)])
    return urllib.parse.urlunsplit(("https", host, p.path.rstrip("/"), query, ""))


def title_tokens(title: str) -> frozenset[str]:
    t = unicodedata.normalize("NFKC", title).casefold()
    t = re.sub(r"\s+[-|–—]\s+[^-|–—]{2,40}$", "", t)      # trailing " - Publisher"
    return frozenset(w for w in re.findall(r"\w+", t) if len(w) > 2)


def _similar(a: frozenset[str], b: frozenset[str], threshold: float) -> bool:
    if len(a) < 4 or len(b) < 4:
        return a == b and bool(a)
    return len(a & b) / len(a | b) >= threshold


def deduplicate(articles: list[Article], priority: dict[str, int], threshold: float = 0.7) -> list[Article]:
    """Cluster by canonical URL, then by title similarity; keep one representative per story.

    The representative is the copy from the highest-priority feed (direct outlets
    beat aggregators), and its ``published`` becomes the earliest time any copy
    was seen, i.e. when the story first broke.
    """
    ordered = sorted(articles, key=lambda a: priority.get(a.feed, 50))
    kept: list[tuple[Article, str, frozenset[str]]] = []
    by_url: dict[str, int] = {}
    for art in ordered:
        cu, toks = canonical_url(art.url), title_tokens(art.title)
        idx = by_url.get(cu)
        if idx is None:
            idx = next((i for i, (_, _, kt) in enumerate(kept) if _similar(toks, kt, threshold)), None)
        if idx is None:
            by_url[cu] = len(kept)
            kept.append((art, cu, toks))
            continue
        rep = kept[idx][0]
        by_url.setdefault(cu, idx)
        if art.source != rep.source and art.source not in rep.also_reported_by:
            rep.also_reported_by.append(art.source)
        if art.published and (rep.published is None or art.published < rep.published):
            rep.published = art.published
        rep.summary = rep.summary or art.summary
        rep.country = rep.country or art.country
    return [k[0] for k in kept]


def fetch_all(sources: list[Source], hours: int, workers: int = 8) -> tuple[list[Article], dict[str, str]]:
    """Run every source concurrently. Returns (articles, {source_key: error}) — failures never abort."""
    articles: list[Article] = []
    errors: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(s.fetch, hours): s for s in sources}
        for f in as_completed(futs):
            s = futs[f]
            try:
                articles.extend(f.result())
            except Exception as e:  # noqa: BLE001 — one bad feed must not sink the run
                errors[s.key] = f"{type(e).__name__}: {e}"[:200]
    return articles, errors


def process(articles: list[Article], hours: int, priority: dict[str, int], *,
            include_south_sudan: bool = False, languages: set[str] | None = None,
            now: datetime | None = None, sort: str = "recent") -> list[Article]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    keep = [
        a for a in articles
        if a.title and a.url
        and (a.published is None or cutoff <= a.published <= now + timedelta(minutes=10))
        and (not languages or not a.language or a.language in languages)
        and is_about_sudan(a, include_south_sudan)
    ]
    stories = deduplicate(keep, priority)
    for a in stories:
        a.topics = tag_topics(a)
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    if sort == "coverage":
        stories.sort(key=lambda a: (a.coverage, a.published or epoch), reverse=True)
    else:
        stories.sort(key=lambda a: a.published or epoch, reverse=True)
    return stories


def collect(hours: int = 24, source_keys: list[str] | None = None, **kw) -> tuple[list[Article], dict[str, str]]:
    """One-call API: fetch, filter, de-duplicate and rank. Returns (stories, errors)."""
    registry = build_sources()
    unknown = set(source_keys or []) - set(registry)
    if unknown:
        raise ValueError(f"unknown sources: {sorted(unknown)}; choose from {sorted(registry)}")
    chosen = [registry[k] for k in source_keys] if source_keys else list(registry.values())
    raw, errors = fetch_all(chosen, hours)
    return process(raw, hours, feed_priority(registry), **kw), errors


def feed_priority(registry: dict[str, Source]) -> dict[str, int]:
    """Map Article.feed values to source priority (gnews feeds are 'gnews:en', keys 'gnews-en')."""
    return {s.key.replace("gnews-", "gnews:"): s.priority for s in registry.values()}
