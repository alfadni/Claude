import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from sudan_news import sources
from sudan_news.__main__ import main
from sudan_news.models import Article
from sudan_news.pipeline import canonical_url, deduplicate, process
from sudan_news.relevance import is_about_sudan, tag_topics
from sudan_news.sources import parse_date, parse_feed

NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)

RSS = b"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Google News</title><language>en-US</language>
<item><title>RSF drone strike hits El Fasher market, dozens killed - Reuters</title>
  <link>https://news.google.com/rss/articles/abc</link>
  <pubDate>Fri, 10 Oct 2026 09:30:00 GMT</pubDate>
  <description>&lt;a href="x"&gt;RSF drone strike&lt;/a&gt; in North Darfur</description>
  <source url="https://www.reuters.com">Reuters</source></item>
<item><title>South Sudan president reshuffles cabinet - AP</title>
  <link>https://news.google.com/rss/articles/def</link>
  <pubDate>Fri, 10 Oct 2026 08:00:00 GMT</pubDate>
  <source url="https://apnews.com">AP</source></item>
</channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ar">
<entry><title>الأمم المتحدة تحذر من مجاعة في كردفان</title>
  <link rel="alternate" href="https://example.org/ar/1"/>
  <updated>2026-10-10T07:00:00Z</updated>
  <summary>نازحين في السودان</summary></entry>
</feed>""".encode()


def art(title, url, source="X", hours_ago=1, feed="dabanga", summary=""):
    return Article(title=title, url=url, source=source, published=NOW - timedelta(hours=hours_ago),
                   feed=feed, summary=summary, language="en")


class ParsingTests(unittest.TestCase):
    def test_rss_with_publisher_source(self):
        items = parse_feed(RSS, "Google News", "gnews:en")
        self.assertEqual(len(items), 2)
        a = items[0]
        self.assertEqual(a.source, "Reuters")
        self.assertEqual(a.published, datetime(2026, 10, 10, 9, 30, tzinfo=timezone.utc))
        self.assertEqual(a.summary, "RSF drone strike in North Darfur")
        self.assertEqual(a.language, "en")

    def test_atom(self):
        (a,) = parse_feed(ATOM, "Outlet", "outlet")
        self.assertEqual(a.url, "https://example.org/ar/1")
        self.assertEqual(a.language, "ar")
        self.assertEqual(a.published.hour, 7)

    def test_date_formats(self):
        exp = datetime(2026, 10, 10, 9, 30, tzinfo=timezone.utc)
        self.assertEqual(parse_date("20261010T093000Z"), exp)
        self.assertEqual(parse_date("2026-10-10T11:30:00+02:00"), exp)
        self.assertEqual(parse_date("Fri, 10 Oct 2026 09:30:00 +0000"), exp)
        self.assertIsNone(parse_date("not a date"))

    def test_gdelt_adapter(self):
        payload = {"articles": [{"url": "https://lemonde.fr/a", "title": "Soudan : combats au Kordofan",
                                 "seendate": "20261010T100000Z", "domain": "lemonde.fr",
                                 "language": "French", "sourcecountry": "France"}]}
        with mock.patch.object(sources, "http_get", return_value=json.dumps(payload).encode()):
            (a,) = sources.fetch_gdelt(24)
        self.assertEqual((a.language, a.country, a.source), ("fr", "France", "lemonde.fr"))

    def test_gdelt_rate_limit_message_raises(self):
        with mock.patch.object(sources, "http_get", return_value=b"Please limit requests to one every 5 seconds"):
            with self.assertRaisesRegex(RuntimeError, "limit requests"):
                sources.fetch_gdelt(24)


class RelevanceTests(unittest.TestCase):
    def test_sudan_terms(self):
        for t in ["Fighting in Khartoum", "Famine in North Darfur", "Rapid Support Forces advance",
                  "Le Soudan face à la famine", "قصف في الفاشر"]:
            with self.subTest(t=t):
                self.assertTrue(is_about_sudan(art(t, "u")))

    def test_south_sudan_excluded_unless_asked(self):
        a = art("South Sudan president reshuffles cabinet", "u")
        self.assertFalse(is_about_sudan(a))
        self.assertTrue(is_about_sudan(a, include_south_sudan=True))
        self.assertTrue(is_about_sudan(art("Refugees from Sudan cross into South Sudan", "u")))

    def test_ambiguous_acronym_alone_does_not_match(self):
        self.assertFalse(is_about_sudan(art("RSF press freedom index released", "u")))

    def test_topics(self):
        self.assertEqual(tag_topics(art("Drone attack kills 20; WFP warns of famine", "u")),
                         ["conflict", "humanitarian"])
        self.assertIn("diplomacy", tag_topics(art("Quad envoys push Sudan ceasefire talks", "u")))


class DedupeTests(unittest.TestCase):
    def test_canonical_url_strips_tracking(self):
        self.assertEqual(canonical_url("http://www.bbc.co.uk/news/1/?utm_source=x&id=2#top"),
                         "https://bbc.co.uk/news/1?id=2")

    def test_same_story_merged_with_priority_and_earliest_time(self):
        items = [
            art("RSF drone strike hits El Fasher market, dozens killed", "https://news.google.com/a",
                source="Reuters", hours_ago=2, feed="gnews:en"),
            art("RSF drone strike hits El Fasher market dozens killed - Dabanga", "https://dabangasudan.org/x",
                source="Dabanga", hours_ago=1, feed="dabanga"),
            art("Cholera outbreak spreads in Kassala", "https://y", source="UN News", feed="un-news"),
        ]
        out = deduplicate(items, {"gnews:en": 70, "dabanga": 10, "un-news": 20})
        self.assertEqual(len(out), 2)
        rep = out[0]
        self.assertEqual(rep.source, "Dabanga")                 # direct outlet beats aggregator
        self.assertEqual(rep.also_reported_by, ["Reuters"])
        self.assertEqual(rep.coverage, 2)
        self.assertEqual(rep.published, NOW - timedelta(hours=2))  # first seen

    def test_process_filters_window_relevance_and_sorts(self):
        items = [
            art("Old Khartoum story", "https://a", hours_ago=50),
            art("Football results", "https://b", hours_ago=1),
            art("Port Sudan airport reopens", "https://c", hours_ago=3),
            art("Sennar dam shelling reported", "https://d", hours_ago=1),
        ]
        out = process(items, 24, {}, now=NOW)
        self.assertEqual([a.url for a in out], ["https://d", "https://c"])


class CliTests(unittest.TestCase):
    def test_end_to_end_with_stubbed_sources(self):
        now = datetime.now(timezone.utc)
        good = sources.Source("fake", "Fake", "outlet", lambda h: [
            Article("Darfur aid convoy reaches Tawila", "https://f/1", "Fake", now - timedelta(hours=1), feed="fake")])

        def broken(h):
            raise OSError("blocked")

        bad = sources.Source("dead", "Dead", "outlet", broken)
        with mock.patch("sudan_news.pipeline.build_sources", return_value={"fake": good, "dead": bad}), \
             mock.patch("sudan_news.__main__.build_sources", return_value={"fake": good, "dead": bad}), \
             tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.json")
            with mock.patch("sys.stderr"):
                rc = main(["--format", "json", "--out", path])
            self.assertEqual(rc, 0)
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["stories"][0]["topics"], ["humanitarian"])
        self.assertIn("dead", data["source_errors"])


if __name__ == "__main__":
    unittest.main()
