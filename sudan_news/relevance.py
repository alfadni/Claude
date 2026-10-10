"""Decide whether an article is about Sudan, and tag it with topics."""

from __future__ import annotations

import re
import unicodedata

from .models import Article

# Mentions of South Sudan are removed before matching so "South Sudan" alone
# does not count as Sudan news. An article mentioning both still matches.
_SOUTH_SUDAN = re.compile(
    r"south(?:ern)?[\s-]+sudan(?:ese)?|جنوب\s+السودان|soudan\s+du\s+sud|sud[-\s]soudan", re.I)

# Word-bounded Latin-script terms; lowercase.
_TERMS = [
    "sudan", "sudanese", "soudan", "soudanais", "sudán", "khartoum", "omdurman", "port sudan",
    "darfur", "darfour", "el fasher", "al-fashir", "el-fasher", "el geneina", "nyala", "kordofan",
    "el obeid", "kadugli", "dilling", "babanusa", "gezira", "wad madani", "sennar", "kassala",
    "gedaref", "blue nile", "white nile", "zamzam", "tawila", "rapid support forces", "burhan",
    "hemedti", "dagalo", "sudan armed forces", "sudanese armed forces", "tasis", "kamil idris",
]
_TERMS_RE = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in _TERMS) + r")\b", re.I)
# Arabic script has no reliable \b; substring match is fine for these.
_TERMS_AR = ["السودان", "سوداني", "الخرطوم", "أم درمان", "بورتسودان", "دارفور", "الفاشر",
             "كردفان", "الأبيض", "الجزيرة ود مدني", "الدعم السريع", "البرهان", "حميدتي"]
# "RSF"/"SAF" are ambiguous (Reporters Without Borders, other armies), so they
# only count when another Sudan term is present; they still feed topic tags.

TOPICS = {
    "conflict": ["attack", "shelling", "drone", "offensive", "clashes", "killed", "fighting",
                 "siege", "massacre", "militia", "army", "rsf", "saf", "ceasefire violation",
                 "هجوم", "قصف", "مسيرة", "اشتباكات", "حصار"],
    "humanitarian": ["famine", "hunger", "displaced", "refugee", "aid", "humanitarian", "cholera",
                     "outbreak", "malnutrition", "wfp", "unhcr", "ocha", "unicef", "msf",
                     "مجاعة", "نازحين", "لاجئين", "إغاثة", "كوليرا"],
    "diplomacy": ["talks", "ceasefire", "truce", "negotiation", "envoy", "sanctions", "security council",
                  "quad", "jeddah", "peace", "summit", "mediation", "هدنة", "مفاوضات", "عقوبات"],
    "politics": ["government", "prime minister", "parliament", "cabinet", "election", "transitional",
                 "parallel government", "حكومة", "رئيس الوزراء"],
    "economy": ["gold", "pound", "inflation", "economy", "oil", "export", "bank", "fuel", "prices",
                "الذهب", "الجنيه", "اقتصاد"],
    "rights": ["war crimes", "genocide", "icc", "human rights", "sexual violence", "ethnic",
               "accountability", "جرائم حرب", "إبادة", "حقوق الإنسان"],
}


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def is_about_sudan(article: Article, include_south_sudan: bool = False) -> bool:
    text = _norm(f"{article.title} {article.summary}")
    if include_south_sudan and _SOUTH_SUDAN.search(text):
        return True
    text = _SOUTH_SUDAN.sub(" ", text)
    return bool(_TERMS_RE.search(text)) or any(t in text for t in _TERMS_AR)


def tag_topics(article: Article) -> list[str]:
    text = _norm(f"{article.title} {article.summary}")
    tags = []
    for topic, words in TOPICS.items():
        for w in words:
            pat = rf"\b{re.escape(w)}\b" if w.isascii() else re.escape(w)
            if re.search(pat, text):
                tags.append(topic)
                break
    return tags
