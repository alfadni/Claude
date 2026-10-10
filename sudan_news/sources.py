"""Source adapters: GDELT, Google News editions, ReliefWeb and direct outlet feeds.

Every adapter is a ``Source`` whose ``fetch(hours)`` returns raw ``Article``s.
Relevance filtering, de-duplication and ranking happen later in ``pipeline``,
so adapters stay dumb and a broken feed only costs its own items.
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable

from .models import Article

USER_AGENT = "Mozilla/5.0 (compatible; sudan-news/0.1; +https://github.com/alfadni/claude)"

# Search terms sent to query-capable sources (GDELT, Google News). Local
# filtering in ``relevance`` is stricter and also handles South Sudan.
QUERY_TERMS = ["Sudan", "Khartoum", "Darfur", "Rapid Support Forces", "El Fasher", "Kordofan"]
QUERY_TERMS_AR = ["السودان", "الخرطوم", "دارفور", "الدعم السريع"]
QUERY_TERMS_FR = ["Soudan", "Khartoum", "Darfour"]


def http_get(url: str, timeout: float = 20.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


# --------------------------------------------------------------------------- dates

def parse_date(value: str | None) -> datetime | None:
    """Parse RFC 822 (RSS), ISO 8601 (Atom) or GDELT ``YYYYMMDDTHHMMSSZ`` into aware UTC."""
    if not value:
        return None
    value = value.strip()
    dt = None
    if re.fullmatch(r"\d{8}T\d{6}Z", value):
        dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    else:
        try:
            dt = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError):
            try:
                dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# --------------------------------------------------------------------------- RSS / Atom

_TAG_RE = re.compile(r"<[^>]+>")


def clean_text(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"\s+", " ", html.unescape(_TAG_RE.sub(" ", s))).strip()


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(el: ET.Element, *names: str) -> ET.Element | None:
    for c in el:
        if _local(c.tag) in names:
            return c
    return None


def _child_text(el: ET.Element, *names: str) -> str:
    c = _child(el, *names)
    return (c.text or "").strip() if c is not None else ""


def parse_feed(data: bytes, source_name: str, feed: str, language: str = "") -> list[Article]:
    """Parse RSS 2.0 or Atom into Articles. Namespaces are ignored on purpose."""
    root = ET.fromstring(data)
    out: list[Article] = []
    if _local(root.tag) == "feed":                                   # Atom
        lang = root.get("{http://www.w3.org/XML/1998/namespace}lang", language)
        for e in (c for c in root if _local(c.tag) == "entry"):
            link = ""
            for l in (c for c in e if _local(c.tag) == "link"):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            out.append(Article(
                title=clean_text(_child_text(e, "title")),
                url=link,
                source=source_name,
                published=parse_date(_child_text(e, "published", "updated")),
                summary=clean_text(_child_text(e, "summary", "content"))[:500],
                language=lang[:2], feed=feed,
            ))
        return out

    channel = _child(root, "channel")
    if channel is None:
        raise ValueError("not an RSS or Atom document")
    lang = _child_text(channel, "language") or language
    items = [c for c in channel if _local(c.tag) == "item"] or [c for c in root if _local(c.tag) == "item"]
    for it in items:
        src_el = _child(it, "source")
        publisher = (src_el.text or "").strip() if src_el is not None and src_el.text else source_name
        out.append(Article(
            title=clean_text(_child_text(it, "title")),
            url=_child_text(it, "link") or _child_text(it, "guid"),
            source=publisher,
            published=parse_date(_child_text(it, "pubDate", "date", "published", "updated")),
            summary=clean_text(_child_text(it, "description", "encoded"))[:500],
            language=lang[:2], feed=feed,
        ))
    return out


# --------------------------------------------------------------------------- sources

@dataclass
class Source:
    key: str                          # stable id used on the CLI (--sources)
    name: str
    kind: str                         # "api", "aggregator" or "outlet"
    fetch: Callable[[int], list[Article]]
    priority: int = 50                # lower wins when choosing a duplicate's representative


def _rss_source(key: str, name: str, url: str, language: str = "en", priority: int = 20) -> Source:
    return Source(key, name, "outlet", lambda hours: parse_feed(http_get(url), name, key, language), priority)


# GDELT DOC 2.0 monitors broadcast, print and web news in 65+ languages worldwide.
GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc?{}"
_GDELT_LANG = {"English": "en", "Arabic": "ar", "French": "fr", "Spanish": "es", "German": "de",
               "Russian": "ru", "Chinese": "zh", "Turkish": "tr", "Italian": "it", "Portuguese": "pt"}


def fetch_gdelt(hours: int, max_records: int = 250) -> list[Article]:
    terms = " OR ".join(f'"{t}"' if " " in t else t for t in QUERY_TERMS)
    params = {
        "query": f"({terms})",
        "mode": "ArtList", "format": "json", "sort": "DateDesc",
        "maxrecords": str(max_records), "timespan": f"{max(1, hours)}h",
    }
    raw = http_get(GDELT_URL.format(urllib.parse.urlencode(params)), timeout=30)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        # GDELT answers rate limits and bad queries with a plain-text message.
        raise RuntimeError(f"GDELT: {raw[:200].decode('utf-8', 'replace').strip()}")
    return [
        Article(
            title=clean_text(a.get("title")),
            url=a.get("url", ""),
            source=a.get("domain", "gdelt"),
            published=parse_date(a.get("seendate")),
            language=_GDELT_LANG.get(a.get("language", ""), a.get("language", "")[:2].lower()),
            country=a.get("sourcecountry", ""),
            feed="gdelt",
        )
        for a in payload.get("articles", [])
    ]


# Google News search, one edition per language/region for global reach.
GNEWS_EDITIONS = {
    "en": ("en-US", "US", "US:en", QUERY_TERMS),
    "gb": ("en-GB", "GB", "GB:en", QUERY_TERMS),
    "ar": ("ar", "EG", "EG:ar", QUERY_TERMS_AR),
    "fr": ("fr", "FR", "FR:fr", QUERY_TERMS_FR),
}


def _gnews_fetcher(edition: str) -> Callable[[int], list[Article]]:
    hl, gl, ceid, terms = GNEWS_EDITIONS[edition]

    def fetch(hours: int) -> list[Article]:
        window = f"{hours}h" if hours < 48 else f"{max(1, hours // 24)}d"
        q = " OR ".join(f'"{t}"' if " " in t else t for t in terms) + f" when:{window}"
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
            {"q": q, "hl": hl, "gl": gl, "ceid": ceid})
        arts = parse_feed(http_get(url), "Google News", f"gnews:{edition}", hl[:2])
        for a in arts:
            # Google appends " - Publisher" to every title.
            if a.source and a.title.endswith(f" - {a.source}"):
                a.title = a.title[: -len(a.source) - 3].rstrip()
        return arts

    return fetch


def build_sources() -> dict[str, Source]:
    srcs = [
        Source("gdelt", "GDELT global news monitor", "api", fetch_gdelt, priority=60),
        *(Source(f"gnews-{e}", f"Google News ({e})", "aggregator", _gnews_fetcher(e), priority=70)
          for e in GNEWS_EDITIONS),
        # ReliefWeb (UN OCHA): situation reports, appeals and NGO updates; PC220 = primary country Sudan.
        _rss_source("reliefweb", "ReliefWeb",
                    "https://reliefweb.int/updates/rss.xml?advanced-search=%28PC220%29", priority=10),
        # Sudan-focused outlets.
        _rss_source("dabanga", "Dabanga Sudan", "https://www.dabangasudan.org/en/feed", priority=10),
        _rss_source("sudantribune", "Sudan Tribune", "https://sudantribune.com/feed/", priority=10),
        # International outlets (general feeds, filtered locally for Sudan relevance).
        _rss_source("aljazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"),
        _rss_source("bbc-africa", "BBC News Africa", "https://feeds.bbci.co.uk/news/world/africa/rss.xml"),
        _rss_source("guardian", "The Guardian", "https://www.theguardian.com/world/sudan/rss"),
        _rss_source("un-news", "UN News",
                    "https://news.un.org/feed/subscribe/en/news/region/africa/feed/rss.xml"),
        _rss_source("france24", "France 24", "https://www.france24.com/en/africa/rss"),
        _rss_source("africanews", "Africanews", "https://www.africanews.com/feed/rss"),
    ]
    return {s.key: s for s in srcs}
