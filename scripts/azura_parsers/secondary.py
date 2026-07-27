"""Parsers for the Russian portals, the international portals and the press (W0-B).

Six hosts share one module because they share one shape: a single project page
(or, for altoprealestate, a single listing) whose facts sit in prose rather than
in a table. There is no markup to share — dispatch is on `capture.source_id` and
each handler is independent — but keeping them together means the low-yield
tier-6 hosts are read, reviewed and regression-tested as one surface.

What this module deliberately does NOT do, per base.py's contract:

  * it never ranks these sources against alanya-home or seaside;
  * it never converts a currency, and never assumes one;
  * it never repairs a figure it believes is wrong. enspride calls 41,000 m²
    "landscaped green areas" where the developer's own breakdown calls that the
    outdoor-facility area (F-008). The claim below says 41,000, because the
    conflict IS the finding — a parser that quietly wrote 20,000 would delete
    the evidence that anyone ever disagreed.

The one thing this module is opinionated about is `altoprealestate-rental`: it
is a monthly rent, and €2,100 landing in the sale-price series reads as an
impossibly cheap 1+1 and corrupts F-002.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .base import (
    Capture,
    Claim,
    ParseResult,
    UnitObservation,
    detect_currency,
    find_near,
    fold,
    normalize_layout,
    parse_amount,
    parse_area_m2,
    parse_floor,
    parse_iso_date,
    parse_money,
    squash,
    strip_tags,
)

HOST = "multi"
SOURCE_IDS = [
    "kalinka-realty",
    "cestate",
    "enspride",
    "turizmguncel",
    "terrarealestate",
    "altoprealestate-rental",
]


# ------------------------------------------------------------------ surface --

def _surface(capture: Capture) -> str:
    """The squashed page text, and why it is squashed before anything reads it.

    base.py's `find_near()` computes an index in the FOLDED string and then
    slices the ORIGINAL one. That only lines up while folding preserves length —
    which it does for every character on these pages — but whitespace collapsing
    does not: a "\\n\\n" paragraph break is two characters before folding and one
    after, so every raw quoted past the first blank line would drift. Squashing
    first removes the drift instead of working around it, and lets the patterns
    below be written without line-break alternatives.
    """
    return squash(capture.text or strip_tags(capture.html))


# ------------------------------------------------------------- value coders --

def _number(raw: str) -> float | int | None:
    """parse_amount, narrowed to int when the value is integral.

    300.0 and 300 are the same JSON number, but the generated TS literal is read
    by humans and diffed by reviewers, so `distanceToSeaM: 300` earns its two
    lines. Grouping and locale handling stay entirely in base.parse_amount.
    """
    value = parse_amount(raw)
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


def _area(raw: str) -> float | int | None:
    """Area in m², preferring base.parse_area_m2.

    parse_area_m2 keys off a unit token (m²/m2/qm/кв.м/metrekare). cestate writes
    "76,000 square meters" in English prose, which that vocabulary does not
    cover, so the fallback runs the same base number parser over the same
    substring rather than growing a second area parser in here.
    """
    value = parse_area_m2(raw)
    if value is None:
        value = parse_amount(raw)
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


# The only spelled-out numeral this group needs: cestate writes "seven
# residential blocks" where every other host writes "7". base.py parses digits,
# not English numerals, and dropping the phrase for want of a digit would lose
# cestate's independent corroboration of the block count (F-001).
_EN_NUMERALS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fourteen": 14,
}


def _numeral(raw: str) -> int | None:
    value = _number(raw)
    if isinstance(value, int):
        return value
    if value is not None:
        return None  # "3.5 blocks" is a misread, not a count
    return _EN_NUMERALS.get(fold(raw))


def _phrase(raw: str) -> str | None:
    """A stored string value, sliced out of the ORIGINAL text.

    Never fold() a value on its way into the dataset: fold maps Turkish 'İ' to
    'i' and leaves 'ı' as 'ı', which is right for matching and wrong for anything
    a reader sees. Empty becomes None so an over-permissive pattern cannot emit a
    Claim with no value.
    """
    return squash(raw) or None


Coder = Callable[[str], Any]


def _emit(
    result: ParseResult,
    field: str,
    text: str,
    pattern: re.Pattern[str],
    coder: Coder = _number,
    *,
    note: str | None = None,
    unit: str | None = None,
) -> None:
    """One Claim per distinct value, `raw` = the whole match.

    Deduplication is on the VALUE, not on the match: these pages repeat their
    navigation and their headline figures two or three times, and three identical
    claims would read as corroboration to anyone looking at the evidence cockpit.
    Two *different* values for one field both survive — cestate and TERRA each
    state two different beach distances on one page, and dropping either would be
    resolving a disagreement, which is the builder's job and not this module's.
    """
    seen: set[Any] = set()
    for match in pattern.finditer(text):
        raw = squash(match.group(0))
        source = match.group("v") if "v" in pattern.groupindex else raw
        value = coder(source)
        if value is None:
            result.unparsed.append(f"{field}: value not parseable from {raw!r}")
            continue
        if value in seen:
            continue
        seen.add(value)
        result.claims.append(Claim(field=field, value=value, raw=raw, note=note, unit=unit))


def _context(result: ParseResult, text: str, anchor: str, window: int = 200) -> None:
    """Park a narrative passage in `unparsed` — surfaced, never dropped."""
    for hit in find_near(text, (anchor,), window=window):
        if hit and hit not in result.unparsed:
            result.unparsed.append(hit)


def _rejected(result: ParseResult, text: str, anchor: str, reason: str, window: int = 160) -> None:
    """Record something the parser saw and deliberately did NOT claim.

    A silent non-claim is indistinguishable from a missed one. Writing the reason
    next to the passage is what lets a reviewer confirm the omission was a
    decision — "Since 2004" is the estate agent's founding year, not the
    developer's, and it sits one careless anchor away from
    project.developerFoundedYear.
    """
    for hit in find_near(text, (anchor,), window=window):
        line = f"not claimed ({reason}): {hit}"
        if hit and line not in result.unparsed:
            result.unparsed.append(line)


# ------------------------------------------------------------ kalinka-realty --

# "just 300 m. to the sea" — machine-translated Russian, hence the loose tail.
_KAL_SEA = re.compile(r"(?P<v>\d[\d.,\s]*)\s*m\.?\s*to the sea", re.I)
_KAL_PLOT = re.compile(r"covers\s+(?P<v>\d[\d.,\s]*\s*m2?²?)", re.I)
_KAL_COMPLETION = re.compile(r"Construction completion date:\s*(?P<v>[\d./-]{8,10})", re.I)
_KAL_STARS = re.compile(r"(?P<v>\d)\s*-?\s*star hotel", re.I)
# "starting from 184,91 thsd USD": the figure is expressed in THOUSANDS. base.py
# has no scale-word handling and neither does this parser — multiplying by 1000
# here would be exactly the 1000x-error-that-still-looks-like-a-price that
# parse_amount's docstring exists to prevent. Surfaced verbatim, priced by nobody.
_KAL_SCALED = re.compile(r"starting from\s*[$€₺£]?\s*\d[\d.,\s]*\s*thsd", re.I)


def _parse_kalinka(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    _emit(result, "project.distanceToSeaM", text, _KAL_SEA, unit="m")
    _emit(result, "project.plotAreaSqm", text, _KAL_PLOT, _area, unit="m²")
    _emit(result, "project.completionDate", text, _KAL_COMPLETION, parse_iso_date)
    _emit(result, "hotel.stars", text, _KAL_STARS, _numeral)

    for match in _KAL_SCALED.finditer(text):
        line = (
            "not claimed (entry price stated in thousands; base.py has no scale-word "
            f"handling and this parser will not multiply a source's number): "
            f"{squash(match.group(0))!r}"
        )
        if line not in result.unparsed:
            result.unparsed.append(line)

    # The page publishes no per-unit inventory at all — it says so in as many
    # words. That is a state of the source, not a parser failure, and recording
    # it lets the builder tell "no units offered" from "parser found no units".
    _context(result, text, "We are updating the data on the available lots", window=100)
    _rejected(
        result, text, "starting from 75 before 366",
        "a size range for the whole complex, not one unit", window=60,
    )
    return result


# ------------------------------------------------------------------- cestate --

_CE_BLOCKS = re.compile(r"(?P<v>[A-Za-z]+|\d+)\s+residential blocks", re.I)
_CE_UNITS = re.compile(r"(?P<v>\d[\d.,\s]*)\s+apartments\b", re.I)
_CE_PLOT = re.compile(r"covers an area of\s+(?P<v>\d[\d.,\s]*\s*square meters)", re.I)
_CE_CENTRE = re.compile(r"(?P<v>\d[\d.,\s]*)\s*kilometers? from Alanya", re.I)
_CE_SEA_HEAD = re.compile(r"(?P<v>\d[\d.,\s]*)\s*metres? to private beach", re.I)
_CE_SEA_BODY = re.compile(r"(?P<v>\d[\d.,\s]*)\s*meters? from the private beach", re.I)
_CE_COMPLETION = re.compile(r"will be completed in\s+(?P<v>[A-Za-z]+\s+\d{4})", re.I)
_CE_STARS = re.compile(r"(?P<v>\d)\s*\*\s*A La Carte hotel", re.I)
_CE_READINESS = re.compile(r"Readiness\s+(?P<v>\d{1,3})\s*%", re.I)
# Type / Area / Cost is one card of the "LAYOUTS AND PRICES" grid. Anchoring the
# cost group on a currency token is what stops a row running into the next card.
_CE_ROW = re.compile(
    r"Type:\s*(?P<layout>.{1,24}?)\s*"
    r"Area:\s*(?P<area>\d[\d.,\s]*\s*m²)\s*"
    r"Cost:\s*(?P<cost>\d[\d.,\s]*\s*(?:EUR|USD|TRY|GBP|€|\$|₺|£))",
    re.I,
)

_BOTH_BEACH_FIGURES = "page states two different distances to the beach; both are reported"


def _parse_cestate(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    _emit(result, "project.residenceBlockCount", text, _CE_BLOCKS, _numeral)
    _emit(result, "project.totalUnits", text, _CE_UNITS, _numeral)
    _emit(result, "project.plotAreaSqm", text, _CE_PLOT, _area, unit="m²")
    _emit(result, "project.distanceToAlanyaCentreKm", text, _CE_CENTRE, unit="km")
    _emit(result, "project.distanceToSeaM", text, _CE_SEA_HEAD, unit="m", note=_BOTH_BEACH_FIGURES)
    _emit(result, "project.distanceToSeaM", text, _CE_SEA_BODY, unit="m", note=_BOTH_BEACH_FIGURES)
    _emit(result, "project.completionDate", text, _CE_COMPLETION, parse_iso_date)
    _emit(result, "hotel.stars", text, _CE_STARS, _numeral)

    # "Readiness 90%" is this listing's own status widget on a page fetched in
    # 2026, so it is reported as a status claim in the frozen vocabulary. The
    # percentage has no field of its own; it stays in `raw` and in the note.
    # Whether it outranks the confirmed 2024 completion (F-006) is the builder's
    # call — this parser only reports that the page still says 90%.
    for match in _CE_READINESS.finditer(text):
        result.claims.append(
            Claim(
                field="project.buildStatus",
                value="under_construction",
                raw=squash(match.group(0)),
                note=(
                    "page's status widget shows a readiness percentage below 100; mapped to "
                    "the frozen buildStatus vocabulary, percentage kept verbatim in raw"
                ),
            )
        )
        break  # the widget renders once; later hits would be the same widget

    for match in _CE_ROW.finditer(text):
        amount, currency = parse_money(match.group("cost"))
        layout = normalize_layout(match.group("layout"))
        result.units.append(
            UnitObservation(
                layout=layout,
                interior_m2=parse_area_m2(match.group("area")),
                outdoor_m2=None,
                floor_level=None,
                price_amount=amount,
                price_currency=currency,
                # No per-unit permalinks exist: the grid renders inline on the
                # project page, so every row cites the page it was read from.
                url=capture.final_url,
                raw=squash(match.group(0)),
                price_kind=capture.price_kind,
                is_stale=capture.is_stale,
                note=(
                    None
                    if layout
                    else f"page states the layout as {squash(match.group('layout'))!r}, "
                    "which is outside the frozen UnitLayout union"
                ),
            )
        )

    _rejected(
        result, text, "with an area from 72",
        "a size range across all layouts, not one unit", window=100,
    )
    return result


# ------------------------------------------------------------------ enspride --

_ENS_PLOT = re.compile(r"(?:Built over|Land Area:)\s*(?P<v>\d[\d.,\s]*\s*m²)", re.I)
_ENS_GREEN = re.compile(r"Over\s+(?P<v>\d[\d.,\s]*\s*m²)\s+of landscaped green areas", re.I)
_ENS_UNITS = re.compile(r"(?P<v>\d[\d.,\s]*)\s+apartments in \d+ residence blocks", re.I)
_ENS_BLOCKS = re.compile(r"\d[\d.,\s]*\s+apartments in (?P<v>\d+) residence blocks", re.I)
_ENS_SEA = re.compile(r"(?P<v>\d[\d.,\s]*)\s*meters? from its own private beach", re.I)
_ENS_STARS = re.compile(r"a\s+(?P<v>\d)\s*-\s*star Hotel", re.I)
_ENS_DATES = re.compile(r"(?:Construction Start|Completion Date):\s*[^–\-]{4,24}?\d{4}", re.I)


def _parse_enspride(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    _emit(result, "project.plotAreaSqm", text, _ENS_PLOT, _area, unit="m²")
    _emit(result, "project.totalUnits", text, _ENS_UNITS, _numeral)
    _emit(result, "project.residenceBlockCount", text, _ENS_BLOCKS, _numeral)
    _emit(result, "project.distanceToSeaM", text, _ENS_SEA, unit="m")
    _emit(result, "hotel.stars", text, _ENS_STARS, _numeral)

    # F-008 lives here. The page attributes 41,000 m² to green space; the note
    # records the page's own attribution and nothing else. No adjustment, no
    # cross-reference to the other hosts, no hint about who is right.
    _emit(
        result,
        "project.greenAreaSqm",
        text,
        _ENS_GREEN,
        _area,
        unit="m²",
        note="page attributes this figure to landscaped green areas",
    )

    # "January 30, 2022" / "May 30, 2024": base.parse_iso_date reads ISO,
    # D.M.YYYY and month+year, but not "Month D, YYYY". Rather than grow a second
    # date parser inside a per-host module — the drift base.py's docstring warns
    # about — the literal line is surfaced and the gap reported. Reducing it to
    # "2022-01" would silently discard a day the source does state, and inventing
    # "2022-01-30" here would put date parsing in two places at once.
    for match in _ENS_DATES.finditer(text):
        raw = squash(match.group(0))
        parsed = parse_iso_date(raw)
        if parsed is None:
            line = (
                "not claimed (base.parse_iso_date does not read the 'Month D, YYYY' form; "
                f"extending it belongs in base.py, not here): {raw!r}"
            )
            if line not in result.unparsed:
                result.unparsed.append(line)
            continue
        field = (
            "project.constructionStart"
            if "construction" in fold(raw)
            else "project.completionDate"
        )
        result.claims.append(Claim(field=field, value=parsed, raw=raw))

    # Rejected on purpose, and recorded so the rejection is reviewable: a yield
    # forecast and a payment term are one careless regex apart, and "30%" would
    # look entirely plausible sitting in project.downPaymentPercent.
    _rejected(
        result, text, "value increase expected",
        "a marketing yield forecast, not project.downPaymentPercent", window=120,
    )
    _rejected(
        result, text, "Year Built",
        "an overview-widget year, not a dated completion statement", window=60,
    )
    return result


# -------------------------------------------------------------- turizmguncel --

# Matching runs against explicit character classes that accept both the dotted
# and the dotless Turkish forms, and every stored value is sliced out of the
# ORIGINAL text, so "İnşaat" reaches the dataset as "İnşaat". base.fold() is used
# below only to locate a passage, never to build a value.
_TG_DEVELOPER = re.compile(
    r"(?P<v>Cebeci\s+[İIıi]n[şsŞS]aat)[^.]{0,240}?"
    r"Wyndham\s+Grubu\s+ile\s+lisans\s+s[öoÖO]zle[şsŞS]mesi\s+imzalad[ıiİI]\."
)
# The clause on either side is kept in `raw` because the brand name alone is not
# evidence of anything — what F-007 turns on is the word "lisans" next to it.
# "&(?:amp;)?" is there because base.strip_tags does not unescape entities: when
# the .txt rendering is missing and the HTML is the only surface, this sentence
# arrives as "Wyndham Hotels &amp; Resorts".
_TG_BRAND = re.compile(r"[^.]{0,110}(?P<v>Wyndham\s+Hotels\s*&(?:amp;)?\s*Resorts)[^.]{0,110}")
_TG_STARS = re.compile(
    r"(?P<v>\d)\s*y[ıiİI]ld[ıiİI]zl[ıiİI]\s+Azura\s+World\s+Residence\s*&(?:amp;)?\s*Hotel", re.I
)
_TG_PUBLISHED = re.compile(r"\b\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]{3,9}\s+20\d{2}\b")


def _parse_turizmguncel(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    published = ""
    stamp = _TG_PUBLISHED.search(text)
    if stamp:
        published = squash(stamp.group(0))
    dated = parse_iso_date(published) if published else None

    _emit(
        result,
        "project.developer",
        text,
        _TG_DEVELOPER,
        _phrase,
        note="named as the signatory of the Wyndham licence agreement for the hotel component",
    )
    _emit(result, "hotel.stars", text, _TG_STARS, _numeral)

    # What this article establishes for F-007 is a LICENCE, in the present tense,
    # in March 2023 — not a hotel name and not today's affiliation. The value is
    # the brand the page names in full; the note carries the nature and the date
    # of the relationship so the builder can weigh a 2023 announcement against a
    # 2026 booking-site listing without reopening the article.
    _emit(
        result,
        "hotel.brandAffiliation",
        text,
        _TG_BRAND,
        _phrase,
        note=(
            "licence agreement signed by Cebeci İnşaat for the hotel part of Azura World "
            "Residence & Hotel; the article presents it as the first Wyndham licence in Alanya"
            + (f"; article published {published}" if published else "")
            + (f" ({dated})" if dated else "")
        ),
    )

    # hotel.formerName is deliberately NOT emitted. This article predates the
    # opening and names Wyndham as the INCOMING brand; it never states a former
    # name. The "ex. Wyndham Alanya" wording F-007 also rests on belongs to Agoda
    # and OnTheBeach, and manufacturing it here would fabricate the very
    # corroboration the finding exists to test.

    # Narrative context for the finding. Anchors are as specific as the article
    # allows: the page also carries three unrelated news teasers, and a loose
    # anchor such as "Yönetim Kurulu Başkanı" matches one of those too.
    _context(result, text, "Ahmet Cebeci Wyndham markasını", window=120)
    _context(result, text, "inşaat aşaması devam eden", window=300)
    _context(result, text, "Cebeci İnşaat Yönetim Kurulu Başkanı", window=400)
    _context(result, text, "Wyndham Group mimarları", window=130)
    return result


# ----------------------------------------------------------- terrarealestate --

_TR_PLOT = re.compile(r"Built on\s+(?P<v>\d[\d.,\s]*\s*m²)", re.I)
_TR_GREEN = re.compile(r"(?P<v>\d[\d.,\s]*\s*m²)\s+total green area", re.I)
_TR_FOOTPRINT = re.compile(r"(?P<v>\d[\d.,\s]*\s*m²)\s+total building area", re.I)
_TR_FACILITY = re.compile(r"(?P<v>\d[\d.,\s]*\s*m²)\s+total facility area", re.I)
_TR_SEA_BODY = re.compile(r"private beach\s+(?P<v>\d[\d.,\s]*)\s*meters? away", re.I)
_TR_SEA_LIST = re.compile(r"The Beach:\s*(?P<v>\d[\d.,\s]*)\s*m\b", re.I)
_TR_CENTRE = re.compile(r"Alanya Town Cent(?:er|re):\s*(?P<v>\d[\d.,\s]*)\s*km", re.I)
_TR_GZP = re.compile(r"(?:Alanya[\s\-–]*)?Gazipa[şs]a Airport:\s*(?P<v>\d[\d.,\s]*)\s*km", re.I)
_TR_AYT = re.compile(r"Antalya International Airport:\s*(?P<v>\d[\d.,\s]*)\s*km", re.I)
_TR_STARS = re.compile(r"a\s+(?P<v>\d)\s*-\s*star hotel", re.I)
_TR_CARD_URL = re.compile(r'ui-property-card__stretched-link" href="(?P<v>[^"]+)"')
_TR_CARD_PRICE = re.compile(r'ui-property-card-price__value">(?P<v>[^<]+)</strong>')
_TR_CARD_SIZE = re.compile(r'fa fa-crop"[^>]*></i>\s*(?P<v>[^<]*?)\s*</span>')
_TR_CARD_ID = re.compile(r"/property/(?P<v>\d+)-")


def _parse_terrarealestate(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    _emit(result, "project.plotAreaSqm", text, _TR_PLOT, _area, unit="m²")
    _emit(result, "project.greenAreaSqm", text, _TR_GREEN, _area, unit="m²")
    _emit(result, "project.buildingFootprintSqm", text, _TR_FOOTPRINT, _area, unit="m²")
    _emit(result, "project.outdoorFacilityAreaSqm", text, _TR_FACILITY, _area, unit="m²")
    _emit(result, "project.distanceToSeaM", text, _TR_SEA_BODY, unit="m", note=_BOTH_BEACH_FIGURES)
    _emit(result, "project.distanceToSeaM", text, _TR_SEA_LIST, unit="m", note=_BOTH_BEACH_FIGURES)
    _emit(result, "project.distanceToAlanyaCentreKm", text, _TR_CENTRE, unit="km")
    _emit(result, "project.distanceToGazipasaAirportKm", text, _TR_GZP, unit="km")
    _emit(result, "project.distanceToAntalyaAirportKm", text, _TR_AYT, unit="km")
    _emit(result, "hotel.stars", text, _TR_STARS, _numeral)

    # Each "Related Properties" card is one listing with its own permalink and a
    # FROM price covering a size range, so it is a price sighting rather than a
    # unit. Splitting on the card container first is what keeps one card's price
    # from pairing with the next card's link.
    for chunk in re.split(r"project-property-card__body", capture.html)[1:]:
        card = chunk.split("project-property-card__footer", 1)[0]
        # The project page currently carries only Azura cards; this guard is here
        # so an unrelated cross-sell added later cannot be priced as Azura.
        if "azura" not in fold(card):
            continue
        url = _TR_CARD_URL.search(card)
        price = _TR_CARD_PRICE.search(card)
        if not (url and price):
            continue
        size = _TR_CARD_SIZE.search(card)
        identifier = _TR_CARD_ID.search(url.group("v"))
        amount, currency = parse_money(price.group("v"))
        # `raw` is quoted back to a human, so it comes from the RENDERED text
        # rather than from strip_tags(card): the markup slice would carry "&gt;"
        # and a dangling attribute tail, which reads as a parser bug in the
        # evidence cockpit. The price string is unique per card, so anchoring on
        # it cannot pick up the neighbouring card.
        quoted = squash(price.group("v"))
        around = find_near(text, (quoted,), window=300)
        result.units.append(
            UnitObservation(
                layout=None,
                # A range is not a measurement: "81 m2 - 349 m2" describes the
                # listing's span, so interior_m2 stays null and the span survives
                # verbatim in `raw` and in the note.
                interior_m2=None,
                outdoor_m2=None,
                floor_level=None,
                price_amount=amount,
                price_currency=currency,
                url=squash(url.group("v")),
                raw=around[0] if around else quoted,
                reference=identifier.group("v") if identifier else None,
                price_kind=capture.price_kind,
                is_stale=capture.is_stale,
                note=(
                    '"From" price for a project listing card, not a single unit'
                    + (f'; card states the size range {squash(size.group("v"))}' if size else "")
                ),
            )
        )

    _rejected(
        result, text, "Since 2004",
        "TERRA's own founding year, not project.developerFoundedYear", window=90,
    )
    _rejected(
        result, text, "1 bedroom apartments are",
        "per-layout size ranges, not single units", window=260,
    )
    return result


# ---------------------------------------------------- altoprealestate-rental --

_AL_SEA = re.compile(r"(?P<v>\d[\d.,\s]*)\s*meters? from the Mediterranean Sea", re.I)
_AL_AYT = re.compile(r"To the airport ANTALYA:\s*(?P<v>\d[\d.,\s]*)\s*km", re.I)
_AL_GZP = re.compile(r"To the airport GAZIPASHA:\s*(?P<v>\d[\d.,\s]*)\s*km", re.I)
_AL_STARS = re.compile(r"(?P<v>\d)\s*-\s*star hotel", re.I)
_AL_FACTS = re.compile(
    r"Rooms:\s*(?P<layout>\S{1,12})\s*"
    r"Area:\s*(?P<area>\d[\d.,\s]*\s*m²)\s*"
    r"(?:Floor:\s*(?P<floor>\d{1,3})\s*)?",
    re.I,
)
_AL_REFERENCE = re.compile(r"\bID:\s*(?P<v>\d{3,10})")
_AL_PRICE = re.compile(
    r'class="price"\s+data-base-price="(?P<amount>[\d.]+)"'
    r'\s+data-base-currency="(?P<currency>[A-Za-z]{3})"'
)


def _parse_altop_rental(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _surface(capture)

    # Everything below "Similar objects" belongs to OTHER listings — and the
    # first of them ("GRAND EXCLUSIVE") is also priced 2 100, is also in Alanya,
    # and carries its own "To the sea: 500 m". Reading this page unscoped would
    # silently attribute another building's figures to Azura World.
    cut = fold(text).find(fold("Similar objects"))
    scoped = text[:cut] if cut != -1 else text

    _emit(result, "project.distanceToSeaM", scoped, _AL_SEA, unit="m")
    _emit(result, "project.distanceToAntalyaAirportKm", scoped, _AL_AYT, unit="km")
    _emit(result, "project.distanceToGazipasaAirportKm", scoped, _AL_GZP, unit="km")
    _emit(result, "hotel.stars", scoped, _AL_STARS, _numeral)

    # THE rule for this host. A monthly rent inside the sale series shows up as a
    # €2,100 apartment and destroys the F-002 price spread. The manifest says
    # "rent" and the page is titled "Apartment for rent"; if those ever diverge
    # the page wins, loudly, because the failure is silent in the other direction.
    price_kind = capture.price_kind
    if price_kind != "rent":
        result.unparsed.append(
            f"altoprealestate-rental: capture.price_kind is {price_kind!r} but this page is a "
            "monthly rental listing; forcing price_kind='rent' so it cannot enter the sale series"
        )
        price_kind = "rent"

    facts = _AL_FACTS.search(scoped)
    reference = _AL_REFERENCE.search(scoped)

    # The rendered figure is "2 100" beside a currency SWITCHER, so the glyph next
    # to the number is a control and not the listing's currency — detect_currency
    # over the visible strip would read whichever button renders first. The markup
    # states the base currency outright, and base.detect_currency turns that
    # attribute into the frozen token instead of this module upper-casing it.
    price_amount: float | None = None
    price_currency = None
    price_note = ""
    anchor = capture.html.find("property__price-block")
    price = _AL_PRICE.search(capture.html[anchor: anchor + 1200]) if anchor != -1 else None
    if price:
        price_amount = parse_amount(price.group("amount"))
        price_currency = detect_currency(price.group("currency"))
        price_note = (
            "; currency read from the listing markup "
            f'data-base-price="{price.group("amount")}" '
            f'data-base-currency="{price.group("currency")}" — the on-page figure sits next to '
            "a currency switcher and carries no glyph of its own"
        )
    else:
        result.unparsed.append(
            "altoprealestate-rental: no priced element found inside property__price-block"
        )

    if facts or price:
        result.units.append(
            UnitObservation(
                layout=normalize_layout(facts.group("layout")) if facts else None,
                interior_m2=parse_area_m2(facts.group("area")) if facts else None,
                outdoor_m2=None,
                floor_level=parse_floor(facts.group(0)) if facts else None,
                price_amount=price_amount,
                price_currency=price_currency,
                url=capture.final_url,
                raw=squash(facts.group(0)) if facts else squash(price.group(0)),
                reference=reference.group("v") if reference else None,
                price_kind=price_kind,
                is_stale=capture.is_stale,
                note="monthly rent for one furnished apartment in Azura World" + price_note,
            )
        )

    # The rendered price strip, kept verbatim: it is the only place the page puts
    # the figure next to its switcher, and a reviewer checking the rent should not
    # have to reopen the HTML to see what the parser was looking at.
    _context(result, scoped, "Photos inside", window=200)
    return result


# ------------------------------------------------------------------ dispatch --

_HANDLERS: dict[str, Callable[[Capture], ParseResult]] = {
    "kalinka-realty": _parse_kalinka,
    "cestate": _parse_cestate,
    "enspride": _parse_enspride,
    "turizmguncel": _parse_turizmguncel,
    "terrarealestate": _parse_terrarealestate,
    "altoprealestate-rental": _parse_altop_rental,
}


def parse(capture: Capture) -> ParseResult:
    handler = _HANDLERS.get(capture.source_id)
    if handler is None:
        # An unknown source_id means the manifest and the parser registry have
        # drifted apart. Returning an empty ParseResult would hide that as "this
        # page had nothing on it", so the mismatch is reported instead.
        return ParseResult(
            unparsed=[f"secondary.py: no handler registered for source_id {capture.source_id!r}"]
        )
    return handler(capture)
