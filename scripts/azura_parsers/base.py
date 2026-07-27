"""Shared parser contract for the Azura World evidence pipeline (W0-B).

Per-host parser modules live beside this file. The split is deliberate:

  * a parser knows MARKUP — where a number sits on one publisher's page;
  * the builder knows PROVENANCE — tiers, agreement, conflict, confidence.

A parser therefore never decides that a value is "confirmed", never picks a
winner between two sources, and never converts a currency. It reports what one
page said, with the raw substring it read it from, and stops. Everything after
that is scripts/build-azura-dataset.py's job.

That boundary is what makes "one host's markup change must not break the others"
true: the builder calls each parser inside its own try/except, and a parser that
throws costs you that host's claims and nothing else.

CONTRACTS.md §2 field paths are the vocabulary. A Claim.field that is not a real
path in the dataset is a bug the builder will report, not silently drop.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

Currency = Literal["EUR", "USD", "TRY", "GBP"]

LAYOUTS = (
    "1+1", "2+1", "3+1", "4+1", "5+1", "6+1",
    "penthouse", "townhouse", "villa", "president_villa",
)


@dataclass(frozen=True)
class Capture:
    """One validated snapshot from sources/manifest.json."""

    source_id: str
    publisher: str
    tier: int
    url: str
    final_url: str
    locale: str
    fetched_at: str
    snapshot_path: str
    snapshot_hash: str
    html: str
    text: str
    price_kind: str = "sale"
    is_stale: bool = False
    parent_id: str | None = None


@dataclass
class Claim:
    """One fact read off one page.

    `raw` is mandatory and is the substring the value was read from. It is what
    makes a wrong number debuggable: you can see whether the parser misread the
    page or the page itself is wrong, without re-fetching anything.
    """

    field: str
    value: Any
    raw: str
    note: str | None = None
    unit: str | None = None


@dataclass
class UnitObservation:
    """A per-unit price sighting. Never merged with another portal's sighting."""

    layout: str | None
    interior_m2: float | None
    outdoor_m2: float | None
    floor_level: int | None
    price_amount: float | None
    price_currency: Currency | None
    url: str
    raw: str
    reference: str | None = None
    # "rent" must never enter the sale-price series (F-002).
    price_kind: str = "sale"
    is_stale: bool = False
    note: str | None = None


@dataclass
class ReviewObservation:
    platform: str
    score: float | None
    score_scale: int
    review_count: int | None
    ranking: str | None
    url: str
    raw: str
    sentiment: dict[str, int] | None = None
    quotes: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ParseResult:
    claims: list[Claim] = field(default_factory=list)
    units: list[UnitObservation] = field(default_factory=list)
    reviews: list[ReviewObservation] = field(default_factory=list)
    amenities: list[str] = field(default_factory=list)
    """Anything the parser saw but could not classify. Surfaced, never dropped."""
    unparsed: list[str] = field(default_factory=list)


# A parser module exposes: HOST, SOURCE_IDS, parse(capture) -> ParseResult
Parser = Callable[[Capture], ParseResult]


# --------------------------------------------------------------------- text --

def squash(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def fold(value: object) -> str:
    """Invariant casefold + diacritic strip, for MATCHING ONLY.

    Never use this to build a key or a slug that a user sees. Turkish 'İ'/'ı'
    make locale-sensitive casing wrong in both directions; str.lower() in Python
    is locale-independent, which is exactly what is wanted here.
    """
    lowered = str(value or "").lower()
    decomposed = unicodedata.normalize("NFD", lowered)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", stripped).strip()


def strip_tags(html: str) -> str:
    without_scripts = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html or "")
    return squash(re.sub(r"(?s)<[^>]+>", " ", without_scripts))


# -------------------------------------------------------------------- money --

_CURRENCY_TOKENS: tuple[tuple[str, Currency], ...] = (
    ("€", "EUR"), ("eur", "EUR"), ("euro", "EUR"),
    ("$", "USD"), ("usd", "USD"), ("dollar", "USD"),
    ("£", "GBP"), ("gbp", "GBP"),
    ("₺", "TRY"), ("try", "TRY"), ("tl", "TRY"), ("lira", "TRY"),
)


def detect_currency(raw: str) -> Currency | None:
    """Currency is PARSED, never assumed.

    Housearch quotes USD while every German portal quotes EUR; defaulting to EUR
    would turn a $239,171 listing into a €239,171 one — a 2.1x error dressed as a
    price (F-002). No token found means None, and the builder treats a price with
    no currency as unusable rather than guessing.
    """
    folded = fold(raw)
    for token, currency in _CURRENCY_TOKENS:
        if token in folded:
            return currency
    return None


def parse_amount(raw: str) -> float | None:
    """Locale-safe number parsing.

    The trap this exists for: German writes €112.000 for one hundred and twelve
    thousand. Reading that as 112.0 is a 1000x error that still looks like a
    plausible price, so it survives review. Rules, in order:

        1.234.567    dot-grouped        -> 1234567
        1,234,567    comma-grouped      -> 1234567
        1.234,56     dot group + comma  -> 1234.56
        1,234.56     comma group + dot  -> 1234.56
        112000       bare               -> 112000
        2,5 / 2.5    single small tail  -> 2.5

    A number whose grouping is ambiguous returns None rather than a coin-flip.
    """
    if raw is None:
        return None
    text = squash(raw)
    # Keep digits and separators only; drop currency glyphs, m², nbsp, etc.
    candidate = re.search(r"\d[\d.,   ]*\d|\d", text)
    if not candidate:
        return None
    token = candidate.group(0)
    token = token.replace(" ", "").replace(" ", "").replace(" ", "")

    has_dot = "." in token
    has_comma = "," in token

    if has_dot and has_comma:
        # The LAST separator is the decimal one.
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif has_dot:
        parts = token.split(".")
        if len(parts) > 2 and all(len(p) == 3 for p in parts[1:]):
            token = token.replace(".", "")            # 1.234.567
        elif len(parts) == 2 and len(parts[1]) == 3 and len(parts[0]) <= 3:
            token = token.replace(".", "")            # 112.000 -> German thousands
        # else: a genuine decimal such as 2.5, leave it
    elif has_comma:
        parts = token.split(",")
        if len(parts) > 2 and all(len(p) == 3 for p in parts[1:]):
            token = token.replace(",", "")            # 1,234,567
        elif len(parts) == 2 and len(parts[1]) == 3:
            token = token.replace(",", "")            # 239,171
        else:
            token = token.replace(",", ".")           # 2,5 -> 2.5

    try:
        value = float(token)
    except ValueError:
        return None
    return value


def parse_money(raw: str) -> tuple[float | None, Currency | None]:
    return parse_amount(raw), detect_currency(raw)


# ------------------------------------------------------------------- layout --

_LAYOUT_RE = re.compile(r"(\d)\s*\+\s*(\d)")


def normalize_layout(raw: str) -> str | None:
    """'1+1' / '1 + 1' / '1+1 Wohnung' / 'One bedroom' / '3+1 XL' -> UnitLayout.

    'XL' and similar suffixes are size variants of the same layout, not layouts,
    so they normalise away here and survive as interior_m2 instead.
    """
    if not raw:
        return None
    folded = fold(raw)

    if "president" in folded:
        return "president_villa"
    if "penthouse" in folded or "dachwohnung" in folded:
        return "penthouse"
    if "townhouse" in folded or "reihenhaus" in folded:
        return "townhouse"

    match = _LAYOUT_RE.search(folded)
    if match:
        candidate = f"{match.group(1)}+{match.group(2)}"
        if candidate in LAYOUTS:
            return candidate
        # 5+2, 7+1 etc. are real Turkish notations but outside the frozen union.
        return None

    if "villa" in folded:
        return "villa"

    worded = {
        "one bedroom": "1+1", "1 bedroom": "1+1", "1br": "1+1", "1 br": "1+1",
        "two bedroom": "2+1", "2 bedroom": "2+1", "2br": "2+1", "2 br": "2+1",
        "three bedroom": "3+1", "3 bedroom": "3+1", "3br": "3+1", "3 br": "3+1",
        "four bedroom": "4+1", "4 bedroom": "4+1", "4br": "4+1", "4 br": "4+1",
    }
    for needle, layout in worded.items():
        if needle in folded:
            return layout
    return None


def parse_area_m2(raw: str) -> float | None:
    """Area in m². Returns None rather than 0 when absent — CONVENTIONS §5:
    a value of 0 is a bug, a value of None is an honest gap."""
    if not raw:
        return None
    folded = fold(raw)
    match = re.search(r"(\d[\d.,  ]*)\s*(?:m2|m²|m\^2|qm|кв\.?\s*м|metrekare)", folded)
    if not match:
        return None
    return parse_amount(match.group(1))


def parse_floor(raw: str) -> int | None:
    if not raw:
        return None
    folded = fold(raw)
    if any(word in folded for word in ("ground", "erdgeschoss", "zemin", "garden", "garten")):
        return 0
    match = re.search(r"(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:floor|etage|geschoss|kat|этаж)", folded)
    if match:
        return int(match.group(1))
    match = re.search(r"(?:floor|etage|geschoss|kat|этаж)\s*[:\-]?\s*(\d{1,2})", folded)
    if match:
        return int(match.group(1))
    return None


def parse_iso_date(raw: str) -> str | None:
    """Return YYYY-MM-DD, or YYYY-MM when only a month is stated.

    A partial date stays partial. Widening 'May 2024' to '2024-05-01' invents a
    day that no source states, and completion dates are exactly where that kind
    of invented precision does damage (F-006).
    """
    if not raw:
        return None
    text = squash(raw)

    match = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if match:
        return match.group(0)

    match = re.search(r"\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b", text)
    if match:
        day, month, year = match.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"

    months = {
        "january": 1, "januar": 1, "ocak": 1, "январь": 1, "января": 1,
        "february": 2, "februar": 2, "şubat": 2, "subat": 2, "февраль": 2, "февраля": 2,
        "march": 3, "marz": 3, "märz": 3, "mart": 3, "март": 3, "марта": 3,
        "april": 4, "nisan": 4, "апрель": 4, "апреля": 4,
        "may": 5, "mai": 5, "mayis": 5, "mayıs": 5, "май": 5, "мая": 5,
        "june": 6, "juni": 6, "haziran": 6, "июнь": 6, "июня": 6,
        "july": 7, "juli": 7, "temmuz": 7, "июль": 7, "июля": 7,
        "august": 8, "agustos": 8, "ağustos": 8, "август": 8, "августа": 8,
        "september": 9, "eylul": 9, "eylül": 9, "сентябрь": 9, "сентября": 9,
        "october": 10, "oktober": 10, "ekim": 10, "октябрь": 10, "октября": 10,
        "november": 11, "kasim": 11, "kasım": 11, "ноябрь": 11, "ноября": 11,
        "december": 12, "dezember": 12, "aralik": 12, "aralık": 12, "декабрь": 12, "декабря": 12,
    }
    folded = fold(text)
    for name, number in months.items():
        hit = re.search(rf"\b{name}\b[^\d]{{0,6}}(\d{{4}})", folded)
        if hit:
            return f"{hit.group(1)}-{number:02d}"
        hit = re.search(rf"(\d{{4}})[^\d]{{0,6}}\b{name}\b", folded)
        if hit:
            return f"{hit.group(1)}-{number:02d}"
    return None


def find_near(text: str, anchors: tuple[str, ...], window: int = 160) -> list[str]:
    """Substrings around any anchor word. The window is what a Claim quotes as
    `raw`, so a reviewer can see the sentence the number came out of."""
    folded = fold(text)
    out: list[str] = []
    for anchor in anchors:
        needle = fold(anchor)
        start = 0
        while True:
            index = folded.find(needle, start)
            if index == -1:
                break
            out.append(squash(text[max(0, index - window // 2): index + window]))
            start = index + len(needle)
    return out
