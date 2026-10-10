"""Normalized article record shared by every source adapter."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime


@dataclass
class Article:
    title: str
    url: str
    source: str                      # publisher name, e.g. "Reuters"
    published: datetime | None       # timezone-aware UTC, None if the feed omits it
    summary: str = ""
    language: str = ""               # ISO 639-1 where known
    country: str = ""                # publisher country where known (GDELT)
    feed: str = ""                   # adapter that produced it, e.g. "gdelt", "gnews:ar"
    topics: list[str] = field(default_factory=list)
    also_reported_by: list[str] = field(default_factory=list)

    @property
    def coverage(self) -> int:
        """Number of distinct outlets carrying this story (after de-duplication)."""
        return 1 + len(self.also_reported_by)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["published"] = self.published.isoformat() if self.published else None
        d["coverage"] = self.coverage
        return d
