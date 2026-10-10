"""Command-line entry point: ``python -m sudan_news``."""

from __future__ import annotations

import argparse
import sys

from .pipeline import collect
from .render import RENDERERS
from .sources import build_sources


def main(argv=None) -> int:
    keys = list(build_sources())
    p = argparse.ArgumentParser(prog="sudan_news", description="Latest Sudan news from worldwide sources.")
    p.add_argument("--hours", type=int, default=24, help="Look-back window in hours (default 24)")
    p.add_argument("--limit", type=int, default=50, help="Max stories to show (0 = all)")
    p.add_argument("--sources", help=f"Comma-separated subset of: {','.join(keys)}")
    p.add_argument("--lang", help="Keep only these languages, e.g. en,ar,fr")
    p.add_argument("--topic", help="Keep only stories tagged with one of these topics, e.g. humanitarian,diplomacy")
    p.add_argument("--sort", choices=["recent", "coverage"], default="recent",
                   help="Newest first, or most widely reported first")
    p.add_argument("--include-south-sudan", action="store_true", help="Also keep South Sudan-only stories")
    p.add_argument("--format", choices=list(RENDERERS), default="text")
    p.add_argument("--out", help="Write output to this file instead of stdout")
    p.add_argument("--list-sources", action="store_true", help="List available sources and exit")
    a = p.parse_args(argv)

    if a.list_sources:
        for s in build_sources().values():
            print(f"{s.key:<14} {s.kind:<10} {s.name}")
        return 0

    stories, errors = collect(
        hours=a.hours,
        source_keys=[s.strip() for s in a.sources.split(",")] if a.sources else None,
        include_south_sudan=a.include_south_sudan,
        languages={l.strip() for l in a.lang.split(",")} if a.lang else None,
        sort=a.sort,
    )
    if a.topic:
        wanted = {t.strip() for t in a.topic.split(",")}
        stories = [s for s in stories if wanted & set(s.topics)]
    if a.limit:
        stories = stories[: a.limit]

    text = RENDERERS[a.format](stories, errors, a.hours)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"Wrote {len(stories)} stories to {a.out}", file=sys.stderr)
    else:
        print(text)
    for k, v in errors.items():
        print(f"warning: source {k} failed: {v}", file=sys.stderr)
    # Exit 2 only when every source failed, so schedulers can alert on a dead run.
    return 2 if errors and len(errors) == len(a.sources.split(",") if a.sources else keys) else 0


if __name__ == "__main__":
    sys.exit(main())
