"""Haspo Realty (hasporealty.com) — the only portal publishing per-unit detail pages.

Haspo matters out of proportion to its tier. It is the only source in the harvest
that exposes individual listings with their own price, area and floor, so the
whole low end of the F-002 price range is read off this host. It is also the
source SOURCES.md F-006 marks stale: the complex page still describes the build
in the future tense ("will be completed in May 2024") although completion is
confirmed for 2024-05-30 and the capture ran 2026-07-27. Both facts are true at
once, which is why every observation here travels with `is_stale` and nothing is
dropped for looking wrong.

Two page shapes, one host:

  * complex pages (`hasporealty` de, `hasporealty-units` en) — project stats,
    distances, developer, plus an 18-card listing grid;
  * unit detail pages (`hasporealty-units-01` … `-18`) — one labelled attribute
    block each, which is where the real per-unit evidence lives.

Markup is read from `capture.html` where the page carries structure the flattened
text destroys — the sale/rent class on a listing card is invisible in the text and
is the difference between a €1,000 rental and a €1,000 apartment — and falls back
to the text rendering when the HTML shape is gone.

This module reports; it never resolves. Implausible areas, rent prices and
listings tagged to the wrong district are all emitted with a `note`, because
which of them survives into the dataset is the builder's decision, not ours.
"""

from __future__ import annotations

import re

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

HOST = "hasporealty.com"
SOURCE_IDS = ["hasporealty", "hasporealty-units"]
SOURCE_ID_PREFIXES = ["hasporealty-units-"]

# Sanity floors used ONLY to attach a note. Neither one ever suppresses a value:
# W0-B's job is to report what the page says, and "this looks wrong" is an
# annotation, not a filter. The builder and the validator decide what to reject.
_IMPLAUSIBLE_AREA_M2 = 20.0
_IMPLAUSIBLE_SALE_PRICE = 20_000.0

# The district Azura World is actually in (CONTRACTS.md §2 pins it as a literal).
_EXPECTED_DISTRICT = "turkler"


# ------------------------------------------------------------------ markup --

def _page_text(capture: Capture) -> str:
    """Prefer the harvester's text rendering; fall back to stripping the HTML.

    The .txt files keep one value per line, which is what makes the detail-page
    attribute block readable at all. Falling back matters only if a future
    harvest stops writing them.
    """
    return capture.text if squash(capture.text) else strip_tags(capture.html)


def _flatten(fragment: str) -> str:
    """Strip tags, but kill <sup> first.

    Haspo renders areas as `183 m<sup>2</sup>`. Stripping tags naively yields
    "183 m 2", and base.parse_area_m2 wants "183 m2" — a silent None where a real
    number exists is exactly the failure mode this pipeline is built to avoid.
    """
    return strip_tags(re.sub(r"(?i)</?sup>", "", fragment or ""))


def _latinise_m(value: str) -> str:
    """Cyrillic 'м' -> Latin 'm' so base.parse_area_m2 can see the unit.

    Haspo's listing cards are Russian-authored markup: the area unit is U+043C
    CYRILLIC SMALL LETTER EM, not U+006D. base.fold() strips diacritics but does
    not transliterate scripts (correctly — it must not mangle Turkish), so the
    substitution belongs here, in the module that knows this publisher's markup.
    """
    return (value or "").replace("м", "m").replace("М", "M")


def _englishise_floor(value: str) -> str:
    """German 'Boden'/'Böden' -> 'floor' so base.parse_floor recognises it.

    The de complex page labels a card's storey "4 Boden"; the en page says
    "4 floor". base.parse_floor knows floor/etage/geschoss/kat/этаж but not
    Boden, which is Haspo's own (non-standard) German. Host-specific wording,
    handled in the host parser.
    """
    return re.sub(r"(?i)b[oö]den", "floor", value or "")


def _area(raw: str) -> float | None:
    return parse_area_m2(_latinise_m(raw))


def _floor(raw: str) -> int | None:
    return parse_floor(_englishise_floor(raw))


def _chunks(html: str, marker: str, tail: int) -> list[str]:
    """Split `html` on every occurrence of `marker`, one chunk per occurrence.

    Each chunk runs to the next marker so sibling blocks cannot bleed into one
    another; the last is capped at `tail`. Cheaper and far more predictable than
    trying to balance </div> with a regex, which is not a thing regexes do. The
    last chunk may over-reach, which is harmless because every field below takes
    the FIRST match inside its chunk and the card's own values come first.
    """
    starts = [m.start() for m in re.finditer(re.escape(marker), html or "")]
    out: list[str] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else start + tail
        out.append(html[start:end])
    return out


def _first(pattern: str, text: str) -> str:
    match = re.search(pattern, text or "", re.S | re.I)
    return squash(match.group(1)) if match else ""


# ------------------------------------------------------- complex-page stats --

# The three tiles Haspo prints above the description, in de and en. Matched on
# the LABEL because the value's wording changes with locale ("6 floors" /
# "6-Böden") while the label is what identifies the field.
_STAT_LABELS = (
    "number of buildings", "anzahl der gebaude",
    "number of floors of the building", "anzahl der stockwerke des gebaudes",
    "year built", "baujahr",
)


def _icon_stats(html: str, text: str) -> list[tuple[str, str]]:
    """The `#co-icons` strip: <li><div>14 buildings</div><div>Number of buildings</div></li>.

    "14 buildings" is Haspo's alone in this harvest and is half of F-001, so it
    gets a text fallback too: the flattened page renders the same tiles as a
    value line followed by its label line.
    """
    block = re.search(r'id="co-icons"(.*?)</ul>', html or "", re.S)
    if block:
        pairs = re.findall(r"<li>\s*<div>(.*?)</div>\s*<div>(.*?)</div>\s*</li>", block.group(1), re.S)
        if pairs:
            return [(squash(strip_tags(value)), squash(strip_tags(label))) for value, label in pairs]

    lines = [line.strip() for line in (text or "").split("\n")]
    return [
        (lines[index - 1], line)
        for index, line in enumerate(lines)
        if index and fold(line) in _STAT_LABELS
    ]


def _int_in(raw: str) -> int | None:
    match = re.search(r"\d+", raw or "")
    return int(match.group(0)) if match else None


def _distance_block(text: str) -> str:
    """The bulleted distances list, isolated from the rest of the page.

    Scoping matters: "Gazipasa" and "Alanya" also appear in this site's city
    dropdowns, and a page-wide search would happily read a distance out of a
    navigation menu.
    """
    match = re.search(r"(?is)\b(?:Distances|Entfernungen)\s*:(.{0,400})", text or "")
    return squash(match.group(1)) if match else ""


def _distance(block: str, anchors: tuple[str, ...], unit: str) -> tuple[float | None, str]:
    """First `<number> <unit>` following any of `anchors` inside the distances list.

    Matched case-insensitively against the original text rather than against
    base.fold()'s output: fold() rewrites the string, so an index taken in the
    folded copy does not reliably address the same character in the original,
    and `raw` must quote the page verbatim or it is not evidence.
    """
    for anchor in anchors:
        match = re.search(
            rf"(?i){re.escape(anchor)}[^0-9]{{0,20}}(\d[\d.,\s]*?)\s*{unit}\b", block
        )
        if match:
            return parse_amount(match.group(1)), squash(match.group(0))
    return None, ""


def _parse_complex(capture: Capture) -> ParseResult:
    result = ParseResult()
    text = _page_text(capture)
    html = capture.html or ""

    # --- structural stats -------------------------------------------------
    stats = _icon_stats(html, text)
    if not stats:
        result.unparsed.append(
            f"{capture.source_id}: stats strip not found in HTML or text — "
            "buildingCount/floorsPerBuilding not read"
        )
    for value, label in stats:
        folded = fold(label)
        raw = squash(f"{value} {label}")
        if "number of buildings" in folded or "anzahl der gebaude" in folded:
            count = _int_in(value)
            if count is not None:
                # F-001: Haspo is the ONLY source for "14 buildings", and it is a
                # different assertion from Seaside's "7 residence blocks" — not a
                # contradiction of it. Emitting it as buildingCount, never as
                # residenceBlockCount, is what keeps that finding honest.
                result.claims.append(Claim("project.buildingCount", count, raw))
        elif "floors of the building" in folded or "stockwerke" in folded:
            floors = _int_in(value)
            if floors is not None:
                result.claims.append(Claim("project.floorsPerBuilding", floors, raw))
        elif "year built" in folded or "baujahr" in folded:
            # No `project.yearBuilt` exists in CONTRACTS.md §2, and widening a bare
            # year into completionDate would invent the month the prose states.
            result.unparsed.append(f"{capture.source_id}: stats strip states {raw!r} (no contract field)")
        else:
            result.unparsed.append(f"{capture.source_id}: unmapped stat {raw!r}")

    # --- distances --------------------------------------------------------
    block = _distance_block(text)
    if not block:
        result.unparsed.append(f"{capture.source_id}: distances list not found — no distance claims")
    else:
        metres, raw = _distance(block, ("sea and beach", "meer und strand"), "m")
        if metres is not None:
            result.claims.append(Claim("project.distanceToSeaM", metres, raw, unit="m"))
        for field, anchors in (
            ("project.distanceToGazipasaAirportKm", ("gazipasa", "gazipaşa")),
            ("project.distanceToAntalyaAirportKm", ("antalya airport", "flughafen antalya")),
            ("project.distanceToAlanyaCentreKm", ("center alanya", "zentrum von alanya", "center of alanya")),
        ):
            km, raw = _distance(block, anchors, "km")
            if km is not None:
                result.claims.append(Claim(field, km, raw, unit="km"))

    # --- completion date and build status ---------------------------------
    # Both come out of the same sentence, which is the point: the page dates
    # completion in the future ("will be completed in May 2024") while the
    # capture ran 2026-07-27. That is the evidence behind F-006. The window
    # reaches backwards as well as forwards because German puts the month
    # before the verb ("wird im Mai 2024 abgeschlossen sein").
    sentence = re.search(
        r"(?is)([^.\n]{0,220}(?:will be completed|abgeschlossen sein)[^.\n]{0,120}\.?)", text
    )
    if sentence:
        raw = squash(sentence.group(1))
        completion = parse_iso_date(raw)
        if completion:
            result.claims.append(Claim("project.completionDate", completion, raw))
        result.claims.append(
            Claim(
                "project.buildStatus",
                "under_construction",
                raw,
                note=(
                    "Haspo publishes no build-status field. The page describes the project "
                    "in the future tense ('will be completed' / 'abgeschlossen sein', 'the "
                    "complex will have…'), which is the whole of its claim to being "
                    "unbuilt. Read at capture time 2026-07-27, ~2 years after the stated "
                    "completion — F-006. Parser reports the tense; builder resolves."
                ),
            )
        )
    else:
        result.unparsed.append(
            f"{capture.source_id}: completion sentence not found — no completionDate/buildStatus"
        )

    # --- developer --------------------------------------------------------
    developer = _flatten(_first(r'id="co-right-developer2"[^>]*>(.*?)</div>', html))
    if not developer:
        # Text fallback: the section heading on its own line, the name on the next.
        match = re.search(r"(?im)^[ \t]*(?:Entwickler|Developer)[ \t]*$\r?\n[ \t]*(.+?)[ \t]*$", text)
        developer = squash(match.group(1)) if match else ""
    if developer:
        result.claims.append(Claim("project.developer", developer, developer))
    else:
        result.unparsed.append(f"{capture.source_id}: developer block not found")

    # --- the listing grid -------------------------------------------------
    result.units.extend(_parse_cards(capture, result))

    # --- gaps -------------------------------------------------------------
    # Stated nowhere on this host. Recorded, never guessed (SYSTEM-PROMPT §3).
    result.unparsed.extend(
        [
            f"[GAP] project.residenceBlockCount — {capture.source_id} states no residence-block "
            "count; its building count is a different figure and must not be read as one (F-001)",
            f"[GAP] project.totalUnits — {capture.source_id} states no total apartment count",
            f"[GAP] project.constructionStart — {capture.source_id} states no construction start date",
        ]
    )
    return result


# ------------------------------------------------------------ listing cards --

def _card_note(layout: str | None, area: float | None, amount: float | None, kind: str) -> str | None:
    notes: list[str] = []
    if kind == "rent":
        notes.append(
            "page tags this listing as RENT, not sale — the monthly rent must never "
            "enter the sale-price series (F-002)"
        )
    if area is not None and area < _IMPLAUSIBLE_AREA_M2:
        notes.append(
            f"stated area {area:g} m² is implausible for a {layout or 'residential'} unit; "
            "reported as published, not corrected"
        )
    if kind == "sale" and amount is not None and amount < _IMPLAUSIBLE_SALE_PRICE:
        notes.append(
            f"stated sale price {amount:g} is implausibly low for a {layout or 'residential'} "
            "unit; reported as published, not corrected"
        )
    return "; ".join(notes) or None


def _parse_cards(capture: Capture, result: ParseResult) -> list[UnitObservation]:
    """The 18-card grid on a complex page.

    Read from HTML because the card's sale/rent class exists only there. In the
    flattened text a €1,000 rental is indistinguishable from a €1,000 apartment,
    and that single card is the reconnaissance "implausible €1,000 1+1".
    """
    cards = _chunks(capture.html or "", '<div class="co-list-item ', tail=6000)
    if cards:
        return [obs for card in cards if (obs := _parse_card(card, capture, result)) is not None]

    result.unparsed.append(
        f"{capture.source_id}: no co-list-item cards in HTML — falling back to the text grid, "
        "sale/rent cannot be distinguished there"
    )
    return _parse_cards_from_text(capture, result)


def _parse_card(card: str, capture: Capture, result: ParseResult) -> UnitObservation | None:
    head = card[:400]
    reference = _first(r'data-id="([^"]+)"', head) or None
    # `co-list-item-tab-rent` is the only place the page says this is a rental.
    kind = "rent" if "co-list-item-tab-rent" in head else (
        "sale" if "co-list-item-tab-sell" in head else capture.price_kind
    )

    price_raw = _flatten(_first(r'class="co-list-item-row-price"[^>]*>(.*?)</a>', card))
    layout_raw = _flatten(_first(r'class="co-list-item-row-bed-top"[^>]*>(.*?)</div>', card))
    area_raw = _flatten(_first(r'class="co-list-item-row-floor-top"[^>]*>(.*?)</div>', card))
    floor_raw = _flatten(_first(r'class="co-list-item-row-floor-bot"[^>]*>(.*?)</div>', card))

    amount, currency = parse_money(price_raw)
    if amount is None:
        result.unparsed.append(
            f"{capture.source_id}: card {reference or '?'} has no readable price ({price_raw!r})"
        )
        return None

    layout = normalize_layout(layout_raw)
    area = _area(area_raw)
    if layout_raw and layout is None:
        result.unparsed.append(f"{capture.source_id}: card {reference or '?'} layout {layout_raw!r} unmapped")

    raw = squash(" | ".join(part for part in (price_raw, layout_raw, area_raw, floor_raw) if part))
    return UnitObservation(
        layout=layout,
        interior_m2=area,
        outdoor_m2=None,          # Haspo never separates terrace/balcony area.
        floor_level=_floor(floor_raw),
        price_amount=amount,
        price_currency=currency,
        # Per the W0-B brief: a card observed on the index page is sourced to the
        # index page. `reference` carries Haspo's own listing id so the builder
        # can still correlate it with the detail-page capture of the same unit.
        url=capture.url,
        raw=raw,
        reference=reference,
        price_kind=kind,
        is_stale=capture.is_stale,
        note=_card_note(layout, area, amount, kind),
    )


_TEXT_PRICE = re.compile(r"^\s*\d[\d.,\s]*\s*[€$£₺]\s*$")


def _parse_cards_from_text(capture: Capture, result: ParseResult) -> list[UnitObservation]:
    """Fallback grid reader: price / layout / bathrooms / area / floor, one per line.

    Only reachable when the card markup is gone. It cannot see sale-vs-rent, so
    every observation inherits `capture.price_kind` and says so in its note.
    """
    lines = [line.strip() for line in _page_text(capture).split("\n")]
    out: list[UnitObservation] = []
    for index, line in enumerate(lines):
        if not _TEXT_PRICE.match(line) or index + 4 >= len(lines):
            continue
        layout_raw, area_raw, floor_raw = lines[index + 1], lines[index + 3], lines[index + 4]
        layout = normalize_layout(layout_raw)
        if layout is None:
            continue
        amount, currency = parse_money(line)
        if amount is None:
            continue
        area = _area(area_raw)
        note = _card_note(layout, area, amount, capture.price_kind)
        out.append(
            UnitObservation(
                layout=layout,
                interior_m2=area,
                outdoor_m2=None,
                floor_level=_floor(floor_raw),
                price_amount=amount,
                price_currency=currency,
                url=capture.url,
                raw=squash(" | ".join((line, layout_raw, area_raw, floor_raw))),
                reference=None,
                price_kind=capture.price_kind,
                is_stale=capture.is_stale,
                note="; ".join(
                    part for part in (note, "read from the text fallback: sale/rent not distinguishable") if part
                ),
            )
        )
    if not out:
        result.unparsed.append(f"{capture.source_id}: text fallback found no listing cards either")
    return out


# --------------------------------------------------------------- unit pages --

def _labelled(html: str, css_class: str) -> dict[str, str]:
    """`<div class="X"><div><div>Label:</div></div><div>Value</div></div>` -> {label: value}.

    Matching the nested shape exactly, rather than slicing a window and splitting
    on a colon, is what keeps an empty field empty: Haspo renders "Heating:" with
    no value as `<div></div>`, and a window-based reader happily swallows the
    next label as that field's value.

    The value div is read with a non-greedy `.*?</div>` because Haspo's values
    contain spans and links but never a nested div — true for all three shapes
    it uses: bare text, `<span>574 000</span> <span>€</span>`, and an `<a>` to
    the complex page.
    """
    pattern = (
        rf'<div class="{re.escape(css_class)}"[^>]*>\s*'
        r"<div>\s*<div>(.*?)</div>\s*</div>\s*<div>(.*?)</div>"
    )
    out: dict[str, str] = {}
    for label, value in re.findall(pattern, html or "", re.S):
        key = squash(_flatten(label)).rstrip(":")
        if key:
            out[key] = squash(_flatten(value))
    return out


# The headings that close the attribute block, plus the blank line that can sit
# where an empty value would be.
_BLOCK_HEADINGS = ("Description", "Similar items")
_NOT_A_VALUE = _BLOCK_HEADINGS + ("",)


def _labelled_from_text(text: str) -> dict[str, str]:
    """Text fallback: `Label:` on one line, its value on the next — unless that
    next line is another label or the heading that ends the block, which is how
    the flattened page renders a field Haspo left empty."""
    lines = [line.strip() for line in text.split("\n")]
    try:
        start = lines.index("Object ID:")
    except ValueError:
        return {}
    out: dict[str, str] = {}
    for index in range(start, len(lines)):
        line = lines[index]
        if line in _BLOCK_HEADINGS:
            break
        if not line.endswith(":"):
            continue
        nxt = lines[index + 1] if index + 1 < len(lines) else ""
        out[line[:-1]] = "" if (nxt.endswith(":") or nxt in _NOT_A_VALUE) else nxt
    return out


_CURRENCY_CHROME = {"€", "$", "£", "₺", "₽", "RUB", "Currency:", "Währung:"}


def _title_from_text(text: str) -> str:
    """Fallback for the <h1>: it sits two rows above the `Updated:` label, with
    the price and the currency switcher's glyphs in between."""
    lines = [line.strip() for line in text.split("\n")]
    for index, line in enumerate(lines):
        if not fold(line).startswith(("updated", "aktualisiert")):
            continue
        cursor = index - 1
        while cursor > 0 and (lines[cursor] in _CURRENCY_CHROME or not lines[cursor]):
            cursor -= 1
        # `cursor` is now the price row; the headline is the row above it.
        return lines[cursor - 1] if cursor > 0 else ""
    return ""


def _value(fields: dict[str, str], *labels: str) -> str:
    """Case/space-insensitive lookup that treats Haspo's 'Not available' as absent."""
    wanted = {fold(label) for label in labels}
    for key, value in fields.items():
        if fold(key) in wanted:
            return "" if fold(value) in ("not available", "-", "") else value
    return ""


def _parse_unit_detail(capture: Capture) -> ParseResult:
    result = ParseResult()
    html = capture.html or ""
    text = _page_text(capture)

    fields = _labelled(html, "sin-le52-item")
    address = _labelled(html, "sin-le92-item")
    if not fields:
        result.unparsed.append(f"{capture.source_id}: attribute block not in HTML — using text fallback")
        fields = _labelled_from_text(text)
        address = {}
    if not fields:
        result.unparsed.append(f"{capture.source_id}: no attribute block found at all — no observation emitted")
        return result

    title = squash(_flatten(_first(r"<h1[^>]*>(.*?)</h1>", html)).replace("&amp;", "&"))
    if not title:
        title = _title_from_text(text)

    price_raw = _value(fields, "Price")
    amount, currency = parse_money(price_raw)
    if amount is None:
        # A detail page with no price is a real state on this portal; it is
        # reported as an absence, never backfilled from the index card.
        result.unparsed.append(
            f"{capture.source_id}: detail page states no price ({price_raw!r}) — no observation emitted"
        )
        return result

    layout_raw = _value(fields, "Number of rooms")
    area_raw = _value(fields, "Area")
    floor_raw = _value(fields, "Floor")
    reference = _value(fields, "Object ID") or None

    layout = normalize_layout(layout_raw) or normalize_layout(title)
    area = _area(area_raw)
    # The attribute block gives a bare storey number; base.parse_floor needs the
    # word, so hand it back the label the page itself printed.
    floor = _floor(f"Floor: {floor_raw}") if floor_raw else None

    # "Sale / New buildings / Apartments" vs "Rent / Apartments" — the ad type is
    # the page's own statement of what the price means.
    ad_type = _ad_type(text)
    kind = "rent" if ad_type and fold(ad_type).startswith("rent") else (
        "sale" if ad_type else capture.price_kind
    )

    notes: list[str] = []
    note = _card_note(layout, area, amount, kind)
    if note:
        notes.append(note)

    # --- district check ---------------------------------------------------
    district = _value(address, "Area") or _district_from_text(text)
    if district and fold(district) != _EXPECTED_DISTRICT:
        stated = f"the page states district '{district}', not Türkler"
        if title and _EXPECTED_DISTRICT in fold(title):
            stated += f" (its own headline still says Türkler: {title!r})"
        notes.append(
            f"WRONG-DISTRICT SUSPECT: Azura World is in Türkler, Alanya; {stated}. "
            "Emitted unchanged so the builder can decide; do not treat this price as "
            "an Azura World anchor without resolving the mismatch (F-002)"
        )
        result.unparsed.append(
            f"{capture.source_id}: listing {reference or '?'} tagged to district {district!r} "
            f"instead of Türkler — price {price_raw!r}, headline {title!r}"
        )
    elif not district:
        result.unparsed.append(f"{capture.source_id}: no district stated — could not verify Türkler")

    if floor is None and floor_raw:
        result.unparsed.append(f"{capture.source_id}: floor value {floor_raw!r} unreadable")
    if not floor_raw:
        notes.append("page states no floor for this unit")

    # Seen but not classifiable into a unit field: kept so the evidence is not
    # lost between this parser and the builder (base.ParseResult.unparsed).
    for label, path in (
        ("Distance to the sea in meters", "per-unit sea distance"),
        ("Floors", "building storey count"),
    ):
        value = _value(fields, label)
        if value:
            result.unparsed.append(
                f"{capture.source_id}: {path} stated as {value!r} on a unit page "
                "(not a project-level claim from this capture)"
            )

    result.units.append(
        UnitObservation(
            layout=layout,
            interior_m2=area,
            outdoor_m2=None,
            floor_level=floor,
            price_amount=amount,
            price_currency=currency,
            url=capture.url,
            raw=squash(" | ".join(f"{k}: {v}" for k, v in fields.items() if v)),
            reference=reference,
            price_kind=kind,
            is_stale=capture.is_stale,
            note="; ".join(notes) or None,
        )
    )
    return result


def _ad_type(text: str) -> str:
    """The summary tile rendered as `<value>` then the label `Ad type`."""
    lines = [line.strip() for line in text.split("\n")]
    for index, line in enumerate(lines):
        if fold(line) == "ad type" and index:
            return lines[index - 1]
    return ""


def _district_from_text(text: str) -> str:
    """Fallback for the address block: the `City, district` tile reads "Alanya, Oba"."""
    lines = [line.strip() for line in text.split("\n")]
    for index, line in enumerate(lines):
        if fold(line) == "city, district" and index:
            _, _, district = lines[index - 1].partition(",")
            return squash(district)
    return ""


# ------------------------------------------------------------------ entry --

def parse(capture: Capture) -> ParseResult:
    if capture.source_id in SOURCE_IDS:
        return _parse_complex(capture)
    if any(capture.source_id.startswith(prefix) for prefix in SOURCE_ID_PREFIXES):
        return _parse_unit_detail(capture)
    # Surfaced rather than raised: an unexpected id is a routing bug in the
    # builder, and losing this host's 18 listings to it would be worse.
    result = ParseResult()
    result.unparsed.append(f"{capture.source_id}: not a hasporealty.com source id — nothing parsed")
    return result
