"""Tripadvisor, OnTheBeach and the superseded Wyndham host — criterion 4 (W0-B).

Three hosts share one module because they answer the same two questions — what
guests said, and what the property claims about itself — and because two of the
three turned out to be republishing a *fourth* party's score. Reading them
together is what made that visible.

The rule this module exists to enforce
--------------------------------------
`platform` is WHOSE SCORE IT IS, not which host served the page.

  * onthebeach.co.uk renders `<section class="tripadvisor">` around a
    `tripadvisor.com/WidgetEmbed-…&locationId=33144231` link — the same location
    id as our tripadvisor.com capture. Its "4.6/5 from 357 reviews" is
    Tripadvisor's number wearing OnTheBeach's stylesheet.
  * wyndham.antalyacoast.com renders its 6.7 badge with a Booking.com logo and a
    `data-reviews="bcom"` review tab.

Filing either under the serving host would hand the builder two "independent"
hosts stating one figure, which is the input that makes `confidence:
"confirmed"` fire (CONTRACTS §1 invariant 3). One number would be laundered into
two, and the laundering would be invisible. So a syndicated score is emitted
under the platform that produced it, and a score whose provenance cannot be read
off the page is not emitted at all — see `_attributed_platform`.

Everything else follows base.py's contract: report what one page said plus the
substring it was read from, and never decide who is right. Tripadvisor's 188
rooms against this host's 112, and 16 aquapark slides against SOURCES.md's 13,
are real disagreements. Both sides go in unaltered; resolving them is the
builder's job.

F-007: `wyndham-antalyacoast` is the SUPERSEDED brand URL, so it may not set
`hotel.name`. As it happens its body no longer says "Wyndham" anywhere — only
the hostname does — so it yields no `hotel.formerName` either. What it *does*
name the property is recorded in `unparsed`, because an observation we chose not
to promote is still an observation.

Quotes are verbatim or they are not stored. There is no selection step in
`_tripadvisor_quotes`: every review card on the page is taken, in document
order. SOURCES.md §4 records this property's sentiment as polarised at both
ends, and a parser that returned the reviews it liked would be writing
marketing, not evidence.
"""

from __future__ import annotations

import html as html_module
import re
from typing import Any

from .base import (
    Capture,
    Claim,
    ParseResult,
    ReviewObservation,
    fold,
    parse_amount,
    squash,
    strip_tags,
)

HOST = "multi"
SOURCE_IDS = ["tripadvisor", "onthebeach", "wyndham-antalyacoast"]


# ------------------------------------------------------------------ surface --

_SCRIPTISH_RE = re.compile(r"(?is)<(script|style|noscript|template)[^>]*>.*?</\1>")
_COMMENT_RE = re.compile(r"(?s)<!--.*?-->")
_BLOCK_BREAK_RE = re.compile(r"(?i)<br\s*/?>|</(?:p|div|li|h[1-6]|tr)\s*>")
_TAG_RE = re.compile(r"(?s)<[^>]+>")


def _surface(capture: Capture) -> str:
    """The squashed page text — what a human actually saw, on one line.

    Prefers `capture.text` (the browser's rendered innerText, so it reflects the
    page after JS ran) and falls back to the markup. Squashing first keeps every
    pattern below free of line-break alternatives.
    """
    rendered = squash(capture.text)
    return rendered if len(rendered) >= 200 else strip_tags(capture.html)


def _plain(fragment: str) -> str:
    """HTML fragment -> paragraph-preserving plain text, for verbatim quotes.

    base.strip_tags() is right for MATCHING and squashes everything onto one
    line. That is wrong for a review: the reviewer wrote paragraphs and
    Tripadvisor stores them as `<br>`. Collapsing them changes no word, but it
    turns a 400-word complaint into an unreadable wall.

    The order is not interchangeable — tags are removed BEFORE entities are
    unescaped. Unescaping first would turn a `&lt;script&gt;` a reviewer
    literally typed into a real tag, which the tag stripper would then delete:
    silently editing someone's review. Output is plain text by construction,
    which is what downstream needs — `dangerouslySetInnerHTML` is banned.
    """
    if not fragment:
        return ""
    text = _SCRIPTISH_RE.sub(" ", fragment)
    text = _COMMENT_RE.sub(" ", text)
    text = _BLOCK_BREAK_RE.sub("\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html_module.unescape(text)
    lines = [re.sub(r"[^\S\n]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _excerpt(text: str, start: int, end: int, pad: int = 90) -> str:
    """A window around a match. This is what a Claim carries as `raw`, so a
    reviewer can see the sentence a number came out of without refetching."""
    return squash(text[max(0, start - pad): end + pad])


def _join_raw(*fragments: str) -> str:
    """Several literal page substrings, each kept literal, joined for one `raw`.

    Needed where a value and its attribution live 90 KB apart — a score in
    JSON-LD, the logo that says whose score it is much further down. Both halves
    stay verbatim; nothing is ever summarised into `raw`.
    """
    return " | ".join(squash(f) for f in fragments if squash(f))


def _number(raw: str) -> float | int | None:
    """parse_amount, narrowed to int when integral.

    5.0 and 5 are the same JSON number, but the generated TS literal is read by
    humans, and `stars: 5` is worth the two lines. Locale/grouping handling
    stays entirely in base.parse_amount.
    """
    value = parse_amount(raw)
    if value is None:
        return None
    return int(value) if float(value).is_integer() else value


# -------------------------------------------------------------------- links --

def _origin_of(url: str) -> str:
    match = re.match(r"(?i)^(https?://[^/?#]+)", url or "")
    return match.group(1) if match else ""


def _absolutise(href: str, base_url: str) -> str:
    """Review permalinks are root-relative. A citation you cannot re-open is not
    a citation (CONTRACTS §1 rule 6), so they are resolved against the capture."""
    href = squash(href)
    if not href:
        return ""
    if href.startswith(("http://", "https://")):
        return href
    if href.startswith("//"):
        return "https:" + href
    root = _origin_of(base_url)
    if not root:
        return href
    return root + (href if href.startswith("/") else "/" + href)


# ------------------------------------------------------------------ JSON-LD --

# Regex rather than json.loads, deliberately. These blocks arrive with escaped
# solidi (`https://…`), inconsistent whitespace, and numbers that are
# quoted on one host and bare on the next; we want two scalars out of a known
# flat object, and the brief limits this module to `re` + `html`. Every
# schema.org object read here is flat, so `[^}]*` is a safe object body — the
# scoping matters, because `ratingValue` appears in BOTH aggregateRating and
# starRating and reading the wrong one turns a 5-star hotel into a 5.0 score.

def _ld_object(html: str, key: str) -> str:
    match = re.search(r'"%s"\s*:\s*\{[^}]*\}' % re.escape(key), html or "")
    return match.group(0) if match else ""


def _ld_scalar(block: str, key: str) -> str:
    match = re.search(r'"%s"\s*:\s*"?([^",}]+)"?' % re.escape(key), block or "")
    return squash(match.group(1)) if match else ""


def _ld_string(html: str, key: str) -> str:
    """A quoted string value that may itself contain commas (descriptions)."""
    match = re.search(r'"%s"\s*:\s*"([^"]{2,2000})"' % re.escape(key), html or "")
    return squash(html_module.unescape(match.group(1))) if match else ""


# -------------------------------------------------------------- attribution --

# (platform, marker). First marker found wins; in practice a page carries at
# most one review provider.
_SYNDICATION_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("tripadvisor", re.compile(
        r'(?i)data-testid="trip-advisor-rating"'
        r'|aria-label="Tripadvisor"'
        r'|tripadvisor\.com/WidgetEmbed[^"\'\s]*'
    )),
    ("booking", re.compile(
        r'(?i)data-reviews="bcom"|icon-reviews-bcom|svg-icon-bookingcom'
    )),
)


def _attributed_platform(html: str) -> tuple[str, str]:
    """Return (platform, the literal marker substring), or ("", "").

    Hosts that are not themselves a review platform MUST refuse to emit a score
    when this returns "". Falling back to the serving host's own name is the
    failure this module was written to prevent: an unattributed number becoming
    a second "independent" source for a figure with exactly one origin. A markup
    change should cost us the score and earn a loud line in `unparsed`; it must
    not cost us the truth about where the number came from.
    """
    for platform, pattern in _SYNDICATION_MARKERS:
        match = pattern.search(html or "")
        if match:
            return platform, squash(match.group(0))[:200]
    return "", ""


# --------------------------------------------------------------- rebranding --

# "Azura World Hotel (ex. Wyndham Alanya)" — the parenthetical IS the rebrand
# statement (F-007), so it is parsed as two facts rather than kept as one name.
_EX_BRAND_RE = re.compile(
    r"\(\s*(?:ex\.?|ehem\.?|formerly|früher|eski)\s+([^)]{2,60}?)\s*\)", re.IGNORECASE
)
# Tripadvisor's About blurb still calls the property "Wyndham Alanya Hotel"
# while the listing title says "Azura World Hotel". That is stale operator copy,
# not a listing title — but it is a primary statement of the former brand.
# F-007 names exactly this brand, so the pattern is scoped to it instead of
# guessing at brand names in general and mistaking a neighbouring hotel for one.
_WYNDHAM_ALANYA_RE = re.compile(r"\bWyndham\s+Alanya\b", re.IGNORECASE)


def _strip_ex_brand(name: str) -> str:
    return squash(_EX_BRAND_RE.sub("", name))


# ------------------------------------------------------------------- claims --

def _add_claim(result: ParseResult, field: str, value: Any, raw: str,
               note: str | None = None, unit: str | None = None) -> None:
    """One Claim per distinct (field, value).

    The same fact appears twice on most of these pages — once in JSON-LD, once
    in visible copy. Two identical claims from ONE page are not two sources, and
    letting both through would inflate the agreement count the builder reasons
    over. Two *different* values for one field both survive: suppressing either
    would be resolving a disagreement, which is not this module's job.
    """
    if value is None or (isinstance(value, str) and not value.strip()):
        return
    for existing in result.claims:
        if existing.field == field and existing.value == value:
            return
    result.claims.append(
        Claim(field=field, value=value, raw=squash(raw)[:600], note=note, unit=unit)
    )


def _surfaced(result: ParseResult, line: str) -> None:
    if line not in result.unparsed:
        result.unparsed.append(line)


# ------------------------------------------------------------------- slides --

_AQUAPARK_CONTEXT = ("aquapark", "aqua park", "water", "wasser", "su parki")
_SLIDES_RE = re.compile(r"(?i)\b(\d{1,3})\s+(?:\w+[\s-]+){0,2}?(?:water[-\s]?)?slides?\b")


def _find_slides(text: str) -> tuple[int, str] | None:
    """A slide count only counts when the sentence is about the aquapark.

    `hotel.aquaparkSlides` is a specific field; a slide in a playground or a
    spa sentence is a different object. The context gate is cheap insurance
    against a marketing page that counts both.
    """
    for match in _SLIDES_RE.finditer(text):
        window = fold(text[max(0, match.start() - 90): match.end() + 40])
        if any(word in window for word in _AQUAPARK_CONTEXT):
            return int(match.group(1)), _excerpt(text, match.start(), match.end())
    return None


# -------------------------------------------------------------- tripadvisor --

_TA_BUBBLE_SCALE_RE = re.compile(r"(?i)\bof\s+(\d+)\s+bubbles\b")
_TA_RANK_HTML_RE = re.compile(r">\s*(#\s*\d+\s+of\s+\d+\s+hotels?\s+in\s+[^<]{1,60}?)\s*<")
# Tail is letter-only on purpose: squashed text runs the ranking straight into
# the hotel's phone number, and a greedy tail would quote "Turkler 00 90 242…".
_TA_RANK_TEXT_RE = re.compile(r"#\s*\d+\s+of\s+\d+\s+hotels?\s+in\s+[A-Za-zÀ-ɏ' -]{1,40}")
_TA_HISTOGRAM_RE = re.compile(
    r"(?i)Excellent\s+([\d.,]+)\s+Good\s+([\d.,]+)\s+Average\s+([\d.,]+)"
    r"\s+Poor\s+([\d.,]+)\s+Terrible\s+([\d.,]+)"
)
_TA_STARS_RE = re.compile(r"(?i)\b(\d)\s+of\s+5\s+stars\b")
_TA_ROOMS_RE = re.compile(r"(?i)NUMBER OF ROOMS\s+([\d.,]+)")
_TA_LODGING_NAME_RE = re.compile(
    r'"@type"\s*:\s*"LodgingBusiness".{0,400}?"name"\s*:\s*"([^"]{2,80})"', re.DOTALL
)
_TA_ABOUT_RE = re.compile(
    r'(?is)<div[^>]*data-automation="aboutTabDescription".{0,4000}?</div></div>'
)
# Airport distances here are stated in MILES and are project-level; CONTRACTS §2 has
# no hotel.* path for them, so they are surfaced rather than force-fitted.
_TA_AIRPORT_RE = re.compile(r"(?i)([A-Za-zÀ-ɏ\-' ]{3,30}?Airport)\s+([\d.,]+)\s*(mi|km)\b")

_TA_CARD_MARKER = 'data-test-target="HR_CC_CARD"'
_TA_CARD_RATING_RE = re.compile(
    r'(?is)data-automation="bubbleRatingImage"[^>]*>\s*<title[^>]*>\s*([\d.,]+)\s+of\s+(\d+)\s+bubbles'
)
_TA_CARD_TITLE_RE = re.compile(
    r'(?is)data-test-target="review-title".{0,200}?<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
)
_TA_CARD_BODY_RE = re.compile(r'(?is)<span class="JguWG">(.*?)</span>\s*</div>\s*</div>')
_TA_CARD_AUTHOR_RE = re.compile(
    r'(?is)<span[^>]*>([^<]{1,80})</span>\s*</a>\s*</span>\s*wrote a review'
    r'\s*(?:<!--.*?-->)?\s*([^<]{1,24})<'
)


def _parse_tripadvisor(capture: Capture) -> ParseResult:
    result = ParseResult()
    html = capture.html or ""
    text = _surface(capture)

    aggregate = _ld_object(html, "aggregateRating")
    score = parse_amount(_ld_scalar(aggregate, "ratingValue"))
    count = _number(_ld_scalar(aggregate, "reviewCount"))

    # The scale is READ, never assumed. Tripadvisor spells it out beside the
    # number ("4.6 of 5 bubbles") and publishes no bestRating in its JSON-LD.
    # A 4.6 filed as /10 would turn a well-reviewed hotel into a bad one, and
    # the mistake would look entirely plausible in the UI.
    scale_match = _TA_BUBBLE_SCALE_RE.search(text) or _TA_BUBBLE_SCALE_RE.search(html)
    scale = int(scale_match.group(1)) if scale_match else None

    # Preferred from the markup, where the ranking is its own element and therefore
    # tag-bounded; the text fallback needs its own tail rule (see the pattern).
    rank_html = _TA_RANK_HTML_RE.search(html)
    rank_text = _TA_RANK_TEXT_RE.search(text)
    ranking = squash(rank_html.group(1)) if rank_html else (
        squash(rank_text.group(0)) if rank_text else None)

    sentiment = None
    histogram = _TA_HISTOGRAM_RE.search(text)
    if histogram:
        buckets = [int(_number(group) or 0) for group in histogram.groups()]
        excellent, good, average, poor, terrible = buckets
        # Both shapes are stored, and nothing is discarded either way. The five
        # keys are Tripadvisor's own bucket labels — the lossless record. The
        # three-way fold is added because CONTRACTS §2 ReviewSource.sentiment
        # has exactly that shape; the fold is a fact about Tripadvisor's scale
        # (its own names for its own buckets), not a judgement about this hotel.
        # Stating it here beats the builder inventing a mapping later.
        sentiment = {
            "excellent": excellent, "good": good, "average": average,
            "poor": poor, "terrible": terrible,
            "positive": excellent + good, "mixed": average,
            "negative": poor + terrible,
        }
        if count is not None and sum(buckets) != count:
            _surfaced(result, (
                f"tripadvisor: histogram sums to {sum(buckets)} but the page states "
                f"{count} reviews. Both reported as found; not reconciled here."
            ))

    quotes = _tripadvisor_quotes(capture, result)

    if score is not None and scale is not None:
        result.reviews.append(ReviewObservation(
            platform="tripadvisor",
            score=score,
            score_scale=scale,
            review_count=int(count) if count is not None else None,
            ranking=ranking,
            url=capture.final_url,
            raw=_join_raw(
                aggregate,
                scale_match.group(0) if scale_match else "",
                ranking or "",
                histogram.group(0) if histogram else "",
            ),
            sentiment=sentiment,
            quotes=quotes,
        ))
    else:
        # Never invent a score. No stated value or no stated scale, no
        # observation — and a line loud enough to become a [GAP] in the report.
        _surfaced(result, (
            "tripadvisor: no aggregate score/scale readable "
            f"(score={score!r}, scale={scale!r}). Reported as a GAP, not guessed."
        ))

    name = _TA_LODGING_NAME_RE.search(html)
    if name:
        _add_claim(result, "hotel.name",
                   _strip_ex_brand(html_module.unescape(name.group(1))), name.group(0))

    stars = _TA_STARS_RE.search(text)
    if stars:
        _add_claim(result, "hotel.stars", int(stars.group(1)),
                   _excerpt(text, stars.start(), stars.end()),
                   note="Tripadvisor states this class is assigned by Giata, not by Tripadvisor.")

    rooms = _TA_ROOMS_RE.search(text)
    if rooms:
        _add_claim(result, "hotel.roomCount", _number(rooms.group(1)),
                   _excerpt(text, rooms.start(), rooms.end()))

    about = _TA_ABOUT_RE.search(html)
    if about:
        about_text = _plain(about.group(0))
        former = _WYNDHAM_ALANYA_RE.search(about_text)
        if former:
            _add_claim(
                result, "hotel.formerName", "Wyndham Alanya",
                _excerpt(about_text, former.start(), former.end(), pad=170),
                note=("From the property's own About description, which still reads 'Wyndham "
                      "Alanya Hotel' while the listing title reads 'Azura World Hotel'. The "
                      "brand token is normalised off the '… Hotel' suffix so it matches the "
                      "'(ex. Wyndham Alanya)' marker other hosts publish; the full sentence "
                      "is in raw. Stale operator copy (F-007) — historical, not current."),
            )
        if re.search(r"(?i)renowned Wyndham quality", about_text):
            _surfaced(result, (
                "tripadvisor: About copy also says 'Blending the renowned Wyndham quality'. "
                "NOT emitted as hotel.brandAffiliation — it is stale marketing prose rather "
                "than a stated affiliation, and F-007 records the licence as dropped. "
                "Surfaced so the builder decides, not this parser."
            ))

    for airport, distance, unit in _TA_AIRPORT_RE.findall(text):
        _surfaced(result, (
            f"tripadvisor: {squash(airport)} {distance} {unit} — a project-level distance "
            "stated in miles; no hotel.* path in CONTRACTS §2 holds it, and it is NOT "
            "converted here."
        ))
    return result


def _tripadvisor_quotes(capture: Capture, result: ParseResult) -> list[dict[str, Any]]:
    """Every review card on the page, in document order. No selection at all.

    Selecting a subset IS cherry-picking whatever the intent, so there is no
    selection step: if it is a review card, it becomes a quote. The page's
    `recent-positive-reviews` carousel is deliberately NOT read — it is
    Tripadvisor's own 5-bubble-only shortlist and folding it in would tilt the
    set positive by construction. The omission is recorded rather than silent.
    """
    html = capture.html or ""
    quotes: list[dict[str, Any]] = []

    for index, chunk in enumerate(html.split(_TA_CARD_MARKER)[1:]):
        body = _TA_CARD_BODY_RE.search(chunk)
        if not body:
            _surfaced(result, f"tripadvisor: review card #{index + 1} had no readable body.")
            continue
        text = _plain(body.group(1))
        if not text:
            continue

        title_match = _TA_CARD_TITLE_RE.search(chunk)
        rating_match = _TA_CARD_RATING_RE.search(chunk)

        # A card carries its overall bubble rating BEFORE the headline and its
        # per-category sub-ratings after the body. Taking "the first rating in
        # the card" is only correct while that holds, so the position is
        # checked: a sub-rating misread as the overall would attach a 3 to a
        # 5-bubble review, which is a distortion of a real person's opinion.
        rating: float | int | None = None
        if rating_match and title_match and rating_match.start() < title_match.start():
            rating = _number(rating_match.group(1))
        elif rating_match:
            _surfaced(result, (
                f"tripadvisor: review card #{index + 1} — bubble rating did not precede the "
                "headline, so it may be a per-category score. Rating left null rather than "
                "guessed."
            ))

        # `date` is the page's literal published-date string. Tripadvisor omits
        # the year for the current year ("Jul 21"); widening that to
        # "2026-07-21" from the fetch timestamp would be an inference, and this
        # is a parser. The literal string is what the page said.
        author_match = _TA_CARD_AUTHOR_RE.search(chunk)
        author = squash(author_match.group(1)) if author_match else ""
        date = squash(author_match.group(2)) if author_match else ""

        url = (_absolutise(title_match.group(1), capture.final_url)
               if title_match else capture.final_url)
        headline = _plain(title_match.group(2)) if title_match else ""

        quotes.append({
            "text": text,        # verbatim; never paraphrased, never truncated
            "rating": rating,
            "date": date,
            "url": url,
        })

        # The headline is verbatim too and is often the sharpest line in the
        # review, but the frozen quote shape has no title key and an extra key
        # would break the generated TS object literal. Surfaced, never dropped.
        if headline:
            _surfaced(result, (
                f"tripadvisor review headline (rating={rating}, date={date!r}, "
                f"author={author!r}, {url}): {headline!r}"
            ))

    if 'data-test-target="recent-positive-reviews"' in html:
        _surfaced(result, (
            "tripadvisor: the 'Why guests love this hotel' block (publisher-curated, "
            "5-bubble reviews only) was deliberately NOT read — including it would tilt the "
            "quote set positive by construction. Full review cards used instead."
        ))

    showing = re.search(r"(?i)Showing results\s+[\d–-]+\s+of\s+[\d,]+", _surface(capture))
    if showing:
        _surfaced(result, (
            f"tripadvisor: only the first review page was captured — "
            f"{squash(showing.group(0))}. The remaining pages are a GAP."
        ))
    return quotes


# --------------------------------------------------------------- onthebeach --

_OTB_SCORE_RE = re.compile(
    r"(?i)\(?\s*(\d+(?:[.,]\d+)?)\s*/\s*(\d+)\s*\)?[^\d]{0,20}?([\d.,]+)\s+reviews\b"
)
_OTB_H1_RE = re.compile(r"(?is)<h1[^>]*>(.*?)</h1>")


def _parse_onthebeach(capture: Capture) -> ParseResult:
    result = ParseResult()
    html = capture.html or ""
    text = _surface(capture)

    platform, marker = _attributed_platform(html)
    score_match = _OTB_SCORE_RE.search(text)

    if score_match and platform:
        count = _number(score_match.group(3))
        result.reviews.append(ReviewObservation(
            platform=platform,
            score=parse_amount(score_match.group(1)),
            score_scale=int(score_match.group(2)),
            review_count=int(count) if count is not None else None,
            ranking=None,
            url=capture.final_url,
            raw=_join_raw(_excerpt(text, score_match.start(), score_match.end(), pad=24), marker),
            sentiment=None,
            quotes=[],
        ))
        if platform != "onthebeach":
            _surfaced(result, (
                f"onthebeach: the {score_match.group(1)}/{score_match.group(2)} figure is a "
                f"SYNDICATED {platform} widget (marker: {marker[:120]}), not an OnTheBeach "
                "score. Filed under that platform on purpose — counting it as a second "
                "independent host would manufacture agreement out of a single number."
            ))
    elif score_match:
        _surfaced(result, (
            f"onthebeach: a score was visible ({squash(score_match.group(0))}) but no "
            "review-provider attribution marker was found, so NO ReviewObservation was "
            "emitted. Attribution is required before a number on a reseller page may be "
            "filed under any platform."
        ))
    else:
        _surfaced(result, "onthebeach: no aggregate score found on the page.")

    _surfaced(result, (
        "onthebeach: the page carries NO independent OnTheBeach guest score — its entire "
        "review section is the embedded Tripadvisor widget. platform='onthebeach' is a GAP."
    ))

    h1 = _OTB_H1_RE.search(html)
    listed = _plain(h1.group(1)) if h1 else _ld_string(html, "name")
    if listed:
        _add_claim(result, "hotel.name", _strip_ex_brand(listed), listed)
        former = _EX_BRAND_RE.search(listed)
        if former:
            _add_claim(result, "hotel.formerName", squash(former.group(1)), listed,
                       note=("Published by the reseller as an explicit rebrand marker "
                             "'(ex. …)' in the listing title itself — F-007."))

    star_block = _ld_object(html, "starRating")
    _add_claim(result, "hotel.stars", _number(_ld_scalar(star_block, "ratingValue")), star_block)

    slides = _find_slides(text)
    if slides:
        _add_claim(result, "hotel.aquaparkSlides", slides[0], slides[1])

    # Traps deliberately NOT turned into claims:
    #   "12 mins' walk to the beach" — a duration, not hotel.distanceToBeachM;
    #   "125m of golden sands"       — beach FRONTAGE, not distance to it.
    # Converting either into metres would produce a plausible number no source
    # states, which is precisely the failure this project exists to prevent.
    for pattern, why in (
        (r"(?i)\d+\s*mins?[’'`]?\s*walk to the beach", "walking time, not a distance"),
        (r"(?i)\d+\s*m\s+of\s+golden\s+sands", "beach frontage length, not distance to beach"),
    ):
        hit = re.search(pattern, text)
        if hit:
            _surfaced(result, (
                f"onthebeach: '{squash(hit.group(0))}' NOT mapped to hotel.distanceToBeachM "
                f"({why})."
            ))
    return result


# ---------------------------------------------------- wyndham-antalyacoast --

_WYN_ROOMS_RE = re.compile(r"(?i)\b([\d.,]{1,6})\s+rooms?\b")
_WYN_CHECKIN_RE = re.compile(r'"checkinTime"\s*:\s*"([^"]{3,30})"')
_WYN_CHECKOUT_RE = re.compile(r'"checkoutTime"\s*:\s*"([^"]{3,30})"')
# Non-greedy, so this finds the NEAREST "name" after the Hotel type. The window is
# wide because this host puts a 250-character description and a full address between
# the two keys.
_WYN_NAME_RE = re.compile(r'"@type"\s*:\s*"Hotel".{0,2500}?"name"\s*:\s*"([^"]{2,90})"', re.DOTALL)
_HEAD_RE = re.compile(r"(?is)<head.*?</head>")

_HISTORICAL = ("Read from wyndham.antalyacoast.com — the SUPERSEDED Wyndham-brand URL for "
               "this property (F-007). Historical evidence, not the current identity.")


def _parse_wyndham_antalyacoast(capture: Capture) -> ParseResult:
    """The superseded-brand host. Two hard rules apply.

    1. It must not set `hotel.name`. As captured, its body no longer says
       "Wyndham" at all — only the hostname and the canonical/hreflang URLs do —
       so it also yields no `hotel.formerName`. Both observations go to
       `unparsed`, which is itself corroboration that the branding was dropped.
    2. Its 6.7 badge is a Booking.com score, not this host's own.
    """
    result = ParseResult()
    html = capture.html or ""
    text = _surface(capture)

    platform, marker = _attributed_platform(html)
    aggregate = _ld_object(html, "aggregateRating")
    score = parse_amount(_ld_scalar(aggregate, "ratingValue"))
    count = _number(_ld_scalar(aggregate, "reviewCount"))
    # bestRating is stated here, so the scale is parsed rather than inferred
    # from the shape of the number. 6.7 means nothing until you know it is /10 —
    # read as /5 it would be off the top of the scale and read as a 5-star rave.
    best = _number(_ld_scalar(aggregate, "bestRating"))
    scale = int(best) if best else None

    if score is not None and scale is not None and platform:
        result.reviews.append(ReviewObservation(
            platform=platform,
            score=score,
            score_scale=scale,
            review_count=int(count) if count is not None else None,
            ranking=None,
            url=capture.final_url,
            raw=_join_raw(aggregate, marker),
            sentiment=None,
            quotes=[],
        ))
        _surfaced(result, (
            f"wyndham-antalyacoast: the {score}/{scale} badge is a SYNDICATED {platform} "
            f"score (marker: {marker[:120]}) shown on a superseded-brand reseller page. "
            "Filed under that platform, not under the serving host."
        ))
    else:
        _surfaced(result, (
            "wyndham-antalyacoast: no ReviewObservation emitted "
            f"(score={score!r}, scale={scale!r}, attribution={platform!r}). A score without "
            "a stated scale or a named provider is a GAP, not a guess."
        ))

    if re.search(r"(?i)bcom-reviews-item|js-bcom-review-item", html):
        _surfaced(result, (
            "wyndham-antalyacoast: the individual review list is an empty client-side "
            "<template> — the snapshot contains no review text at all. Verbatim quotes "
            "from this host are a GAP."
        ))

    star_block = _ld_object(html, "starRating")
    _add_claim(result, "hotel.stars", _number(_ld_scalar(star_block, "ratingValue")),
               star_block, note=_HISTORICAL)

    # The schema.org description is the densest factual sentence on the page and
    # is preferred over the flattened text, where "rooms" also appears in
    # navigation ("Rooms & Availability") and facility lists.
    description = _ld_string(html, "description")
    source_text = description or text

    rooms = _WYN_ROOMS_RE.search(source_text)
    if rooms:
        _add_claim(result, "hotel.roomCount", _number(rooms.group(1)),
                   _excerpt(source_text, rooms.start(), rooms.end()), note=_HISTORICAL)

    slides = _find_slides(source_text) or _find_slides(text)
    if slides:
        _add_claim(result, "hotel.aquaparkSlides", slides[0], slides[1], note=_HISTORICAL)

    # checkinTime is a WINDOW ("14:00-23:59"). hotel.checkIn is the time from
    # which check-in is possible, so the opening bound is the value and the full
    # window stays in raw — nothing is lost, and the value stays comparable with
    # other sources that publish a single time.
    checkin = _WYN_CHECKIN_RE.search(html)
    if checkin:
        start = re.match(r"\s*(\d{1,2}:\d{2})", checkin.group(1))
        if start:
            _add_claim(result, "hotel.checkIn", start.group(1), checkin.group(0),
                       note=_HISTORICAL)
    checkout = _WYN_CHECKOUT_RE.search(html)
    if checkout:
        end = re.search(r"(\d{1,2}:\d{2})", checkout.group(1))
        if end:
            _add_claim(result, "hotel.checkOut", end.group(1), checkout.group(0),
                       note=_HISTORICAL)

    name = _WYN_NAME_RE.search(html)
    if name:
        _surfaced(result, (
            f"wyndham-antalyacoast: page names the property {squash(name.group(1))!r}. NOT "
            "emitted as hotel.name — the superseded-brand host must not set the current "
            "identity (F-007). Recorded here so the observation is not lost."
        ))
    if not _WYNDHAM_ALANYA_RE.search(strip_tags(_HEAD_RE.sub(" ", html))):
        _surfaced(result, (
            "wyndham-antalyacoast: 'Wyndham' appears ONLY in the hostname and the "
            "canonical/hreflang URLs — the page body carries no Wyndham branding. This host "
            "therefore yields no hotel.formerName evidence, and it independently corroborates "
            "F-007's finding that the Wyndham branding was dropped."
        ))

    licence = re.search(r"(?i)Licence number\s*(\d{4,10})", text)
    if licence:
        _surfaced(result, (
            f"wyndham-antalyacoast: Turkish tourism licence number {licence.group(1)} — no "
            "field in CONTRACTS §2 holds it."
        ))
    return result


# -------------------------------------------------------------------- entry --

_DISPATCH = {
    "tripadvisor": _parse_tripadvisor,
    "onthebeach": _parse_onthebeach,
    "wyndham-antalyacoast": _parse_wyndham_antalyacoast,
}


def parse(capture: Capture) -> ParseResult:
    handler = _DISPATCH.get(capture.source_id)
    if handler is None:
        # The builder routes by SOURCE_IDS, so reaching here is a wiring bug and
        # not a data problem. Say so, rather than returning a silent empty result
        # that looks like a page with nothing on it.
        result = ParseResult()
        result.unparsed.append(
            f"reviews.py received source_id {capture.source_id!r}, which it does not handle. "
            f"Handled: {', '.join(SOURCE_IDS)}."
        )
        return result
    return handler(capture)
