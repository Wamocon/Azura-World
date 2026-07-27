"""German-language portal parsers: Alanya-Home, Housearch, Seaside Alanya.

One module for three hosts because they form one *evidence group*, not because
they share markup: these are the price observations behind F-002, where the 1+1
entry price disagrees 2.1x and one of the four sources quotes USD. Keeping them
together makes it obvious that nothing in here may normalise, convert, average or
prefer — the disagreement IS the deliverable, and build-azura-dataset.py is the
only thing allowed to reason about it.

Four traps this file exists to survive:

  * Seaside renders the same apartment table in two DOM orders — the German page
    puts the price column before the attribute column, the English page after —
    so the flattened .txt pairs every floor with the wrong reference. Rows are
    therefore cut out of the HTML, never out of the text.
  * Housearch localises every label but keeps a stable `data-test` / icon name on
    the element. Anchoring on those reads de, en, ru, fr, es and tr through one
    code path, with no table of translated field names.
  * Alanya-Home publishes this project twice — id 466 (German, "ab 220.000 €",
    85 m², last touched 2023-02-25) and id 891 (English, "from €125,000",
    80–300 m², last touched 2025-08-11). Both are parsed, both are reported, and
    the contradiction is left standing.
  * Three of the numbered Housearch captures are soft-404s: HTTP 200 bodies that
    advertise Dubai villas. CONVENTIONS §5 says validate the bytes, not the
    status line, so every capture is checked for the project's own name before a
    single Claim is built.
"""

from __future__ import annotations

import re
from html import unescape

from .base import (
    Capture,
    Claim,
    ParseResult,
    UnitObservation,
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
    "alanya-home-466",
    "alanya-home-891",
    "housearch",
    "housearch-units",
    "seaside-alanya",
    "seaside-alanya-units",
]
SOURCE_ID_PREFIXES = ["housearch-units-"]


# ------------------------------------------------------------------ helpers --

def _clean(fragment: str) -> str:
    """Markup fragment -> readable text.

    strip_tags() leaves entities alone, and Housearch writes every thousands
    separator as `&nbsp;`. Decoding before squash() is what turns `239.171&nbsp;$`
    into `239.171 $`; skipping it would leave the entity sitting inside the `raw`
    a reviewer has to read.
    """
    return squash(unescape(strip_tags(fragment)))


def _whole(value: float | None) -> float | int | None:
    """Counts, years and square metres are whole numbers on these pages.

    parse_amount always returns float; a total of 656.0 units or a founding year
    of 1982.0 would reach the generated dataset reading like a rounding artefact.
    Prices keep their float type — UnitObservation declares it.
    """
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


def _first(pattern: str, text: str, flags: int = re.I) -> re.Match[str] | None:
    return re.search(pattern, text, flags)


def _around(text: str, match: re.Match[str], before: int = 60, after: int = 90) -> str:
    """The words around a hit, for `raw`.

    A bare number is not evidence. Quoting the words either side of it is what
    lets a reviewer tell a parser misread from a publisher error without
    re-fetching the page. Both ends snap to a space so the quote never opens or
    closes mid-word, which would read like a truncation bug.
    """
    start = max(0, match.start() - before)
    end = min(len(text), match.end() + after)
    fragment = text[start:end]
    if start and " " in fragment:
        fragment = fragment[fragment.index(" ") + 1:]
    if end < len(text) and " " in fragment:
        fragment = fragment[: fragment.rindex(" ")]
    return squash(fragment)


def _add(
    result: ParseResult,
    field: str,
    value: object,
    raw: str,
    note: str | None = None,
    unit: str | None = None,
) -> None:
    """Append a Claim unless the page never stated it.

    A None value means "the page does not say", which CONTRACTS §1 spells
    `confidence: "gap"` — a decision only the builder may take. A placeholder
    Claim here would let a gap masquerade as an observation.

    The dedupe is on (field, value), not on field: these pages repeat their own
    figures in a sidebar and again in a body paragraph, and one page saying
    76,000 twice is one fact. A *different* value for the same field is kept on
    purpose — that is an intra-page contradiction, and the builder must see both.
    """
    if value is None or raw is None:
        return
    text = squash(raw)
    if not text:
        return
    for existing in result.claims:
        if existing.field == field and existing.value == value:
            return
    result.claims.append(Claim(field=field, value=value, raw=text, note=note, unit=unit))


def _note(result: ParseResult, label: str, fragment: str) -> None:
    """Park a stated figure that has no field in CONTRACTS §2.

    "more than 20 thousand m²", "2. Quartal 2024", "more than 30 years of
    experience" — each is real evidence that no dotted path accepts, and each
    would need a word-scale or quarter parser that base.py deliberately does not
    provide. Surfacing the sentence verbatim keeps it recoverable; turning
    "20 Tausend" into 20000 would not be parsing, it would be guessing.
    """
    text = squash(fragment)
    if not text:
        return
    entry = f"{label}: {text}"
    if entry not in result.unparsed:
        result.unparsed.append(entry)


# ------------------------------------------------------------- alanya-home --

# Both language variants live in one table because 466 is German-only and 891
# English-only: neither pattern can fire on the other's page.
_ALANYA_AREA_PATTERNS: tuple[tuple[str, str], ...] = (
    ("project.plotAreaSqm", r"GESAMTFL[ÄA]CHE\s*([\d.,\s]+m2)"),
    ("project.plotAreaSqm", r"Total land area:\s*([\d.,\s]+m²)"),
    ("project.greenAreaSqm", r"([\d.,]+\s*m2)\s*GESAMTE"),
    ("project.greenAreaSqm", r"Green area:\s*([\d.,\s]+m²)"),
    ("project.buildingFootprintSqm", r"([\d.,]+\s*m2)\s*GESAMTBAUFL"),
    ("project.buildingFootprintSqm", r"Building area:\s*([\d.,\s]+m²)"),
    ("project.outdoorFacilityAreaSqm", r"([\d.,]+\s*m2)\s*Freiluft"),
    ("project.outdoorFacilityAreaSqm", r"Infrastructure area:\s*([\d.,\s]+m²)"),
)

_ALANYA_DISTANCE_PATTERNS: tuple[tuple[str, str, str], ...] = (
    ("project.distanceToSeaM", r"ENTFERNUNG ZUM MEER\s*[-–—]\s*(\d[\d.,]*)\s*M\b", "m"),
    ("project.distanceToSeaM", r"only\s+(\d[\d.,]*)\s+meters from a private beach", "m"),
    ("project.distanceToAlanyaCentreKm",
     r"INNENSTADT VON ALANYA\s*[-–—]\s*(\d[\d.,]*)\s*KM", "km"),
    ("project.distanceToAlanyaCentreKm",
     r"Alanya city cent(?:er|re)\s*[-–—]\s*(\d[\d.,]*)\s*km", "km"),
    ("project.distanceToAntalyaAirportKm",
     r"FLUGHAFEN ANTALYA\s*[-–—]\s*(\d[\d.,]*)\s*KM", "km"),
    ("project.distanceToAntalyaAirportKm",
     r"Antalya Airport\s*[-–—]\s*(\d[\d.,]*)\s*km", "km"),
    ("project.distanceToGazipasaAirportKm",
     r"FLUGHAFEN GAZ[İI]PA[ŞS]A\s*[-–—]\s*(\d[\d.,]*)\s*KM", "km"),
    ("project.distanceToGazipasaAirportKm",
     r"Gazipa[şs]a Airport\s*[-–—]\s*(\d[\d.,]*)\s*km", "km"),
)

# The <ul class="list-overview"> sidebar and the body prose disagree about the
# distance to Alanya centre — 10 km against 15 km — on the very same page. Both
# are read and both are emitted.
_ALANYA_OVERVIEW_DISTANCE: tuple[tuple[str, str, str], ...] = (
    ("vom meer", "project.distanceToSeaM", "m"),
    ("from sea", "project.distanceToSeaM", "m"),
    ("von der mitte", "project.distanceToAlanyaCentreKm", "km"),
    ("from center", "project.distanceToAlanyaCentreKm", "km"),
)


def _alanya_overview(html: str) -> list[tuple[str, str]]:
    """Ordered (label, value) pairs from the overview list.

    Rendered twice per page (mobile block, then sidebar); the order is preserved
    and the caller's dedupe collapses the repeat.
    """
    pairs: list[tuple[str, str]] = []
    for block in re.findall(r'<ul class="list-overview">(.*?)</ul>', html, re.S):
        for item in re.findall(r"<li>(.*?)</li>", block, re.S):
            label = _first(r'list-overview-option"[^>]*>(.*?)</span>', item, re.S)
            if not label:
                continue
            value = _first(r'list-overview-value"[^>]*>(.*?)</span>\s*(?:</li>|$)', item, re.S)
            pairs.append((
                _clean(label.group(1)).rstrip(":"),
                _clean(value.group(1) if value else item),
            ))
    return pairs


def _parse_alanya_home(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = capture.text
    url = capture.final_url or capture.url

    developer = _first(r"Cebeci\s+Group(?:\s+A\.\s?Ş\.?)?", text)
    if developer:
        _add(result, "project.developer", squash(developer.group(0)),
             _around(text, developer, before=40, after=20))

    for field, pattern in _ALANYA_AREA_PATTERNS:
        match = _first(pattern, text)
        if match:
            _add(result, field, _whole(parse_area_m2(match.group(1))),
                 match.group(0), unit="m2")

    for field, pattern, unit in _ALANYA_DISTANCE_PATTERNS:
        match = _first(pattern, text)
        if match:
            _add(result, field, _whole(parse_amount(match.group(1))),
                 match.group(0), unit=unit)

    # "BAUBEGINN: 30.01.2022" and "BAUENDE: 30.05.2024" sit on consecutive lines;
    # each date is isolated before parse_iso_date, or the first one would win
    # both fields.
    for field, pattern in (
        ("project.constructionStart", r"BAUBEGINN:\s*([\d./-]+)"),
        ("project.completionDate", r"BAUENDE:\s*([\d./-]+)"),
    ):
        match = _first(pattern, text)
        if match:
            _add(result, field, parse_iso_date(match.group(1)), match.group(0))

    total = _first(r"(\d[\d.,]*)\s+spacious apartments", text)
    if total:
        _add(result, "project.totalUnits", _whole(parse_amount(total.group(1))),
             _around(text, total, before=30, after=30))

    observed_at: str | None = None
    size_cell = ""
    price_cell = ""
    for label, value in _alanya_overview(capture.html):
        folded = fold(label)
        if folded in ("aktualisiert", "updated"):
            observed_at = value
            _note(result, "listing last updated (no dataset field)", f"{label}: {value}")
        elif folded == "square":
            size_cell = value
        elif folded in ("preise ab", "prices from"):
            price_cell = value
        elif folded in ("rate ab, %", "rate ab %", "instalment from, %"):
            _add(result, "project.downPaymentPercent", _whole(parse_amount(value)),
                 f"{label}: {value}", unit="%")
        elif folded == "total floors":
            _add(result, "project.floorsPerBuilding", _whole(parse_amount(value)),
                 f"{label}: {value}",
                 note="listing overview; describes the block this listing sits in, "
                      "which need not be every block in the complex")
        elif folded in ("vom flughafen", "from airport"):
            # "60" with no unit and no airport named. Which of the two airport
            # fields it belongs to would be a guess, so it stays a note.
            _note(result, "airport distance stated without unit or airport name",
                  f"{label}: {value}")
        else:
            for needle, field, unit in _ALANYA_OVERVIEW_DISTANCE:
                if folded == needle:
                    _add(result, field, _whole(parse_amount(value)),
                         f"{label}: {value}", unit=unit,
                         note="overview sidebar value; the body prose on the same page "
                              "may state a different figure")

    if size_cell or price_cell:
        result.units.append(_alanya_unit(capture, url, size_cell, price_cell, observed_at))

    # The German page also says "auf einer Fläche von 76 m²" — a publisher typo
    # for 76,000 m². Correcting it here would quietly overwrite what the page
    # says; naming it leaves the evidence intact.
    typo = _first(r"auf einer Fläche von\s*[\d.,]+\s*m²[^.]*\.", text)
    if typo:
        _note(result, "publisher typo, left uncorrected", typo.group(0))

    experience = _first(r"\d+\-jährigen Erfahrung", text)
    if experience:
        _note(result, "developer experience in years, not a founding year",
              _around(text, experience, before=30, after=40))

    balconies = _first(r"large balconies[^.]*\.", text)
    if balconies:
        _note(result, "minimum balcony / living-room sizes (no dataset field)",
              balconies.group(0))

    return result


def _alanya_unit(
    capture: Capture,
    url: str,
    size_cell: str,
    price_cell: str,
    observed_at: str | None,
) -> UnitObservation:
    """The overview's entry price. The layout is None on purpose.

    Neither listing attaches its "from" price to a layout: 466 states 85 m² and
    €220,000, 891 states 80–300 m² and €125,000, and the layout mix (1+1 … 6+1)
    is prose elsewhere on the page. SOURCES.md reads both as the 1+1 entry, but
    that is an inference for the builder to make and record — baking it in here
    would make a portal look like it said something it never said.
    """
    note_parts = [
        "portal overview 'price from' row; the page does not attach this price to a layout"
    ]
    interior = None
    if size_cell:
        span = _first(r"([\d.,]+)\s*[-–—]\s*([\d.,]+)\s*(?:m2|m²)", size_cell)
        if span:
            # A range's low end is a stated minimum; its high end belongs to a
            # different apartment, so pairing that with the entry price would
            # manufacture a €125,000 / 300 m² unit nobody advertises.
            interior = parse_area_m2(f"{span.group(1)} m²")
            note_parts.append(f"page states a size range: {squash(size_cell)}")
        else:
            interior = parse_area_m2(size_cell)
    amount, currency = parse_money(price_cell) if price_cell else (None, None)
    if observed_at:
        note_parts.append(f"listing last updated {observed_at}")
    return UnitObservation(
        layout=None,
        interior_m2=interior,
        outdoor_m2=None,
        floor_level=None,
        price_amount=amount,
        price_currency=currency,
        url=url,
        raw=squash(f"{size_cell} | {price_cell}"),
        reference=None,
        price_kind=capture.price_kind,
        is_stale=capture.is_stale,
        note="; ".join(note_parts),
    )


# ---------------------------------------------------------------- housearch --

# Housearch localises the plan label but always leads with the bedroom count.
# Mapping that first token onto phrasing normalize_layout already understands
# ("1 bedroom") keeps layout normalisation in base.py where it belongs.
_HOUSEARCH_BEDROOMS: dict[str, int] = {
    "1": 1, "ein": 1, "one": 1, "une": 1, "un": 1,
    "2": 2, "zwei": 2, "two": 2, "deux": 2, "dos": 2,
    "3": 3, "drei": 3, "three": 3, "trois": 3, "tres": 3,
    "4": 4, "vier": 4, "four": 4, "quatre": 4, "cuatro": 4,
}

_HOUSEARCH_READY = ("fertig", "ready", "сдан", "pret", "terminado", "teslim edildi")

_HOUSEARCH_BUILDING = (
    r"befindet sich noch im Bau",
    r"is still under construction",
    r"ещё строится",
    r"еще строится",
    r"est encore en construction",
    r"aún está en construcción",
)


def _section(html: str, attribute: str, value: str) -> str:
    """Everything after an anchored section opens, up to the next anchored one.

    Housearch's class names are content-hashed per build; `data-anchor` and
    `data-test` are not. Slicing between anchors also sidesteps matching a
    closing tag, which a regex cannot do across nested divs.
    """
    start = _first(rf'{attribute}="{value}"', html)
    if not start:
        return ""
    # Skip the rest of the opening tag, or its stray `">` lands at the front of
    # every `raw` quoted out of this section.
    opened = html.find(">", start.end())
    tail = html[opened + 1:] if opened != -1 else html[start.end():]
    stop = _first(r'data-(?:anchor|test)="[^"]+"', tail)
    return tail[: stop.start()] if stop else tail


def _housearch_features(html: str) -> dict[str, tuple[str, str]]:
    """icon name -> (localised label, localised value) from the features table."""
    table = _first(r'data-test="CardFeatures">(.*?)</table>', html, re.S)
    if not table:
        return {}
    cells = re.findall(
        r'IconSvg_([a-z0-9-]+)-48[^>]*>.*?<div class="[^"]*">([^<]*)</div>'
        r'<div class="[^"]*">([^<]*)</div>',
        table.group(1),
        re.S,
    )
    return {icon: (_clean(label), _clean(value)) for icon, label, value in cells}


def _parse_housearch(capture: Capture) -> ParseResult:
    result = ParseResult()
    html = capture.html
    text = capture.text
    url = capture.final_url or capture.url

    plans = _first(r'data-test="SiteCardRoomsStats"(.*?)</h2>(.*?)<button', html, re.S)
    if plans:
        result.units.extend(_housearch_plans(capture, url, plans.group(2)))

    completion = _housearch_features(html).get("construction-year-outline")
    if completion:
        label, value = completion
        raw = f"{label}: {value}"
        if fold(value) in _HOUSEARCH_READY:
            _add(result, "project.buildStatus", "completed", raw)
        else:
            iso = parse_iso_date(value)
            if iso:
                _add(result, "project.completionDate", iso, raw)
            else:
                _note(result, "completion stated as a period, not a date", raw)

    # The card header says "ready" while the amenities copy on the same page says
    # the complex is still being built. That contradiction is F-006's evidence,
    # so both statements become Claims and neither is dropped.
    for pattern in _HOUSEARCH_BUILDING:
        match = _first(pattern, text)
        if match:
            _add(result, "project.buildStatus", "under_construction",
                 _around(text, match, before=25, after=25),
                 note="the same page's completion field reads 'ready'")
            break

    quarter = _first(r"(?:Quartal|quarter|квартал|trimestre|çeyre)", text)
    if quarter:
        _note(result, "completion stated as a quarter",
              _around(text, quarter, before=80, after=40))

    developers = _section(html, "data-test", "SiteCardDevelopers")
    name = _first(r"<div[^>]*>(Cebeci[^<]*)</div>", developers)
    if name:
        _add(result, "project.developer", _clean(name.group(1)), _clean(name.group(1)))

    bio = _first(r"<p>([^<]*Cebeci[^<]*)</p>", developers)
    if bio:
        sentence = _clean(bio.group(1))
        year = _first(r"\b(1[89]\d{2}|20\d{2})\b", sentence)
        if year:
            _add(result, "project.developerFoundedYear",
                 _whole(parse_amount(year.group(1))), _around(sentence, year, 40, 30))

    address = _first(r'data-test="address"[^>]*>([^<]+)<', html)
    if address:
        _add(result, "project.contact.address", _clean(address.group(1)),
             address.group(1),
             note="the project's own street address as printed on the listing card; "
                  "the corporate address in Housearch's footer is a different thing")

    location = _clean(_section(html, "data-anchor", "LOCATION")) or text
    centre = _first(r"(\d[\d.,]*)\s*(?:km|км)\b", location)
    if centre:
        _add(result, "project.distanceToAlanyaCentreKm",
             _whole(parse_amount(centre.group(1))),
             _around(location, centre, before=45, after=45), unit="km")

    drive = _first(r"[^.]*(?:Havaliman|Airport|аэропорт|aéroport|aeropuerto)[^.]*\.", location)
    if drive:
        _note(result, "airport reachability given as drive time, not distance", drive.group(0))

    green = _first(r"[^.]*(?:Tausend|thousand|тысяч|mille|mil)\s*m²[^.]*\.", text)
    if green:
        _note(result, "green area stated as a worded scale and as a lower bound",
              green.group(0))

    # This panel counts the DEVELOPER's portfolio on Housearch — three buildings,
    # matching the site's own "Property from Cebeci Group: 3 new buildings" link.
    # SOURCES.md F-001 reads it as Azura World's block count; the markup does not
    # support that, so no structural Claim is emitted and the string is surfaced
    # for the builder to re-judge.
    for label, value in re.findall(
        r'<div class="[^"]*">([^<]*)</div><div class="[^"]*">(\d[^<]*)</div>', developers
    ):
        _note(result, "developer-portfolio counter, not a figure about this project",
              f"{_clean(label)}: {_clean(value)}")

    span = _first(r"(\d[\d.,\s ]*[–—-]\s*[\d.,\s ]+)\s*(?:m²|м²)", text)
    if span:
        _note(result, "advertised size span for the whole complex", span.group(0))
    ladder = _first(r"([$€]\s*[\d.,\s ]+[–—-][\d.,\s ]+|[\d.,\s ]+[–—-][\d.,\s ]+\s*[$€])",
                    text)
    if ladder:
        _note(result, "advertised price span for the whole complex", ladder.group(0))

    return result


def _housearch_plans(capture: Capture, url: str, block: str) -> list[UnitObservation]:
    """One observation per advertised floor-plan group.

    Cells arrive as (label, price, area) triples. The price cell is recognised by
    its currency glyph rather than by position, because the Turkish page prints
    "$238.967 üzeri" while every other locale puts the amount last.
    """
    cells = [text for text in (_clean(cell)
                               for cell in re.findall(r">([^<>]{1,60})</div>", block)) if text]

    observations: list[UnitObservation] = []
    for index, cell in enumerate(cells):
        if not re.search(r"[$€£₺]", cell) or not re.search(r"\d", cell):
            continue
        label = cells[index - 1] if index else ""
        area_cell = cells[index + 1] if index + 1 < len(cells) else ""
        if not re.search(r"m²|м²|m2", area_cell):
            area_cell = ""

        bedrooms = _HOUSEARCH_BEDROOMS.get(fold(label).split(" ")[0] if label else "")
        amount, currency = parse_money(cell)
        observations.append(
            UnitObservation(
                layout=normalize_layout(f"{bedrooms} bedroom") if bedrooms else None,
                # Cyrillic "м²" is a different string from Latin "m²"; the unit
                # token is transliterated so parse_area_m2 still does the number.
                interior_m2=parse_area_m2(area_cell.replace("м²", "m²")),
                outdoor_m2=None,
                floor_level=None,
                price_amount=amount,
                price_currency=currency,
                url=url,
                raw=squash(" ".join(part for part in (label, cell, area_cell) if part)),
                reference=None,
                price_kind=capture.price_kind,
                is_stale=capture.is_stale,
                note="advertised entry price for this floor-plan group, not a specific unit",
            )
        )
    return observations


# ----------------------------------------------------------- seaside alanya --

_SEASIDE_ROW = re.compile(
    r'<div class="row[^"]*bg-light[^"]*"[^>]*min-height:\s*90px', re.I
)

_SEASIDE_PATTERNS: tuple[tuple[str, str, str | None], ...] = (
    ("project.residenceBlockCount", r"(\d+)\s*Blöcken", None),
    ("project.residenceBlockCount", r"(\d+)\s*blocks", None),
    ("project.totalUnits", r"(\d+)\s*Immobilien", None),
    ("project.totalUnits", r"(\d+)\s*properties", None),
    ("project.plotAreaSqm", r"Gesamtgrundstücksfläche:\s*([\d.,]+\s*m²)", "m2"),
    ("project.plotAreaSqm", r"Total land area:\s*([\d.,]+\s*m²)", "m2"),
    ("project.greenAreaSqm", r"Green Field \((?:Garten|Garden)\):\s*([\d.,]+\s*m²)", "m2"),
    ("project.distanceToSeaM", r"(\d[\d.,]*)\s*Meter vom Meer", "m"),
    ("project.distanceToSeaM", r"(\d[\d.,]*)\s*meters from the sea", "m"),
    ("project.distanceToAlanyaCentreKm", r"(\d[\d.,]*)\s*km\s+westlich von Alanya", "km"),
    ("project.distanceToAlanyaCentreKm", r"(\d[\d.,]*)\s*km\s+west part of Alanya", "km"),
    ("project.distanceToGazipasaAirportKm",
     r"(\d[\d.,]*)\s*km\s+vom Flughafen Gazipasa", "km"),
    ("project.distanceToGazipasaAirportKm",
     r"(\d[\d.,]*)\s*km\s+from Gazipasa Airport", "km"),
    ("project.distanceToAntalyaAirportKm",
     r"(\d[\d.,]*)\s*km\s+vom Flughafen Antalya", "km"),
    ("project.distanceToAntalyaAirportKm",
     r"(\d[\d.,]*)\s*km\s+from Antalya Airport", "km"),
)


def _parse_seaside(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = capture.text
    url = capture.final_url or capture.url

    for field, pattern, unit in _SEASIDE_PATTERNS:
        match = _first(pattern, text)
        if not match:
            continue
        value = parse_area_m2(match.group(1)) if unit == "m2" else parse_amount(match.group(1))
        _add(result, field, _whole(value), match.group(0), unit=unit)

    for field, pattern in (
        ("project.constructionStart", r"(?:Baubeginn|Construction start date):\s*([\d.]+)"),
        ("project.completionDate",
         r"(?:Liefertermin wird als|delivery date is determined as)\s*([\d.]+)"),
    ):
        match = _first(pattern, text)
        if match:
            _add(result, field, parse_iso_date(match.group(1)), match.group(0))

    # The English property-details table says 300 m; the description directly
    # above it says 200 m. Both are emitted — F-003 is the builder's to resolve.
    detail_sea = _first(r"Distance To The Sea \(M\)\s*([\d.,]+)\s*m\b", text)
    if detail_sea:
        _add(result, "project.distanceToSeaM", _whole(parse_amount(detail_sea.group(1))),
             detail_sea.group(0), unit="m",
             note="property-details table; the description on the same page states a "
                  "different distance")

    detail_land = _first(r"Land Area\s*([\d.,]+)", text)
    if detail_land:
        _add(result, "project.plotAreaSqm",
             _whole(parse_area_m2(f"{detail_land.group(1)} m²")),
             detail_land.group(0), unit="m2")

    result.units.extend(_seaside_rows(capture, url))

    updated = _first(r"Updated Date:\s*([\d./-]+)", text)
    if updated:
        _note(result, "listing last updated (no dataset field)", updated.group(0))

    experience = _first(r"(?:mehr als|more than)\s+\d+\s+(?:Jahren|years)", text)
    if experience:
        _note(result, "developer experience in years, not a founding year",
              _around(text, experience, before=20, after=45))

    for label, pattern in (
        ("advertised price span",
         r"(?:Preissreichweite|Price Range)\s*([\d.,\s]+[-–][\d.,\s]+\s*€)"),
        ("advertised size span",
         r"(?:Fläche|Area)\s*([\d.,]+\s*[-–]\s*[\d.,]+\s*m2)"),
    ):
        match = _first(pattern, text)
        if match:
            _note(result, label, match.group(0))

    return result


def _seaside_rows(capture: Capture, url: str) -> list[UnitObservation]:
    """Apartment table rows, cut from HTML because the .txt mis-orders them.

    German markup is (reference, layout, area, price) then (floor, facade,
    baths); English swaps the two columns, which in the flattened text puts every
    attribute block one row ahead of the reference it describes. Splitting on the
    row container makes the order irrelevant: everything a row states lives
    inside that row's own block.
    """
    html = capture.html
    boundaries = [match.start() for match in _SEASIDE_ROW.finditer(html)]
    observations: list[UnitObservation] = []

    for index, start in enumerate(boundaries):
        end = boundaries[index + 1] if index + 1 < len(boundaries) else len(html)
        # The last row runs on into the description; the page's own section
        # anchor is the cut.
        block = html[start:end].split("<a name=")[0]

        reference = _first(r">\s*(F-\d+)\s*<", block)
        layout_cell = _first(r'<div class="font-weight-bold">([^<]*)</div>', block)
        area_cell = _first(r"<div>\s*([\d.,\s]+)\s*m\s*<sup>\s*2\s*</sup>", block)
        price_cell = _first(r"bg-success[^>]*>\s*([^<]+?)\s*</div>", block)
        floor_cell = _first(r"floors\.svg[^>]*>[^<]*<strong>([^<]*)</strong>", block)

        if not any((reference, layout_cell, area_cell, price_cell)):
            continue

        amount, currency = parse_money(price_cell.group(1)) if price_cell else (None, None)
        # parse_floor keys off words it knows and "Stock" is not one of them, so
        # the cell's value is handed over under a label it does recognise. Ground
        # and garden floors resolve to 0; "Villentyp" resolves to nothing, which
        # is right — a villa has no floor level, and 0 would invent one.
        floor_text = squash(floor_cell.group(1)) if floor_cell else ""
        floor_level = parse_floor(f"floor {floor_text}") if floor_text else None
        note = None
        if floor_text and floor_level is None:
            note = f"floor cell reads {floor_text!r}, which is not a floor level"

        observations.append(
            UnitObservation(
                layout=normalize_layout(layout_cell.group(1)) if layout_cell else None,
                interior_m2=parse_area_m2(f"{area_cell.group(1)} m²") if area_cell else None,
                outdoor_m2=None,
                floor_level=floor_level,
                price_amount=amount,
                price_currency=currency,
                url=url,
                raw=_clean(block.replace("<sup>2</sup>", "²")),
                reference=squash(reference.group(1)) if reference else None,
                price_kind=capture.price_kind,
                is_stale=capture.is_stale,
                note=note,
            )
        )
    return observations


# ------------------------------------------------------------------ dispatch --

def parse(capture: Capture) -> ParseResult:
    """Route on source_id.

    Each branch is one publisher's markup; the builder wraps this call in its own
    try/except, so a redesign at one host costs that host's claims and nothing
    else.

    The identity check comes first and applies to every branch. Three of the
    numbered Housearch captures are HTTP 200 bodies reading "This page doesn't
    exist" over a carousel of Dubai villas — parsing one yields a confident
    `project.contact.address` of "Dubai, Dubailand" for a project in Alanya.
    CONVENTIONS §5 calls this out as the failure that shipped 51 bad files in the
    reference project: validate the bytes, not the status line.
    """
    if "azura world" not in fold(capture.text) and "azura world" not in fold(capture.html):
        empty = ParseResult()
        empty.unparsed.append(
            "snapshot never names Azura World; treated as a soft-404 or wrong-property "
            f"body and not parsed ({capture.final_url or capture.url})"
        )
        return empty

    source_id = capture.source_id
    if source_id.startswith("alanya-home"):
        return _parse_alanya_home(capture)
    if source_id == "housearch" or source_id.startswith("housearch-units"):
        return _parse_housearch(capture)
    if source_id.startswith("seaside-alanya"):
        return _parse_seaside(capture)
    return ParseResult()
