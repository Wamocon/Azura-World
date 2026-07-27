"""Official / developer / hotel / social parsers — tiers 1-3 (W0-B).

Five captures, four subjects, one module: these are the pages the operator
itself controls, so they are the only sources that can state a fact rather than
repeat one. Everything a portal says later is measured against what is read
here, which is why a wrong extraction in this file is more expensive than a
wrong extraction anywhere else in the pipeline.

Two scoping rules run through the whole module, both of them consequences of
the frozen field vocabulary rather than taste:

  * `project.contact.*` is populated only from captures whose subject is the
    project or its developer (azuraworld.com, cebecigroup.com, @cebeci.group).
    The hotel publishes a reservation desk and a reception, not the project's
    sales line, and CONTRACTS.md §2 gives AzuraHotel no contact fields — so
    hotel contact details surface as `unparsed` instead of being filed under a
    field that means something else.
  * `project.social` is the only social path that exists, so it IS emitted from
    every capture, hotel ones included. Which subject an account belongs to is
    visible from the source the claim came from.

No claim in this file decides anything. Confidence, tiers, agreement and the
Wyndham→Azura rebrand (F-007) are the builder's, and the only thing this module
owes it is a value, the substring that value was read from, and silence where
the page says nothing.

`ReviewObservation` is imported for parity with the sibling parsers; none of
these five pages publishes a rating, so `ParseResult.reviews` stays empty here.
"""

from __future__ import annotations

import re

from .base import (
    Capture,
    Claim,
    ParseResult,
    ReviewObservation,  # noqa: F401 - see module docstring
    squash,
    fold,
    strip_tags,
    parse_money,
    parse_amount,
    parse_area_m2,
    parse_iso_date,
    normalize_layout,
    find_near,
)

HOST = "multi"
SOURCE_IDS = [
    "azuraworld-official",
    "cebecigroup-index",
    "azuraworldhotel",
    "instagram-cebecigroup",
    "instagram-azuraworldhotel",
]


# ------------------------------------------------------------------ plumbing --

# &amp; is replaced last: doing it first turns "&amp;lt;" into "<" and invents
# markup that was never on the page.
_ENTITIES: tuple[tuple[str, str], ...] = (
    ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&apos;", "'"),
    ("&#039;", "'"), ("&#39;", "'"), ("&nbsp;", " "), ("&amp;", "&"),
)


def _unescape(value: str) -> str:
    out = value or ""
    for entity, char in _ENTITIES:
        out = out.replace(entity, char)
    return out


def _page_text(capture: Capture) -> str:
    """Rendered text, falling back to the stripped HTML.

    Instagram serves a login wall and the harvester stored zero characters of
    rendered text for both accounts. A parser that trusted `capture.text` alone
    would return nothing from a page whose <head> still carries the whole
    profile.
    """
    if squash(capture.text):
        return capture.text
    return strip_tags(capture.html)


_META_TAG_RE = re.compile(r"(?is)<meta\b[^>]*>")
_ATTR_RE = re.compile(r"""(?is)\b([a-z][a-z0-9:_-]*)\s*=\s*["']([^"']*)["']""")


def _metas(html: str) -> dict[str, tuple[str, str]]:
    """meta name/property -> (content, the tag it was read from).

    The tag itself is kept because a Claim's `raw` has to be the substring
    actually read, and on a login-walled page the <meta> tag is the only
    substring there is. Attributes are collected per tag rather than matched in
    order: Instagram writes `content=` before `name=` on exactly the tag that
    carries the bio.
    """
    out: dict[str, tuple[str, str]] = {}
    for tag in _META_TAG_RE.findall(html or ""):
        attrs = {fold(key): value for key, value in _ATTR_RE.findall(tag)}
        key = attrs.get("property") or attrs.get("name")
        content = attrs.get("content")
        if key and content:
            out.setdefault(fold(key), (_unescape(content), squash(tag)))
    return out


def _sentence(text: str, index: int) -> str:
    """The sentence the match sits in.

    A better `raw` than a fixed-width window because it never cuts a number away
    from the noun that gives it meaning — "188" and "rooms" have to stay in the
    same quote for the number to be checkable.
    """
    starts = [text.rfind(mark, 0, index) for mark in (". ", ".\n", "\n", ";")]
    start = max(starts) + 1 if max(starts) >= 0 else 0
    ends = [pos for pos in (text.find(". ", index), text.find("\n", index),
                            text.find(";", index)) if pos != -1]
    end = min(ends) + 1 if ends else len(text)
    return squash(text[start:end])


def _as_number(value: float | None) -> float | int | None:
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


def _dedupe(claims: list[Claim]) -> list[Claim]:
    """One Claim per distinct value per field.

    A template that prints the same social icon in the header and the footer
    states one fact twice; forwarded as two claims it would look to the builder
    like two sightings, and repetition is not corroboration. A second sighting
    with a *different* raw is folded into the note so it stays visible.
    """
    kept: dict[tuple[str, str], Claim] = {}
    order: list[tuple[str, str]] = []
    for claim in claims:
        key = (claim.field, fold(claim.value))
        existing = kept.get(key)
        if existing is None:
            kept[key] = claim
            order.append(key)
            continue
        if claim.raw != existing.raw and (existing.note or "").count("also:") < 2:
            existing.note = f"{existing.note or ''} | also: {claim.raw}".strip(" |")
    return [kept[key] for key in order]


# --------------------------------------------------------------------- links --

_HREF_RE = re.compile(r"""(?is)href\s*=\s*["']([^"']+)["']""")
_URL_HOST_RE = re.compile(r"(?i)^(?:https?:)?//(?:www\.)?([^/?#]+)")

_SOCIAL_HOSTS: tuple[tuple[str, str], ...] = (
    ("instagram.com", "instagram"),
    ("facebook.com", "facebook"),
    ("linkedin.com", "linkedin"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
    ("twitter.com", "twitter"),
    ("x.com", "x"),
    ("tiktok.com", "tiktok"),
    ("t.me", "telegram"),
    ("vk.com", "vk"),
)


def _social_claims(html: str) -> list[Claim]:
    """One claim per social account URL found in an href.

    The host is compared on a label boundary, not by substring: Instagram serves
    its images from `scontent-*.cdninstagram.com`, and a naive `"instagram.com"
    in url` would file a CDN image as an account.
    """
    claims: list[Claim] = []
    for match in _HREF_RE.finditer(html or ""):
        url = _unescape(squash(match.group(1)))
        host_match = _URL_HOST_RE.match(url)
        if not host_match:
            continue
        host = fold(host_match.group(1))
        for domain, platform in _SOCIAL_HOSTS:
            if host == domain or host.endswith("." + domain):
                claims.append(Claim(field="project.social", value=url,
                                    raw=squash(match.group(0)), note=platform))
                break
    return claims


# ------------------------------------------------------------------ contacts --

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_SECTION_RE = re.compile(r"(?i)^(.{2,40}?(?:office|numbers|ofis))$")
_LABELLED_PHONE_RE = re.compile(r"^([^:\d]{2,24}?)\s*[:：]\s*(\+\d[\d ()\-./]{6,})$")
_ADDRESS_HINT_RE = re.compile(r"(?i)(?:\bmah\.|mahalle|\bcad\.|cadde|\bsok\.|sokak|no\s*:\s*\d)")
_POSTCODE_LINE_RE = re.compile(r"^\d{5}\b")


def _email_claims(text: str, html: str) -> list[Claim]:
    claims: list[Claim] = []
    for match in _HREF_RE.finditer(html or ""):
        href = squash(match.group(1))
        if fold(href).startswith("mailto:"):
            address = _EMAIL_RE.search(href)
            if address:
                claims.append(Claim(field="project.contact.email", value=address.group(0),
                                    raw=squash(match.group(0)), note="mailto link"))
    for match in _EMAIL_RE.finditer(text or ""):
        claims.append(Claim(field="project.contact.email", value=match.group(0),
                            raw=_sentence(text, match.start()), note="contact block"))
    return claims


def _contact_claims(text: str) -> list[Claim]:
    """Phones and addresses, each tagged with the heading standing over it.

    Two offices publish two different numbers. Returned as a bare list they read
    as a disagreement about one number; tagged with "Alanya Office" and
    "Mahmutlar Office" they read as what they are — two facts. The same walk
    handles the international block, where the label is a country rather than
    the word "Phone".
    """
    lines = (text or "").splitlines()
    claims: list[Claim] = []
    section: str | None = None

    for index, line in enumerate(lines):
        stripped = squash(line)
        if not stripped:
            continue

        heading = _SECTION_RE.match(stripped)
        if heading:
            section = squash(heading.group(1))
            continue

        phone = _LABELLED_PHONE_RE.match(stripped)
        if phone:
            label, number = squash(phone.group(1)), squash(phone.group(2))
            note = section or "contact block"
            if fold(label) not in ("phone", "tel", "telefon", "mobile", "gsm"):
                note = f"{note} - {label}"
            claims.append(Claim(field="project.contact.phone", value=number,
                                raw=stripped, note=note))
            continue

        if _ADDRESS_HINT_RE.search(stripped):
            # azuraworld.com breaks the postcode onto its own line. Without it
            # the address is not postable, so the claim spans both lines and
            # `raw` keeps the line break that was really there.
            block = [line.rstrip()]
            for follower in lines[index + 1: index + 3]:
                if not squash(follower):
                    continue
                if _POSTCODE_LINE_RE.match(squash(follower)):
                    block.append(follower.rstrip())
                break
            claims.append(Claim(field="project.contact.address",
                                value=squash(" ".join(block)),
                                raw="\n".join(block),
                                note=section or "contact block"))
    return claims


# ----------------------------------------------------------------- developer --

_DEVELOPER_RE = re.compile(
    r"(?i)(Cebeci\s+Group(?:\s+(?:A\.\s*Ş\.|A\.\s*S\.|LLC|Ltd\.?|Inc\.?))?)"
)
_COMPANY_SUFFIX_RE = re.compile(r"(?i)(?:a\.\s*ş\.|a\.\s*s\.|llc|ltd\.?|inc\.?|gmbh)$")
_SINCE_RE = re.compile(r"(?i)\b(?:since|seit|beri|с)\s*[:\-]?\s*(\d{4})\b")


def _developer_claims(text: str, metas: dict[str, tuple[str, str]]) -> list[Claim]:
    """Company name from the body, plus any differently-suffixed variant in the
    head.

    azuraworld.com writes "Cebeci Group A.Ş." in its copy and "Cebeci Group LLC"
    in `meta[name=author]`; both are on the page, so both are reported and the
    builder decides. The suffix test is what keeps this honest — cebecigroup.com
    fills the same attribute with "Cebeci Group I.T Manager", which is a job
    title and must never become a developer name.
    """
    candidates: list[Claim] = []

    body = _DEVELOPER_RE.search(text or "")
    if body:
        candidates.append(Claim(field="project.developer", value=squash(body.group(1)),
                                raw=_sentence(text, body.start()), note="body copy"))

    for key, label in (("og:title", "meta og:title"), ("author", "meta[name=author]")):
        content, tag = metas.get(key, ("", ""))
        name = squash(content)
        if "cebeci" in fold(name) and _COMPANY_SUFFIX_RE.search(fold(name)):
            candidates.append(Claim(field="project.developer", value=name,
                                    raw=tag, note=label))

    return candidates


def _founded_year_claims(text: str, note: str) -> list[Claim]:
    claims: list[Claim] = []
    for match in _SINCE_RE.finditer(text or ""):
        year = int(match.group(1))
        if 1800 <= year <= 2100:
            claims.append(Claim(field="project.developerFoundedYear", value=year,
                                raw=squash(match.group(0)), note=note))
    return claims


# ------------------------------------------------- project metrics: scanners --

# Anchors are multi-word on purpose. A bare number next to the word "blocks" is
# not a block count, and a scanner that guessed would put a fabricated structure
# figure into the highest-tier slot in the dataset — the one place a wrong
# number wins every conflict. Counts are therefore not scanned at all: when
# these pages do not state them, the honest output is nothing.
_AREA_ANCHORS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("project.plotAreaSqm", ("plot area", "land area", "total land", "arsa alani", "grundstucksflache")),
    ("project.greenAreaSqm", ("green area", "landscaped area", "yesil alan", "grunflache")),
    ("project.buildingFootprintSqm", ("building footprint", "construction area", "closed area", "insaat alani")),
    ("project.outdoorFacilityAreaSqm", ("outdoor facility", "outdoor social area", "acik alan")),
)
_DATE_ANCHORS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("project.constructionStart", ("construction start", "start of construction", "groundbreaking", "insaat baslangic")),
    ("project.completionDate", ("completion date", "date of completion", "delivery date", "handover date", "teslim tarihi")),
)


# Every project field that is a figure rather than a string. Used to decide
# whether the "this page states nothing" note is still true, so that the note
# cannot outlive the page it describes.
_PROJECT_FIGURE_FIELDS = frozenset(path for path, _ in (*_AREA_ANCHORS, *_DATE_ANCHORS)) | {
    "project.residenceBlockCount", "project.buildingCount", "project.floorsPerBuilding",
    "project.totalUnits", "project.distanceToSeaM", "project.distanceToAlanyaCentreKm",
    "project.distanceToGazipasaAirportKm", "project.distanceToAntalyaAirportKm",
    "project.downPaymentPercent",
}


def _states_no_figures(claims: list[Claim]) -> bool:
    return not any(claim.field in _PROJECT_FIGURE_FIELDS for claim in claims)


def _project_metric_claims(text: str) -> list[Claim]:
    claims: list[Claim] = []
    for field_path, anchors in _AREA_ANCHORS:
        for window in find_near(text or "", anchors):
            area = parse_area_m2(window)
            if area is not None:
                claims.append(Claim(field=field_path, value=_as_number(area),
                                    raw=squash(window), unit="m2"))
    for field_path, anchors in _DATE_ANCHORS:
        for window in find_near(text or "", anchors):
            iso = parse_iso_date(window)
            if iso:
                claims.append(Claim(field=field_path, value=iso, raw=squash(window)))
    return claims


# --------------------------------------------------------- unmapped surfacing --

_MONEY_RE = re.compile(
    r"(?i)(?:[€$£₺]\s?\d[\d.,]*|\b\d[\d.,]{2,}\s?(?:€|₺|eur\b|usd\b|gbp\b))"
)
_LAYOUT_TOKEN_RE = re.compile(r"\b\d\s*\+\s*\d\b")


def _surface_unmapped(source_id: str, text: str) -> list[str]:
    """Values a tier 1-3 page could state that the field vocabulary has no path
    for.

    There is no price and no layout field in the project vocabulary, so a price
    on the developer's own site has nowhere to go — and that is exactly the
    sighting that would matter most against the portals. Both scanners are
    anchored on a currency token or on the Turkish `n+n` notation, so they stay
    quiet on today's snapshots and start talking the day a page changes.
    """
    out: list[str] = []
    for match in _MONEY_RE.finditer(text or ""):
        amount, currency = parse_money(match.group(0))
        if amount is not None:
            out.append(
                f"{source_id}: money stated, no field for it - "
                f"{amount:g} {currency or 'currency unstated'} in "
                f"\"{_sentence(text, match.start())}\""
            )
    for match in _LAYOUT_TOKEN_RE.finditer(text or ""):
        layout = normalize_layout(match.group(0))
        if layout:
            out.append(
                f"{source_id}: unit layout {layout} stated, no field for it - "
                f"\"{_sentence(text, match.start())}\""
            )
    return out


# ---------------------------------------------------------------- amenities --

# Matched against the page, never assumed. Every term here has to appear in the
# text before it is emitted, so the list can only ever under-report.
_AMENITY_TERMS: tuple[str, ...] = (
    "Indoor Pool", "Oasis Pool", "Aquapark", "Mini Club", "children's playground",
    "Fitness Center", "Wi-Fi", "beach towels", "sunbeds", "umbrellas",
    "shuttle service", "steam room", "Turkish bath", "sauna", "salt room",
    "massage", "private beach", "Spa & Wellness", "A'la Carte", "buffet",
)


def _amenities(text: str) -> list[str]:
    """Substring matching would list a spa because the page says "living space".

    Hence the boundary guards, and the optional plural so "buffets" still counts
    as a buffet.
    """
    folded = fold(text)
    return [
        term for term in _AMENITY_TERMS
        if re.search(rf"(?<!\w){re.escape(fold(term))}s?(?!\w)", folded)
    ]


# ------------------------------------------------------ azuraworld.com (t. 1) --

_EXPERIENCE_RE = re.compile(r"(?i)\b\d{1,3}\s+years of experience\b")


def _parse_azuraworld_official(capture: Capture) -> ParseResult:
    text = _page_text(capture)
    metas = _metas(capture.html)
    result = ParseResult()

    claims: list[Claim] = []
    claims.extend(_developer_claims(text, metas))
    claims.extend(_email_claims(text, capture.html))
    claims.extend(_contact_claims(text))
    claims.extend(_social_claims(capture.html))
    claims.extend(_project_metric_claims(text))
    result.claims = _dedupe(claims)

    result.amenities = _amenities(text)
    result.unparsed.extend(_surface_unmapped(capture.source_id, text))

    # The only figure in the copy is an age, not a year. 2026 - 40 = 1986 would
    # contradict the developer's own "SINCE 1982" and would be arithmetic this
    # module is not allowed to do; the sentence goes up as-is instead.
    experience = _EXPERIENCE_RE.search(text)
    if experience:
        result.unparsed.append(
            f"{capture.source_id}: \"{squash(experience.group(0))}\" in "
            f"\"{_sentence(text, experience.start())}\" - a duration, not a founding "
            "year; no founding year is stated on this page"
        )

    for match in _HREF_RE.finditer(capture.html or ""):
        href = squash(match.group(1))
        if "goo.gl/maps" in fold(href) or "maps.app.goo" in fold(href):
            result.unparsed.append(
                f"{capture.source_id}: map pin for the project - {href} (no coordinate field)"
            )
            break

    if _states_no_figures(result.claims):
        result.unparsed.append(
            f"{capture.source_id}: the tier-1 official site states no structure, area, "
            "timeline, distance or payment figure at all - the whole page is prose plus "
            "a contact block"
        )
    return result


# ------------------------------------------------- cebecigroup.com/en (t. 2) --

_FILTER_RE = re.compile(r'(?is)<li\b[^>]*data-filter="\.([a-z]+)"[^>]*>(.*?)</li>')
_CARD_RE = re.compile(r'(?is)<div\b[^>]*class="col-md-4 single-item ([a-z]+)"')
_H5_RE = re.compile(r"(?is)<h5[^>]*>(.*?)</h5>")
_CATEGORY_RE = re.compile(r'(?is)<span class="category">(.*?)</span>')
_LEAD_CARD_RE = re.compile(r'(?is)<div\b[^>]*class="[^"]*cg-lead-proje-kart[^"]*"[^>]*>(.*?)</div>')
_SMALL_RE = re.compile(r"(?is)<small[^>]*>(.*?)</small>")

_BUILD_STATUS_WORDS: tuple[tuple[str, str], ...] = (
    ("completed", "completed"),
    ("finished", "completed"),
    ("tamamlan", "completed"),
    ("bitmis", "completed"),
    ("under construction", "under_construction"),
    ("construction", "under_construction"),
    ("ongoing", "under_construction"),
    ("devam", "under_construction"),
    ("insaat", "under_construction"),
    ("planned", "planned"),
    ("planlan", "planned"),
)


def _build_status(raw: str) -> str | None:
    folded = fold(raw)
    for needle, status in _BUILD_STATUS_WORDS:
        if needle in folded:
            return status
    return None


def _parse_cebecigroup_index(capture: Capture) -> ParseResult:
    text = _page_text(capture)
    html = capture.html or ""
    metas = _metas(html)
    result = ParseResult()

    claims: list[Claim] = []
    claims.extend(_developer_claims(text, metas))
    claims.extend(_founded_year_claims(text, "logo lockup"))
    claims.extend(_email_claims(text, html))
    claims.extend(_contact_claims(text))
    claims.extend(_social_claims(html))
    claims.extend(_project_metric_claims(text))

    # The gallery filters name their own CSS classes, so the class -> status
    # mapping is read off the page rather than translated from Turkish here.
    filters = {fold(cls): squash(strip_tags(label)) for cls, label in _FILTER_RE.findall(html)}

    cards = list(_CARD_RE.finditer(html))
    for index, match in enumerate(cards):
        end = cards[index + 1].start() if index + 1 < len(cards) else match.end() + 1500
        chunk = html[match.end():end]
        title = _H5_RE.search(chunk)
        category = _CATEGORY_RE.search(chunk)
        if not title:
            continue
        name = squash(_unescape(strip_tags(title.group(1))))
        place = squash(_unescape(strip_tags(category.group(1)))) if category else ""
        css = fold(match.group(1))
        label = filters.get(css, css)

        if fold("azura world residence") in fold(name):
            status = _build_status(label)
            if status:
                claims.append(Claim(
                    field="project.buildStatus", value=status,
                    raw=f'<div class="col-md-4 single-item {match.group(1)}"> ... <h5>{name}</h5>',
                    note=f'project card filed under the page\'s own "{label}" filter',
                ))
        # Two Azura-named hotels and a Wyndham-named one share this roster;
        # which of them is which is F-007's problem, and it cannot be settled
        # without knowing that all three are listed here as separate projects.
        if any(token in fold(name) for token in ("azura", "wyndham")):
            result.unparsed.append(
                f"{capture.source_id}: project roster entry - \"{name}\" ({place}) "
                f'filed under "{label}"'
            )

    for card in _LEAD_CARD_RE.findall(html):
        inner = squash(_unescape(strip_tags(card)))
        if "azura world" not in fold(inner):
            continue
        small = _SMALL_RE.search(card)
        if not small:
            continue
        detail = squash(_unescape(strip_tags(small.group(1))))
        status = _build_status(detail)
        if status:
            claims.append(Claim(
                field="project.buildStatus", value=status, raw=squash(inner),
                note="contact-form project picker",
            ))

    result.claims = _dedupe(claims)
    result.unparsed.extend(_surface_unmapped(capture.source_id, text))

    for match in _HREF_RE.finditer(html):
        href = squash(match.group(1))
        if "azura-world-residence-hotel" in fold(href):
            result.unparsed.append(
                f"{capture.source_id}: project detail page linked from the roster - {href} "
                "(the harvested cebecigroup-project capture returned a 404 body)"
            )
            break

    if _states_no_figures(result.claims):
        result.unparsed.append(
            f"{capture.source_id}: the developer's project index carries no structure, "
            "unit-count, area, timeline or price figure for Azura World - only its "
            "location and its completion state"
        )
    return result


# --------------------------------------------- azuraworldhotel.com (tier 3) --

_STARS_RE = re.compile(r"(?i)\b(\d)\s*[-‐‑–]?\s*star\b")
_ROOMS_RE = re.compile(r"(?i)\btotal of\s+(\d[\d.,]*)\s+rooms\b")
_ROOMS_FALLBACK_RE = re.compile(r"(?i)\b(\d[\d.,]*)\s+rooms\b")
_FLOORS_RE = re.compile(r"(?i)\b(\d[\d.,]*)\s+floors\b")
_OPENED_RE = re.compile(r"(?i)\bopen(?:ing|ed)\s+(?:in\s+)?(\d{4})\b")
_BOARD_RE = re.compile(r"(?i)\ball[-\s]?inclusive\b")
_SLIDES_RE = re.compile(r"(?i)\b(\d[\d.,]*)\s+(?:different\s+)?slides?\b")
_BEACH_DISTANCE_RE = re.compile(r"(?i)\bbeach is\s+(\d[\d.,]*)\s*(km|m)\b")
_CHECK_IN_RE = re.compile(r"(?i)\bcheck-?in is at\s+(\d{1,2}:\d{2})")
_CHECK_OUT_RE = re.compile(r"(?i)\bcheck-?out is at\s+(\d{1,2}:\d{2})")
_WELCOME_RE = re.compile(r"(?i)\bWelcome to (?:the )?([^\n–—|.]{3,60})")
_FORMER_NAME_RE = re.compile(
    r"(?i)\b(?:formerly|previously known as|eski adı|önceki adı|früher)\b[^.\n]{0,90}"
)
_TITLE_RE = re.compile(r"(?is)<title[^>]*>(.*?)</title>")

# F-007 is a branding question, so the brands are enumerated and looked for
# rather than reasoned about. What the page says is a claim; what it does not
# say is an absence, and the two are reported differently.
_CHAIN_BRANDS: tuple[str, ...] = (
    "wyndham", "ramada", "radisson", "hilton", "marriott", "accor", "best western",
    "sheraton", "novotel", "mercure", "ibis", "tui blue", "rixos", "barut",
)


def _parse_azuraworldhotel(capture: Capture) -> ParseResult:
    text = _page_text(capture)
    html = capture.html or ""
    # Wider than capture.text and still free of CSS and JSON: strip_tags drops
    # script/style bodies, so a brand name found here was really written for a
    # reader.
    page_prose = fold(strip_tags(html))
    result = ParseResult()
    claims: list[Claim] = []

    title = _TITLE_RE.search(html)
    if title:
        name = squash(_unescape(title.group(1)))
        if 3 <= len(name) <= 60 and any(word in fold(name) for word in ("hotel", "resort")):
            note = "document <title>"
            welcome = _WELCOME_RE.search(text)
            if welcome and fold(squash(welcome.group(1))) != fold(name):
                # Marketing copy appends the town; same hotel, longer string.
                note = f"{note}; body heading reads \"Welcome to {squash(welcome.group(1))}\""
            claims.append(Claim(field="hotel.name", value=name,
                                raw=squash(title.group(0)), note=note))

    stars = _STARS_RE.search(text)
    if stars:
        claims.append(Claim(field="hotel.stars", value=int(stars.group(1)),
                            raw=_sentence(text, stars.start())))

    rooms = _ROOMS_RE.search(text) or _ROOMS_FALLBACK_RE.search(text)
    if rooms:
        claims.append(Claim(field="hotel.roomCount", value=_as_number(parse_amount(rooms.group(1))),
                            raw=_sentence(text, rooms.start())))

    floors = _FLOORS_RE.search(text)
    if floors:
        claims.append(Claim(field="hotel.floors", value=_as_number(parse_amount(floors.group(1))),
                            raw=_sentence(text, floors.start())))

    opened = _OPENED_RE.search(text)
    if opened:
        claims.append(Claim(field="hotel.openedYear", value=int(opened.group(1)),
                            raw=_sentence(text, opened.start()),
                            note="stated as a future opening on this snapshot"))

    board = _BOARD_RE.search(text)
    if board:
        claims.append(Claim(field="hotel.board", value=squash(board.group(0)),
                            raw=_sentence(text, board.start())))

    # "Previous slide" / "Next slide" are carousel labels. Requiring the word
    # aquapark in the same sentence keeps a UI string out of a hotel figure.
    for match in _SLIDES_RE.finditer(text):
        sentence = _sentence(text, match.start())
        if "aquapark" in fold(sentence):
            claims.append(Claim(field="hotel.aquaparkSlides",
                                value=_as_number(parse_amount(match.group(1))),
                                raw=sentence))
            break

    beach = _BEACH_DISTANCE_RE.search(text)
    if beach:
        # "The beach area is 125 meters" on the same page is the frontage, not a
        # distance; only the "beach is <n> km away" phrasing feeds this field.
        distance = parse_amount(beach.group(1))
        unit = fold(beach.group(2))
        if distance is not None:
            metres = distance * 1000 if unit == "km" else distance
            claims.append(Claim(field="hotel.distanceToBeachM", value=_as_number(metres),
                                raw=_sentence(text, beach.start()), unit="m",
                                note=f"page states \"{squash(beach.group(0))}\""))

    check_in = _CHECK_IN_RE.search(text)
    if check_in:
        claims.append(Claim(field="hotel.checkIn", value=check_in.group(1),
                            raw=_sentence(text, check_in.start())))
    check_out = _CHECK_OUT_RE.search(text)
    if check_out:
        claims.append(Claim(field="hotel.checkOut", value=check_out.group(1),
                            raw=_sentence(text, check_out.start())))

    # Word-bounded and run over the stripped page, not the markup: "accor" is a
    # substring of "according", and a hotel chain invented out of a stray English
    # adverb would be the worst possible answer to F-007.
    for brand in _CHAIN_BRANDS:
        hit = re.search(rf"(?<!\w){brand}(?!\w)", page_prose)
        if hit:
            claims.append(Claim(field="hotel.brandAffiliation", value=brand,
                                raw=squash(page_prose[max(0, hit.start() - 120): hit.end() + 120]),
                                note="brand token found on the page; the operator's "
                                     "relationship to it is not stated here"))
            break
    else:
        result.unparsed.append(
            f"{capture.source_id}: absence-check - none of "
            f"({', '.join(_CHAIN_BRANDS)}) occurs anywhere in the page prose, so the "
            "hotel's own site states no brand affiliation and no former name. Evidence "
            "for F-007, absence only - no claim emitted."
        )

    former = _FORMER_NAME_RE.search(text)
    if former:
        # The value would be a proper noun whose boundaries this parser would
        # have to guess at; the sentence goes up intact instead.
        result.unparsed.append(
            f"{capture.source_id}: former-name phrasing found, name not extracted - "
            f"\"{squash(former.group(0))}\""
        )

    claims.extend(_social_claims(html))
    result.claims = _dedupe(claims)
    result.amenities = _amenities(text)
    result.unparsed.extend(_surface_unmapped(capture.source_id, text))
    result.unparsed.extend(_hotel_unmapped(capture, text, html))
    return result


_HOTEL_UNMAPPED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("lift count", re.compile(r"(?i)\b\d+\s+elevators\b")),
    ("pet policy", re.compile(r"(?i)\bPets are [^.]+")),
    # Stops at m² rather than at a full stop: "22-24.99 m²" contains one.
    ("room type and size",
     re.compile(r"(?i)\b(?:Deluxe Family|Deluxe|Superior) rooms range from [^\n]{0,60}?m²")),
    ("beach frontage", re.compile(r"(?i)\bThe \d+-meter beach area[^.]+")),
    ("aquapark opening hours", re.compile(r"(?i)\bAquapark hours: [^.]+")),
    ("spa operating hours", re.compile(r"(?i)\bOperating hours: [^.]+")),
    ("tourism licence", re.compile(r"(?i)\bTourism Operation Certificate: \s*\d+")),
    ("hotel reservation line", re.compile(r"(?i)\bReservation\s*\d[\d ]{8,}")),
    ("hotel reception line", re.compile(r"(?i)\bReception\s*\d[\d ]{8,}")),
    ("hotel email", _EMAIL_RE),
)
_FACILITY_AREA_RE = re.compile(r"(?i)\b(Oasis Pool|Aquapark area)\s*\(([\d.,]+\s*m²)\)")


def _hotel_unmapped(capture: Capture, text: str, html: str) -> list[str]:
    """Real facts on the hotel page that CONTRACTS.md §2 has no field for.

    AzuraHotel has no contact, address or facility-area member, so every one of
    these would have to be bent into a project field to be "kept". They are kept
    here instead, verbatim.
    """
    out: list[str] = []
    seen: set[tuple[str, str]] = set()
    for label, pattern in _HOTEL_UNMAPPED_PATTERNS:
        for match in pattern.finditer(text):
            quoted = squash(match.group(0))
            # The footer prints the same reservation number with and without a
            # space after the label. One fact, one line.
            key = (label, re.sub(r"[^a-z0-9@.]", "", fold(quoted)))
            if key in seen:
                continue
            seen.add(key)
            out.append(f"{capture.source_id}: {label} - \"{quoted}\"")

    for name, raw_area in _FACILITY_AREA_RE.findall(text):
        area = parse_area_m2(raw_area)
        if area is not None:
            out.append(f"{capture.source_id}: facility area - {name} {_as_number(area)} m2")

    address = re.search(r"(?i)Our Address:?\s*([^\n]+(?:\n[^\n]+){0,2})", text)
    if address:
        out.append(f"{capture.source_id}: hotel postal address - \"{squash(address.group(1))}\"")

    # The footer contradicts the header on the same page. Not a conflict between
    # sources, so not a Finding this parser can raise - but the builder cannot
    # see it unless it is carried up.
    if "manavgat" in fold(text) and "turkler" in fold(text):
        out.append(
            f"{capture.source_id}: the page gives two different addresses - "
            "\"Turkler Mah. Kargi Cayi Cad. No:10 Alanya\" in the contact block and "
            "\"Manavgat/Antalya, TR\" in the footer"
        )

    for match in _HREF_RE.finditer(html):
        href = squash(match.group(1))
        if "tripadvisor" in fold(href):
            out.append(
                f"{capture.source_id}: the hotel site links a TripAdvisor review page for a "
                f"DIFFERENT Cebeci property - {href} (wrong-property risk for the review set)"
            )
            break

    return out


# ---------------------------------------------------- instagram (tiers 2, 3) --

_HANDLE_TITLE_RE = re.compile(r"^(.*?)\s*\(@([A-Za-z0-9._]+)\)")
_COUNTS_RE = re.compile(
    r"(?i)([\d.,\s]+)\s+Followers,\s*([\d.,\s]+)\s+Following,\s*([\d.,\s]+)\s+Posts"
)
_BIO_PHONE_RE = re.compile(r"\+\d[\d  ().\-]{7,}\d")

# Which subject each account speaks for. Instagram is a login wall for both, so
# the account is identified from the handle rather than from anything rendered.
_INSTAGRAM_SUBJECT: dict[str, str] = {
    "instagram-cebecigroup": "project.developer",
    "instagram-azuraworldhotel": "hotel.name",
}


def _parse_instagram(capture: Capture) -> ParseResult:
    """Everything here comes out of <head>.

    Instagram renders nothing without a session — the harvester stored zero
    characters of text for both accounts — but the og/description tags survive
    the wall and carry the display name, the follower counts and the bio. That
    is the whole yield, and it is reported as such rather than dressed up.
    """
    metas = _metas(capture.html)
    result = ParseResult()
    claims: list[Claim] = []

    og_url, og_url_tag = metas.get("og:url", ("", ""))
    og_title, og_title_tag = metas.get("og:title", ("", ""))
    # og:description carries the counts; name=description carries counts + bio.
    counts_source = metas.get("og:description", ("", ""))[0]
    bio_source = metas.get("description", ("", ""))[0]

    if og_url:
        claims.append(Claim(field="project.social", value=squash(og_url),
                            raw=og_url_tag, note="instagram"))

    handle = _HANDLE_TITLE_RE.match(squash(og_title)) if og_title else None
    if handle:
        display = squash(handle.group(1))
        field_path = _INSTAGRAM_SUBJECT.get(capture.source_id)
        if field_path and display:
            claims.append(Claim(
                field=field_path, value=display, raw=og_title_tag,
                note="Instagram account display name (og:title); the account's own "
                     "capitalisation, no legal-form suffix",
            ))

    counts = _COUNTS_RE.search(counts_source or bio_source)
    if counts:
        followers, following, posts = (_as_number(parse_amount(group)) for group in counts.groups())
        result.unparsed.append(
            f"{capture.source_id}: {followers} followers, {following} following, {posts} posts "
            f"(read from {'og:description' if counts_source else 'meta description'}; "
            "there is no audience field in the dataset)"
        )

    for line in _bio_lines(bio_source):
        handled = False
        # Only the developer account speaks for the project. The hotel account's
        # number is a reception line and AzuraHotel has no contact field, so it
        # is surfaced rather than filed under project.contact.
        if capture.source_id == "instagram-cebecigroup":
            for claim in _founded_year_claims(line, "Instagram bio"):
                claim.raw = line
                claims.append(claim)
                handled = True
            for match in _BIO_PHONE_RE.finditer(line):
                claims.append(Claim(field="project.contact.phone", value=squash(match.group(0)),
                                    raw=line, note="Cebeci Group Instagram bio"))
                handled = True
        if not handled:
            label = "bio line"
            if _BIO_PHONE_RE.search(line):
                label = "bio line, contact number - AzuraHotel has no contact field"
            result.unparsed.append(f"{capture.source_id}: {label} - \"{line}\"")

    result.claims = _dedupe(claims)
    result.unparsed.append(
        f"{capture.source_id}: login wall - {len(squash(capture.text))} characters of rendered "
        "text were harvested; every value above was read from <head> meta tags"
    )
    return result


_BIO_RE = re.compile(r"""(?s)\bon Instagram:\s*["“](.*)["”]\s*$""")


def _bio_lines(source: str) -> list[str]:
    """The bio only, without the banner Instagram prefixes to it.

    `meta[name=description]` concatenates the follower counts, the display name
    and the bio into one string. Splitting on the quoted tail is what keeps a
    number the account never wrote out of a line it did.
    """
    if not source:
        return []
    match = _BIO_RE.search(source)
    body = match.group(1) if match else _COUNTS_RE.sub("", source)
    return [squash(line) for line in body.splitlines() if squash(line)]


# ------------------------------------------------------------------ dispatch --

_DISPATCH = {
    "azuraworld-official": _parse_azuraworld_official,
    "cebecigroup-index": _parse_cebecigroup_index,
    "azuraworldhotel": _parse_azuraworldhotel,
    "instagram-cebecigroup": _parse_instagram,
    "instagram-azuraworldhotel": _parse_instagram,
}


def parse(capture: Capture) -> ParseResult:
    handler = _DISPATCH.get(capture.source_id)
    if handler is None:
        # Not this module's capture. An empty result is the correct answer; a
        # guess about an unknown page would be worse than no rows at all.
        return ParseResult()
    return handler(capture)
