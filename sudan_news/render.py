"""Render ranked stories as terminal text, Markdown, or JSON."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone

from .models import Article


def _when(a: Article, now: datetime) -> str:
    if not a.published:
        return "time n/a"
    mins = int((now - a.published).total_seconds() // 60)
    if mins < 60:
        return f"{max(mins, 0)}m ago"
    if mins < 48 * 60:
        return f"{mins // 60}h ago"
    return a.published.strftime("%Y-%m-%d")


def _sources(a: Article) -> str:
    extra = f" +{len(a.also_reported_by)} more" if a.also_reported_by else ""
    return a.source + extra


def to_text(stories: list[Article], errors: dict[str, str], hours: int) -> str:
    now = datetime.now(timezone.utc)
    lines = [f"Sudan news — last {hours}h — {len(stories)} stories", ""]
    for i, a in enumerate(stories, 1):
        tags = f" [{', '.join(a.topics)}]" if a.topics else ""
        lines.append(f"{i:>3}. {a.title}{tags}")
        lines.append(f"     {_when(a, now)} · {_sources(a)} · {a.language or '?'}")
        lines.append(f"     {a.url}")
    lines += _footer(stories, errors)
    return "\n".join(lines)


def to_markdown(stories: list[Article], errors: dict[str, str], hours: int) -> str:
    now = datetime.now(timezone.utc)
    out = [f"# Sudan news — last {hours} hours",
           f"_Generated {now:%Y-%m-%d %H:%M} UTC · {len(stories)} unique stories_", ""]
    topics = Counter(t for a in stories for t in a.topics)
    if topics:
        out += ["**Topics:** " + ", ".join(f"{t} ({n})" for t, n in topics.most_common()), ""]
    out += ["| # | When | Headline | Source | Topics |", "|---|---|---|---|---|"]
    for i, a in enumerate(stories, 1):
        title = a.title.replace("|", "\\|")
        out.append(f"| {i} | {_when(a, now)} | [{title}]({a.url}) | {_sources(a)} | {', '.join(a.topics)} |")
    out += [""] + _footer(stories, errors)
    return "\n".join(out)


def to_json(stories: list[Article], errors: dict[str, str], hours: int) -> str:
    return json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
        "count": len(stories),
        "source_errors": errors,
        "stories": [a.to_dict() for a in stories],
    }, ensure_ascii=False, indent=2)


def _footer(stories: list[Article], errors: dict[str, str]) -> list[str]:
    out = []
    langs = Counter(a.language or "?" for a in stories)
    if langs:
        out.append("Languages: " + ", ".join(f"{l}={n}" for l, n in langs.most_common()))
    if errors:
        out.append("Unavailable sources: " + "; ".join(f"{k} ({v})" for k, v in sorted(errors.items())))
    return out


RENDERERS = {"text": to_text, "md": to_markdown, "json": to_json}
