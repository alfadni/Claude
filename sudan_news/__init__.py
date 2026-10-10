"""Aggregate the latest Sudan news from worldwide sources."""

from .models import Article
from .pipeline import collect

__all__ = ["Article", "collect"]
