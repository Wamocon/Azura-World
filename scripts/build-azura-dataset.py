#!/usr/bin/env python3
"""build-azura-dataset.py — sources/raw/ -> AzuraWorldDataset (W0-B).

Turns validated snapshots into the typed dataset the app renders:

    apps/web/lib/azura-world-data.ts
    supabase/imports/azura-project-baseline.sql
    supabase/imports/azura-units-master.csv

Division of labour, and the reason this file is not a scraper:

  * per-host parser modules (scripts/azura_parsers/*.py) know MARKUP;
  * this file knows PROVENANCE — tiers, agreement, disagreement, confidence.

Parsers are called inside try/except individually, so one publisher rewriting
their markup costs that host's claims and nothing else.

The rule the whole file exists to enforce (SYSTEM-PROMPT §2.2):

    NEVER SILENTLY RESOLVE A CONFLICT BETWEEN SOURCES.

When sources disagree, the display value follows tier order, and the losing
value is still stored, still cited, and still visible on demand. Nothing is
averaged. Nothing is quietly dropped for looking wrong.

Usage:
    python scripts/build-azura-dataset.py [--strict] [--quiet]
      --strict   exit non-zero on any invariant violation (CI uses this)
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import json
import re
import sys
import traceback
from collections import defaultdict
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

from azura_parsers.base import (  # noqa: E402
    Capture,
    Claim,
    ParseResult,
    UnitObservation,
    fold,
    squash,
)

MANIFEST = ROOT / "sources" / "manifest.json"
HARVEST_FINDINGS = ROOT / "sources" / "harvest-findings.json"
CONFIG = SCRIPTS / "sources.config.json"

TS_OUT = ROOT / "apps" / "web" / "lib" / "azura-world-data.ts"
SQL_OUT = ROOT / "supabase" / "imports" / "azura-project-baseline.sql"
CSV_OUT = ROOT / "supabase" / "imports" / "azura-units-master.csv"
DEBUG_OUT = ROOT / "sources" / "claims-debug.json"

PARSER_MODULES = ["official", "portal_de", "haspo", "reviews", "secondary"]

CONTRACT_VERSION = 1
TOTAL_UNITS_TARGET = 656
BLOCK_COUNT = 7
FLOORS_PER_BUILDING = 6


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# ------------------------------------------------------------------ loading --


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_captures() -> list[Capture]:
    manifest = load_json(MANIFEST)

    # Publisher-level flags come from the CONFIG, not from the manifest snapshot.
    # isStale is a property of the publisher (F-006 says Haspo's inventory is two
    # years out of date), so it must not depend on which locale of their page was
    # harvested or on whether the manifest predates the flag being set. Reading it
    # here means correcting the register takes effect on the next build rather
    # than requiring a full re-harvest.
    config = load_json(CONFIG)
    flags: dict[str, dict] = {}
    for source in [*config.get("sources", []), *config.get("unitListingSources", [])]:
        flags[source["id"]] = source
    def flag_for(source_id: str, key: str, fallback):
        own = flags.get(source_id)
        if own is None and "-" in source_id:  # a followed unit page inherits its parent's flags
            own = flags.get(source_id.rsplit("-", 1)[0])
        return own.get(key, fallback) if own else fallback

    captures: list[Capture] = []
    for entry in manifest.get("entries", []):
        if not entry.get("contentValidated"):
            continue
        snapshot = entry.get("snapshotPath")
        if not snapshot:
            continue
        html_path = ROOT / snapshot
        text_path = ROOT / (entry.get("textPath") or "")
        if not html_path.exists():
            continue
        captures.append(
            Capture(
                source_id=entry["id"],
                publisher=entry.get("publisher", ""),
                tier=int(entry.get("tier", 6)),
                url=entry.get("url", ""),
                final_url=entry.get("finalUrl") or entry.get("url", ""),
                locale=entry.get("locale", "en"),
                fetched_at=entry.get("fetchedAt", ""),
                snapshot_path=snapshot,
                snapshot_hash=entry.get("snapshotHash") or "",
                html=html_path.read_text(encoding="utf-8", errors="replace"),
                text=text_path.read_text(encoding="utf-8", errors="replace")
                if text_path.exists()
                else "",
                price_kind=flag_for(entry["id"], "priceKind", entry.get("priceKind", "sale")),
                is_stale=bool(flag_for(entry["id"], "isStale", entry.get("isStale", False))),
                parent_id=entry.get("parentId"),
            )
        )
    return captures


def load_parsers() -> list[Any]:
    modules = []
    for name in PARSER_MODULES:
        try:
            modules.append(importlib.import_module(f"azura_parsers.{name}"))
        except Exception as error:  # a missing parser is reported, never fatal
            print(f"  ! parser module {name} unavailable: {error}", file=sys.stderr)
    return modules


def parser_for(modules: list[Any], source_id: str) -> Any | None:
    for module in modules:
        if source_id in getattr(module, "SOURCE_IDS", []):
            return module
        for prefix in getattr(module, "SOURCE_ID_PREFIXES", []):
            if source_id.startswith(prefix):
                return module
    return None


# --------------------------------------------------------------- provenance --


def source_ref(capture: Capture) -> dict[str, Any]:
    return {
        "url": capture.final_url or capture.url,
        "publisher": capture.publisher,
        "fetchedAt": capture.fetched_at,
        "snapshotHash": capture.snapshot_hash,
        "tier": capture.tier,
    }


def host_of(url: str) -> str:
    match = re.match(r"https?://([^/]+)", url or "")
    return match.group(1).lower().removeprefix("www.") if match else "unknown"


_DATE_FIELDS = ("constructionStart", "completionDate")


def value_key(field: str, value: Any) -> str:
    """Canonical comparison key.

    Numbers compare numerically so 300 and 300.0 are one value, not two. Strings
    compare case- and diacritic-folded so 'Türkler' and 'TURKLER' agree. This is
    matching only — the stored value keeps its original form.
    """
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return f"{float(value):.6g}"
    return fold(str(value))


def merge_partial_dates(groups: dict[str, list[dict]], field: str) -> dict[str, list[dict]]:
    """'May 2024' and '2024-05-30' are the same claim at two precisions.

    Treating them as a disagreement would manufacture a conflict out of a
    formatting difference and bury the real ones. The more precise key absorbs
    the coarser one; the coarse claim keeps its own raw text and citation.
    """
    if not any(field.endswith(suffix) for suffix in _DATE_FIELDS):
        return groups
    keys = sorted(groups, key=len, reverse=True)
    merged: dict[str, list[dict]] = {}
    for key in keys:
        target = next((k for k in merged if k.startswith(key)), None)
        if target:
            merged[target].extend(groups[key])
        else:
            merged[key] = list(groups[key])
    return merged


def build_fact(field: str, records: list[dict], gap_note: str) -> dict[str, Any]:
    """One field's claims -> one SourcedFact, per CONTRACTS.md §1.

    Confidence ladder:
        no claims                       -> gap        (value MUST be null)
        one value, >=2 distinct hosts   -> confirmed
        one value, a tier<=2 host       -> official
        one value, one host             -> single_source
        more than one value             -> conflicted (losers kept, never dropped)
    """
    if not records:
        return {"value": None, "sources": [], "confidence": "gap", "note": gap_note}

    groups: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        groups[value_key(field, record["value"])].append(record)
    groups = merge_partial_dates(dict(groups), field)

    def rank(items: list[dict]) -> tuple:
        best_tier = min(item["tier"] for item in items)
        hosts = len({host_of(item["ref"]["url"]) for item in items})
        # Lower tier wins the display value; more corroborating hosts breaks ties.
        return (best_tier, -hosts, -len(items))

    ordered = sorted(groups.values(), key=rank)
    winner = ordered[0]
    losers = ordered[1:]

    winner_hosts = {host_of(item["ref"]["url"]) for item in winner}
    winner_sources: list[dict] = []
    seen_hashes: set[str] = set()
    for item in winner:
        key = item["ref"]["snapshotHash"] or item["ref"]["url"]
        if key in seen_hashes:
            continue
        seen_hashes.add(key)
        winner_sources.append(item["ref"])

    if losers:
        confidence = "conflicted"
    elif len(winner_hosts) >= 2:
        confidence = "confirmed"
    elif min(item["tier"] for item in winner) <= 2:
        confidence = "official"
    else:
        confidence = "single_source"

    fact: dict[str, Any] = {
        "value": winner[0]["value"],
        "sources": winner_sources,
        "confidence": confidence,
    }

    if losers:
        fact["conflictsWith"] = [
            {"value": item["value"], "source": item["ref"]}
            for group in losers
            for item in group
        ]
        fact["note"] = (
            "Sources disagree. The displayed value is the one from the highest-authority "
            "tier (CONTRACTS.md §1); every competing value is retained above and remains "
            "visible on demand. Nothing was averaged or discarded."
        )
    return fact


def collect_claims(
    captures: list[Capture], modules: list[Any]
) -> tuple[dict[str, list[dict]], list[UnitObservation], list[Any], list[dict]]:
    by_field: dict[str, list[dict]] = defaultdict(list)
    units: list[UnitObservation] = []
    reviews: list[Any] = []
    parser_failures: list[dict] = []

    for capture in captures:
        module = parser_for(modules, capture.source_id)
        if module is None:
            continue
        try:
            result: ParseResult = module.parse(capture)
        except Exception:
            # One host's markup change must not break the others. The failure is
            # recorded as a finding rather than swallowed or allowed to abort.
            parser_failures.append(
                {
                    "sourceId": capture.source_id,
                    "module": module.__name__,
                    "error": squash(traceback.format_exc().splitlines()[-1]),
                }
            )
            continue

        ref = source_ref(capture)
        for claim in result.claims or []:
            if claim.value is None:
                continue  # a parser must omit, not report None; drop defensively
            by_field[claim.field].append(
                {
                    "value": claim.value,
                    "raw": claim.raw,
                    "note": claim.note,
                    "ref": ref,
                    "tier": capture.tier,
                    "sourceId": capture.source_id,
                }
            )
        for unit in result.units or []:
            unit.is_stale = unit.is_stale or capture.is_stale
            if unit.price_kind == "sale" and capture.price_kind != "sale":
                unit.price_kind = capture.price_kind
            units.append((unit, ref, capture))
        for review in result.reviews or []:
            reviews.append((review, ref, capture))

    return by_field, units, reviews, parser_failures


# ----------------------------------------------------------------- findings --


# Overwritten by compose_f002_message() before emit. If this string ever reaches
# an artefact, the composition step did not run and the build must fail rather
# than ship a finding with no numbers in it.
F002_MESSAGE_PLACEHOLDER = "F-002 message not composed"


def _fmt_amount(amount: float) -> str:
    """`112000.0` -> `112,000`. Thousands separators, no decimals."""
    return f"{int(round(amount)):,}"


def compose_f002_message(sale_prices: list[dict]) -> str:
    """Write F-002's message FROM its own competing values.

    ## Why this is computed and not typed

    M-010: the hand-written message said "across four publishers" while the
    record carried nineteen observations across six. `SECURITY-REVIEW.md`
    SEC-006 recorded the same drift and got it wrong in the other direction
    ("carries three"). Three documents disagreed about one array, which is what
    happens when a count is maintained by hand beside data that is rebuilt on
    every harvest. Composing the sentence from the array makes the two incapable
    of disagreeing, and `verify-evidence.mjs` fails the build if they ever do.

    ## Why there is no cross-currency ratio

    M-003 / SEC-007: the previous headline `2.1x` was 239,171 USD divided by
    112,000 EUR, which is a conversion at an implied rate of exactly 1.0. It was
    printed two lines below the concierge sentence saying amounts in different
    currencies are never converted. CONVENTIONS §5 forbids the operation,
    `lib/ai-retrieval.ts` instructs the model never to perform it, and
    `conflictRange()` returns null rather than do it.

    So the ratio here is computed **within EUR only**, over the observations
    whose publisher actually states a 1+1 layout, and the sentence says both of
    those things. The USD observations are stated as their own range and are
    never divided by anything. No rate is applied, because no source in this
    dataset publishes a rate or a rate date.

    ## Why the unlabelled rows are stated separately

    Four rows are portal "price from" entries whose publisher did not attach a
    layout. They belong in the finding (dropping them would quietly narrow the
    spread this finding exists to show) but they are not 1+1 observations, so
    they do not enter the 1+1 ratio. They get their own sentence with their
    publishers named.
    """
    if not sale_prices:
        raise SystemExit("F-002 has no competing values; refusing to compose a message.")

    by_currency: dict[str, list[dict]] = {}
    for entry in sale_prices:
        by_currency.setdefault(entry["value"]["currency"], []).append(entry)

    publishers = sorted({entry["source"]["publisher"] for entry in sale_prices})

    # Rows the publisher labelled 1+1, per currency. These, and only these, are
    # comparable enough to carry a ratio.
    labelled = [e for e in sale_prices if e["value"]["layout"] == "1+1"]
    unlabelled = [e for e in sale_prices if e["value"]["layout"] is None]

    parts: list[str] = [
        f"The 1+1 entry price is unresolved across {len(sale_prices)} observations "
        f"from {len(publishers)} publishers ({', '.join(publishers)})."
    ]

    for currency in sorted({e["value"]["currency"] for e in labelled}):
        rows = sorted(
            (e for e in labelled if e["value"]["currency"] == currency),
            key=lambda e: e["value"]["amount"],
        )
        low, high = rows[0]["value"]["amount"], rows[-1]["value"]["amount"]
        hosts = sorted({r["source"]["publisher"] for r in rows})
        span = (
            f"{_fmt_amount(low)} to {_fmt_amount(high)} {currency}"
            if low != high
            else f"{_fmt_amount(low)} {currency}"
        )
        # The ratio is stated ONLY when it is within one currency, and the
        # sentence names that currency. verify-evidence.mjs recomputes it.
        #
        # A near-identical pair gets a percentage instead: "a factor of 1.0"
        # reads as noise, and the fact worth stating about Housearch's two rows
        # is that one publisher agrees with itself while the EUR publishers do
        # not. Below 5% the ratio is not the interesting number.
        if low <= 0 or high == low:
            ratio = ""
        elif high / low < 1.05:
            ratio = f" Those differ by {(high / low - 1) * 100:.1f}% within {currency}."
        else:
            ratio = f" That is a factor of {high / low:.1f} within {currency} alone."
        parts.append(
            f"In {currency}, the {len(rows)} observations whose publisher states a "
            f"1+1 layout run {span} ({', '.join(hosts)}).{ratio}"
        )

    if len({e["value"]["currency"] for e in labelled}) > 1:
        parts.append(
            "The currencies are NOT converted and NOT compared to each other: no "
            "source in this dataset publishes an exchange rate or a rate date, so "
            "any ratio spanning them would be arithmetic on an invented rate."
        )

    if unlabelled:
        described = ", ".join(
            f"{_fmt_amount(e['value']['amount'])} {e['value']['currency']} "
            f"({e['source']['publisher']})"
            for e in sorted(unlabelled, key=lambda e: e["value"]["amount"])
        )
        parts.append(
            f"A further {len(unlabelled)} rows are portal 'price from' entries whose "
            f"publisher did not attach a layout, so they are carried but excluded "
            f"from the ratio above: {described}."
        )

    stale = sum(1 for e in sale_prices if e["value"]["isStale"])
    parts.append(
        "The causes compound: two currencies, no observation dates, different unit "
        f"subsets, and {stale} of {len(sale_prices)} observations come from listings "
        "flagged stale (F-006)."
    )

    return " ".join(parts)


def seeded_findings(by_field: dict[str, list[dict]]) -> list[dict]:
    """F-001…F-010 are carried over from SOURCES.md §3 verbatim in substance.

    They are seeded rather than re-derived because they encode human judgement
    about WHY sources disagree — that Housearch's block count is an uncorroborated
    outlier, that the hotel's 1 km is a different measurement from the residence's
    300 m. Re-deriving that from markup would lose the reasoning.

    F-002 is the one that must never acquire a resolvedTo.
    """

    def refs(field: str) -> list[dict]:
        return [
            {"value": record["value"], "source": record["ref"]}
            for record in by_field.get(field, [])
        ]

    return [
        {
            "id": "F-001",
            "severity": "high",
            "area": "structure",
            "field": "project.residenceBlockCount",
            "message": (
                "CORRECTED BY THE W0-B HARVEST. SOURCES.md §3 recorded a three-way split — "
                "3 (Housearch) vs 7 residence blocks (Seaside, ENS Pride) vs 14 buildings of "
                "6 floors (Haspo) — and treated Housearch's 3 as an uncorroborated outlier. "
                "Reading Housearch's markup shows it states NO block count for this project at "
                "all: the 3 sits inside its developer panel and counts Cebeci Group's whole "
                "portfolio on Housearch, matching that site's own 'Property from Cebeci Group — "
                "3 new buildings' link. So the outlier was never a disagreement about Azura "
                "World; it was a figure about a different subject read out of context on the "
                "shallow pass. What remains is two compatible facts: 7 residence blocks "
                "CONTAINING 14 buildings of 6 floors."
            ),
            "competingValues": refs("project.residenceBlockCount") + refs("project.buildingCount"),
            "resolution": (
                "residenceBlockCount = 7, now confirmed across three independent hosts "
                "(Seaside, ENS Pride, Capital Estate). buildingCount = 14 stays single_source "
                "on Haspo. No value is suppressed — there is simply no competing block count "
                "left once Housearch's portfolio counter is read as what it is. This is the "
                "clearest case in the build for why the deep harvest exists: the shallow pass "
                "produced a plausible conflict out of a correctly-quoted number."
            ),
            "resolvedTo": 7,
        },
        {
            "id": "F-002",
            "severity": "critical",
            "area": "pricing",
            "field": "units[].askingPrice",
            # COMPOSED FROM THE DATA, not written by hand. See
            # compose_f002_message() and the note on `competingValues` below.
            # The placeholder here is never emitted: the builder overwrites it
            # once the real observations exist, and raises if it does not.
            "message": F002_MESSAGE_PLACEHOLDER,
            "competingValues": [],  # populated from real observations at build time
            "resolution": (
                "DELIBERATELY UNRESOLVED. Rendered as a range with all sources visible and a "
                "'prices disagree across portals' badge. No average, no midpoint, no 'most "
                "likely' pick — any single number here would be a fabrication with a citation "
                "stapled to it. This is the project's primary honesty gate."
            ),
            "resolvedTo": None,
        },
        {
            "id": "F-003",
            "severity": "medium",
            "area": "geography",
            "field": "project.distanceToSeaM",
            "message": (
                "Distance to sea: 200 m (Seaside), 300 m (Alanya-Home, Haspo, ENS Pride), and "
                "1 km quoted for the hotel-to-public-beach walk. The 1 km is a different "
                "measurement, not a contradiction."
            ),
            "competingValues": refs("project.distanceToSeaM"),
            "resolution": (
                "Residence distanceToSeaM = 300 m (corroborated). The hotel's beach distance is "
                "stored separately as hotel.distanceToBeachM so two different measurements are "
                "never collapsed into one field. Seaside's uncorroborated 200 m is retained."
            ),
            "resolvedTo": 300,
        },
        {
            "id": "F-004",
            "severity": "low",
            "area": "geography",
            "field": "project.distanceToAlanyaCentreKm",
            "message": "Distance to Alanya centre: 15 km (Seaside, Alanya-Home), 17 km (Housearch), 18 km (Haspo).",
            "competingValues": refs("project.distanceToAlanyaCentreKm"),
            "resolution": (
                "15 km displayed, spread noted. The variation is consistent with different "
                "centre reference points rather than one source being wrong."
            ),
            "resolvedTo": 15,
        },
        {
            "id": "F-005",
            "severity": "low",
            "area": "geography",
            "field": "project.distanceToAntalyaAirportKm",
            "message": "Antalya airport: 100 km (Seaside, Haspo) vs 110 km (Alanya-Home); Housearch gives drive time only.",
            "competingValues": refs("project.distanceToAntalyaAirportKm"),
            "resolution": "Unresolved. Both values retained and displayed; neither host outranks the other.",
            "resolvedTo": None,
        },
        {
            "id": "F-006",
            "severity": "high",
            "area": "availability",
            "field": "project.buildStatus",
            "message": (
                "Build status: 'completed' (Housearch) vs 'under construction' (Haspo). "
                "Completion 2024-05-30 is corroborated by three hosts and this harvest ran "
                "2026-07-27, so Haspo's listing is stale by roughly two years."
            ),
            "competingValues": refs("project.buildStatus"),
            "resolution": (
                "buildStatus = completed. Consequence, and this is the part that matters: every "
                "price harvested from Haspo inherits isStale = true and must be flagged wherever "
                "shown, because a stale price presented as current is the most damaging error "
                "this project can make."
            ),
            "resolvedTo": "completed",
        },
        {
            "id": "F-007",
            "severity": "high",
            "area": "branding",
            "field": "hotel.brandAffiliation",
            "message": (
                "Cebeci İnşaat signed a Wyndham licence for the hotel component (Turizm Güncel). "
                "Agoda and OnTheBeach both list the property as 'Azura World Hotel (ex. Wyndham "
                "Alanya)', and Tripadvisor renamed the same property id in place. The Wyndham "
                "branding was dropped between opening and 2026."
            ),
            "competingValues": refs("hotel.brandAffiliation") + refs("hotel.name"),
            "resolution": (
                "name = 'Azura World Hotel', formerName = 'Wyndham Alanya', brandAffiliation = "
                "null with a note. The ticket's wyndham.antalyacoast.com link points at the "
                "superseded brand and is kept as a historical source, never as current identity."
            ),
            "resolvedTo": None,
        },
        {
            "id": "F-008",
            "severity": "medium",
            "area": "structure",
            "field": "project.greenAreaSqm",
            "message": (
                "Green area: 20,000 m² (Alanya-Home, Housearch) vs 'over 41,000 m² of landscaped "
                "green areas' (ENS Pride). Alanya-Home's own breakdown closes arithmetically — "
                "green 20,000 + footprint 15,000 + outdoor 41,000 = 76,000 m², exactly the plot "
                "area three other hosts state independently."
            ),
            "competingValues": refs("project.greenAreaSqm"),
            "resolution": (
                "greenAreaSqm = 20,000. ENS Pride conflated the outdoor-facility figure with "
                "green space; the arithmetic identity is what settles it, not a preference "
                "between publishers. ENS Pride's 41,000 stays in conflictsWith."
            ),
            "resolvedTo": 20000,
        },
        {
            "id": "F-009",
            "severity": "medium",
            "area": "structure",
            "field": "project.developerFoundedYear",
            "message": (
                "Developer experience: 'more than 30 years' (Seaside), '40 years' "
                "(azuraworld.com, Alanya-Home), established 1982 (Housearch)."
            ),
            "competingValues": refs("project.developerFoundedYear"),
            "resolution": (
                "developerFoundedYear = 1982. 1982 to the 2022 construction start is 40 years, "
                "which reconciles the '40 years' copy; Seaside's '30 years' is older or rounded "
                "down. The year is the fact; the '40 years' phrasing is marketing."
            ),
            "resolvedTo": 1982,
        },
        {
            "id": "F-010",
            "severity": "critical",
            "area": "harvest",
            "field": "harvest.authority",
            "message": "",  # filled from measured harvest results
            "competingValues": [],
            "resolution": "",
            "resolvedTo": None,
        },
    ]


# ---------------------------------------------------------------- inventory --


def block_sizes(total: int, blocks: int) -> list[int]:
    base, remainder = divmod(total, blocks)
    return [base + (1 if index < remainder else 0) for index in range(blocks)]


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


pending_layout_violations: list[str] = []


def build_units(observations: list[tuple], findings: list[dict]) -> tuple[list[dict], dict, list[dict]]:
    """656 units: the real listings first, then an explicitly modelled remainder.

    656 is corroborated. A unit-by-unit inventory is NOT stated by any source, so
    the remainder is synthesised and labelled 'modelled'. The labelling is the
    whole point — W3-C makes them visually distinct, and this function guarantees
    the data supports that by never letting a modelled unit look sourced.
    """
    portal_listings: list[dict] = []
    real_units: list[dict] = []

    # Deduplicate on the PUBLISHER'S OWN listing id where there is one.
    #
    # Haspo publishes each apartment three times — a card on the German complex
    # page, the same card on the English one, and its own detail page — and all
    # three carry the same data-id. Keyed on URL they are three listings; keyed on
    # the reference they are one apartment seen three times, which is what they
    # are. Getting this wrong would have tripled the inventory and tripled every
    # price's apparent corroboration.
    #
    # Where a publisher gives no id, fall back to the value tuple scoped to its
    # host, which collapses Housearch's six locale renderings of one price table
    # without merging two genuinely different prices.
    def dedupe_key(unit: UnitObservation, capture: Capture) -> tuple:
        host = host_of(unit.url or capture.final_url)
        if unit.reference:
            return ("ref", host, str(unit.reference))
        return ("val", host, unit.layout, unit.price_amount, unit.interior_m2, unit.price_kind)

    # A detail-page sighting beats an index card for the same reference: it has
    # the unit's own permalink, so its citation re-opens to the apartment rather
    # than to a grid of eighteen.
    best: dict[tuple, tuple] = {}
    for unit, ref, capture in observations:
        key = dedupe_key(unit, capture)
        incumbent = best.get(key)
        if incumbent is None or (capture.parent_id is not None and incumbent[2].parent_id is None):
            best[key] = (unit, ref, capture)
    priced = list(best.values())

    for unit, ref, capture in priced:
        portal_listings.append(
            {
                "publisher": capture.publisher,
                "url": unit.url or capture.final_url,
                "fetchedAt": capture.fetched_at,
                "layout": unit.layout,
                "interiorM2": unit.interior_m2,
                "price": (
                    {"amount": unit.price_amount, "currency": unit.price_currency}
                    if unit.price_amount and unit.price_currency
                    else None
                ),
                "claimedBlockCount": None,
                "claimedTotalUnits": None,
                "claimedBuildStatus": None,
                "isStale": bool(unit.is_stale),
                "priceKind": unit.price_kind,
                "note": unit.note,
            }
        )

    # Only SALE observations with a positive price and a parsed currency can seat a
    # real unit. A rent, a zero, or a price with no currency is evidence about a
    # listing, not a purchasable unit.
    #
    # And only observations that identify ONE apartment may seat a unit at all.
    # "1BR from $238,967" (Housearch) and "From €200,000, 81-349 m²" (TERRA) are
    # per-layout entry prices for a whole project — real evidence, but evidence
    # about a price band, not about an apartment. Seating them as units would put
    # 24 fictional apartments in the inventory whose "source" genuinely resolves,
    # which is the most convincing kind of wrong. The test is the publisher's own
    # listing id plus a stated size: Haspo's data-id and Seaside's F-xxxx refs
    # pass, aggregate rows do not. Everything excluded here still survives in
    # portalListings and still feeds F-002.
    def identifies_one_unit(unit: UnitObservation) -> bool:
        return bool(unit.reference) and unit.interior_m2 is not None

    sale_obs = [
        (unit, ref, capture)
        for unit, ref, capture in priced
        if unit.price_kind == "sale"
        and unit.price_amount
        and unit.price_amount > 0
        and unit.price_currency
        and identifies_one_unit(unit)
    ]

    sizes = block_sizes(TOTAL_UNITS_TARGET, BLOCK_COUNT)
    slots: list[tuple[int, int]] = []
    for block_index, size in enumerate(sizes, start=1):
        for sequence in range(1, size + 1):
            slots.append((block_index, sequence))

    from azura_parsers.base import LAYOUTS

    def safe_layout(raw: str | None, source_id: str) -> str:
        """The UnitLayout union in CONTRACTS.md is frozen. A parser returning
        anything outside it is a parser bug, and emitting it would break the
        generated TypeScript at compile time in a file nobody may hand-edit —
        so it is caught here, recorded, and the unit degrades rather than the
        build breaking on unrelated ground."""
        if raw in LAYOUTS:
            return raw
        if raw:
            layout_violations.append(f"{source_id}: layout {raw!r} is outside the frozen union")
        return "1+1"

    layout_violations: list[str] = []

    for index, (unit, ref, capture) in enumerate(sale_obs):
        if index >= len(slots):
            break
        block_index, sequence = slots[index]
        real_units.append(
            {
                "id": f"AZW-B{block_index:02d}-{sequence:04d}",
                "blockCode": f"B{block_index:02d}",
                "sequence": sequence,
                "layout": safe_layout(unit.layout, capture.source_id),
                "interiorM2": unit.interior_m2,
                "outdoorM2": unit.outdoor_m2,
                "floorLevel": unit.floor_level,
                "askingPrice": {
                    "value": {"amount": unit.price_amount, "currency": unit.price_currency},
                    "sources": [ref],
                    "confidence": "single_source",
                    "note": (
                        f"Price and size as published by {capture.publisher} at "
                        f"{unit.url or capture.final_url}. The unit's block and position within "
                        "the project is NOT stated by any source — the id is an internal "
                        "addressing key, not a developer unit number."
                        + (" This listing is stale (F-006)." if unit.is_stale else "")
                        + (f" Parser note: {unit.note}" if unit.note else "")
                    ),
                },
                "competingPrices": [
                    {
                        "money": {"amount": unit.price_amount, "currency": unit.price_currency},
                        "source": ref,
                        "observedAt": capture.fetched_at,
                    }
                ],
                "saleStatus": {
                    "value": "available",
                    "sources": [ref],
                    "confidence": "single_source",
                    "note": "A live listing implies availability; no source states unit-level sale status.",
                },
                "dataQuality": "portal_listing",
            }
        )

    # Price basis for the modelled remainder: median EUR per m², per layout, from
    # real sale listings only.
    per_m2: dict[str, list[float]] = defaultdict(list)
    basis_refs: dict[str, list[dict]] = defaultdict(list)
    for unit, ref, _ in sale_obs:
        if unit.interior_m2 and unit.interior_m2 > 0 and unit.price_currency == "EUR":
            per_m2[unit.layout or "1+1"].append(unit.price_amount / unit.interior_m2)
            basis_refs[unit.layout or "1+1"].append(ref)

    observed_areas: dict[str, list[float]] = defaultdict(list)
    for unit, _, _ in sale_obs:
        if unit.interior_m2:
            observed_areas[unit.layout or "1+1"].append(unit.interior_m2)

    layout_pool = [layout for layout, values in per_m2.items() if values and layout in LAYOUTS] or ["1+1"]

    modelled: list[dict] = []
    for index in range(len(real_units), TOTAL_UNITS_TARGET):
        block_index, sequence = slots[index]
        layout = layout_pool[index % len(layout_pool)]
        rate = median(per_m2.get(layout, []))
        area = median(observed_areas.get(layout, []))
        price_value = None
        if rate and area:
            price_value = {"amount": round(rate * area), "currency": "EUR"}

        modelled.append(
            {
                "id": f"AZW-B{block_index:02d}-{sequence:04d}",
                "blockCode": f"B{block_index:02d}",
                "sequence": sequence,
                "layout": layout,
                "interiorM2": area,
                "outdoorM2": None,
                "floorLevel": (sequence - 1) % FLOORS_PER_BUILDING,
                "askingPrice": (
                    {
                        "value": price_value,
                        "sources": basis_refs.get(layout, [])[:3],
                        "confidence": "inferred",
                        "note": (
                            f"MODELLED, NOT A LISTING. No source publishes a unit-by-unit "
                            f"inventory for this project; 656 total units is corroborated but the "
                            f"per-block and per-floor breakdown is not. Price = median observed "
                            f"EUR/m² for layout {layout} "
                            f"({rate:.0f} EUR/m², n={len(per_m2.get(layout, []))}) x median "
                            f"observed interior area ({area:.0f} m²). The underlying EUR/m² basis "
                            f"is itself disputed across portals — see F-002, whose 2.1x spread is "
                            f"deliberately unresolved — so this figure inherits that uncertainty "
                            f"and must never be shown as an asking price."
                        )
                        if rate and area
                        else (
                            "MODELLED, NOT A LISTING. No per-unit price basis exists for this "
                            "layout in any validated source, so no price is asserted."
                        ),
                    }
                    if price_value
                    else {
                        "value": None,
                        "sources": [],
                        "confidence": "gap",
                        "note": (
                            "MODELLED unit with no price basis in any validated source. A missing "
                            "price is honest; a plausible-looking invented one is not."
                        ),
                    }
                ),
                "competingPrices": [],
                "saleStatus": {
                    # null, not "unknown": CONTRACTS.md §1 invariant 1 is that a gap
                    # carries a null value. "unknown" is a legal saleStatus that a
                    # source could assert; using it here would dress an absence of
                    # evidence up as an observation of uncertainty.
                    "value": None,
                    "sources": [],
                    "confidence": "gap",
                    "note": "No source publishes unit-level availability for this project.",
                },
                "dataQuality": "modelled",
            }
        )

    units = real_units + modelled
    split = {"portalListing": len(real_units), "modelled": len(modelled), "total": len(units)}

    if layout_violations:
        pending_layout_violations.extend(sorted(set(layout_violations)))

    findings.append(
        {
            "id": "F-011",
            "severity": "high",
            "area": "structure",
            "field": "units[].id",
            "message": (
                f"No source publishes a unit-by-unit inventory. 656 total units is corroborated "
                f"(Seaside, ENS Pride) but the per-block and per-floor breakdown is not stated "
                f"anywhere. {split['portalListing']} units are backed by real portal listings; "
                f"{split['modelled']} are synthesised to fill the confirmed total."
            ),
            "competingValues": [],
            "resolution": (
                "Synthesised units carry dataQuality 'modelled' and an askingPrice confidence of "
                "'inferred' (or 'gap' where no basis exists), with the derivation named in the "
                "note. Block/sequence ids are internal addressing keys and are not developer unit "
                "numbers — including for the real listings, whose position in the project no "
                "portal states. A modelled unit must never render as a real listing."
            ),
            "resolvedTo": None,
        }
    )

    return units, split, portal_listings


# ------------------------------------------------------------------- output --


TS_HEADER = """// GENERATED FILE — do not hand-edit.
//
// Generator: scripts/build-azura-dataset.py   (task W0-B)
// Inputs:    sources/manifest.json + sources/raw/**  (Playwright harvest)
// Regenerate: python scripts/build-azura-dataset.py --strict
//
// If a value in here is wrong, FIX THE PARSER, never this file. A hand-edit is
// erased by the next harvest and, worse, silently decouples a displayed number
// from the snapshot that is supposed to prove it.
//
// Every fact carries its sources. `confidence: "gap"` means no source stated it
// and the value is null — that is a deliberate outcome, not missing work.
// The interfaces below mirror CONTRACTS.md §2 and must not drift from
// apps/web/lib/contracts.ts (owned by W0-A).
//
// They are also the reason `satisfies` at the bottom is worth anything. Every
// member here is a real shape: `project`, `blocks`, `hotel`, `reviews`,
// `portalListings`, `amenities` and `coverage` were once `Record<string,
// unknown>`, and inside such a member the contextual type of every leaf is
// `unknown` — so `"tier": 4` widened to `number` and `"confidence": "confirmed"`
// to `string`, and no nested AzuraSourcedFact type-checked at any call site.
// Declaring the shapes is what keeps the literal unions alive in this file.
"""

# The fact members of AzuraProject / AzuraHotel are GENERATED from these two
# maps, which are the same maps main() loops over to build the objects. One
# source of truth: a field cannot be emitted without a declaration, and a
# declaration cannot outlive the field. The value type is the type of
# SourcedFact.value — AzuraSourcedFact<T> already makes it `T | null`, so a
# "gap" needs no separate declaration.
PROJECT_FACT_TYPES: dict[str, str] = {
    "developer": "string",
    "developerFoundedYear": "number",
    "plotAreaSqm": "number",
    "greenAreaSqm": "number",
    "buildingFootprintSqm": "number",
    "outdoorFacilityAreaSqm": "number",
    "residenceBlockCount": "number",
    "buildingCount": "number",
    "floorsPerBuilding": "number",
    "totalUnits": "number",
    "constructionStart": "string",
    "completionDate": "string",
    "buildStatus": "AzuraBuildStatus",
    "distanceToSeaM": "number",
    "distanceToAlanyaCentreKm": "number",
    "distanceToGazipasaAirportKm": "number",
    "distanceToAntalyaAirportKm": "number",
    "downPaymentPercent": "number",
}

HOTEL_FACT_TYPES: dict[str, str] = {
    "name": "string",
    "formerName": "string",
    "stars": "number",
    "roomCount": "number",
    "floors": "number",
    "openedYear": "number",
    "board": "string",
    "aquaparkSlides": "number",
    "distanceToBeachM": "number",
    "checkIn": "string",
    "checkOut": "string",
    # CONTRACTS §2 writes this SourcedFact<string | null>; AzuraSourcedFact<T>
    # already unions null into `value`, so <string> is the same type.
    "brandAffiliation": "string",
}

_TS_TYPES_HEAD = """
export type AzuraConfidence =
  | "confirmed"
  | "official"
  | "single_source"
  | "conflicted"
  | "inferred"
  | "gap"

export type AzuraSourceTier = 1 | 2 | 3 | 4 | 5 | 6

export interface AzuraSourceRef {
  url: string
  publisher: string
  fetchedAt: string
  snapshotHash: string
  tier: AzuraSourceTier
}

export interface AzuraSourcedFact<T> {
  value: T | null
  sources: AzuraSourceRef[]
  confidence: AzuraConfidence
  conflictsWith?: Array<{ value: unknown; source: AzuraSourceRef }>
  note?: string
}

export interface AzuraMoney {
  amount: number
  currency: "EUR" | "USD" | "TRY" | "GBP"
}

export type AzuraUnitLayout =
  | "1+1" | "2+1" | "3+1" | "4+1" | "5+1" | "6+1"
  | "penthouse" | "townhouse" | "villa" | "president_villa"

/** One vocabulary, used by both AzuraUnit and AzuraBlock. */
export type AzuraDataQuality =
  | "portal_listing"
  | "official"
  | "modelled"
  | "source_missing"

/** project.buildStatus. Frozen with CONTRACTS.md §2 AzuraProject. */
export type AzuraBuildStatus = "planned" | "under_construction" | "completed"

/** A monthly rent must never enter the sale-price series — see F-002. */
export type AzuraPriceKind = "sale" | "rent"

export interface AzuraHarvestEntry {
  url: string
  publisher: string
  tier: AzuraSourceTier
  status: number | string
  fetchedAt: string
  snapshotPath: string | null
  snapshotHash: string | null
  bytes: number
  contentValidated: boolean
}

export interface AzuraUnit {
  id: string
  blockCode: string
  sequence: number
  layout: AzuraUnitLayout
  interiorM2: number | null
  outdoorM2: number | null
  floorLevel: number | null
  askingPrice: AzuraSourcedFact<AzuraMoney>
  competingPrices: Array<{ money: AzuraMoney; source: AzuraSourceRef; observedAt: string }>
  saleStatus: AzuraSourcedFact<"available" | "reserved" | "sold" | "unknown">
  dataQuality: AzuraDataQuality
}

export interface AzuraFinding {
  id: string
  severity: "critical" | "high" | "medium" | "low" | "info"
  area: "structure" | "pricing" | "timeline" | "geography" | "branding" | "availability" | "harvest"
  field: string
  message: string
  competingValues: Array<{ value: unknown; source: AzuraSourceRef }>
  resolution: string
  resolvedTo: unknown | null
}

export interface AzuraProjectContact {
  phone: AzuraSourcedFact<string>
  email: AzuraSourcedFact<string>
  address: AzuraSourcedFact<string>
}

export interface AzuraSocialLink {
  /** Whatever the emitting parser labelled the profile ("instagram", …). Free
   *  text on purpose: it is a parser note, not a closed vocabulary. */
  platform: string
  url: string
  source: AzuraSourceRef
}

export interface AzuraProject {
  name: string
  code: "AZW-TRK"
  country: "Türkiye"
  province: "Antalya"
  city: "Alanya"
  district: "Türkler"
"""

_TS_TYPES_MID = """  contact: AzuraProjectContact
  social: AzuraSocialLink[]
}

export interface AzuraHotel {
"""

_TS_TYPES_TAIL = """}

/** Block composition is not published by any source — see F-011. Every block
 *  in this dataset is therefore dataQuality "modelled". */
export interface AzuraBlock {
  code: string
  unitCount: number
  dataQuality: AzuraDataQuality
  note: string
}

export type AzuraReviewPlatform =
  | "tripadvisor"
  | "booking"
  | "agoda"
  | "onthebeach"
  | "google"

/** 6.7 means nothing until you know it is out of 10, so the scale travels with
 *  the score and is never inferred from the size of the number. */
export type AzuraScoreScale = 5 | 10

export interface AzuraReviewQuote {
  /** Verbatim. Never paraphrased, never truncated. */
  text: string
  /** null when the card's bubble rating could not be read positionally — a
   *  per-category sub-rating misread as the overall would distort a real
   *  person's review, so it is left null rather than guessed. */
  rating: number | null
  /** The page's literal published-date string, not normalised to ISO. */
  date: string
  url: string
}

/** Tripadvisor's own five buckets PLUS the three-way fold CONTRACTS §2 names.
 *  Both are stored and nothing is discarded either way; the fold is a fact
 *  about Tripadvisor's own scale, not a judgement about this hotel. A platform
 *  that publishes only the fold emits the three required keys alone. */
export interface AzuraReviewSentiment {
  positive: number
  mixed: number
  negative: number
  excellent?: number
  good?: number
  average?: number
  poor?: number
  terrible?: number
}

export interface AzuraReview {
  /** The platform that PRODUCED the score, never the host that served it — a
   *  syndicated widget filed under its serving host would launder one opinion
   *  into two agreeing sources. */
  platform: AzuraReviewPlatform
  url: string
  score: AzuraSourcedFact<number>
  scoreScale: AzuraScoreScale
  reviewCount: AzuraSourcedFact<number>
  ranking: AzuraSourcedFact<string>
  sentiment: AzuraReviewSentiment | null
  notableQuotes: AzuraReviewQuote[]
}

export interface AzuraPortalListing {
  publisher: string
  url: string
  fetchedAt: string
  layout: AzuraUnitLayout | null
  interiorM2: number | null
  price: AzuraMoney | null
  claimedBlockCount: number | null
  claimedTotalUnits: number | null
  claimedBuildStatus: string | null
  isStale: boolean
  /** The next two go beyond CONTRACTS §2 PortalListing. The builder has always
   *  emitted them; they were simply invisible while this member was an open
   *  record. Declared rather than dropped — dropping priceKind would let a
   *  monthly rent look like a sale price, which is F-002's whole subject. */
  priceKind: AzuraPriceKind
  note: string | null
}

/** CONTRACT-GAP-02. `Amenity` is referenced by CONTRACTS.md §2 and defined
 *  nowhere in it, and this builder hardcodes `"amenities": []` — no parser
 *  output reaches the member. `never` is the observed shape and the honest
 *  one: the day amenities are emitted, tsc demands the real shape be written
 *  here instead of it being guessed today. */
export type AzuraAmenity = never

export interface AzuraCoverage {
  sourcesTotal: number
  sourcesValidated: number
  sourcesTierLe3Validated: number
  /** Sparse — only the confidences actually observed get a key. */
  projectFactsByConfidence: Partial<Record<AzuraConfidence, number>>
  unitObservations: number
  parserFailures: number
}

export interface AzuraWorldDataset {
  generatedAt: string
  contractVersion: 1
  harvest: AzuraHarvestEntry[]
  project: AzuraProject
  blocks: AzuraBlock[]
  units: AzuraUnit[]
  hotel: AzuraHotel
  reviews: AzuraReview[]
  portalListings: AzuraPortalListing[]
  amenities: AzuraAmenity[]
  findings: AzuraFinding[]
  unitSplit: { portalListing: number; modelled: number; total: number }
  coverage: AzuraCoverage
}
"""


CONFIDENCES = frozenset(
    {"confirmed", "official", "single_source", "conflicted", "inferred", "gap"}
)
TIERS = frozenset({1, 2, 3, 4, 5, 6})
BUILD_STATUSES = frozenset({"planned", "under_construction", "completed"})
REVIEW_PLATFORMS = frozenset({"tripadvisor", "booking", "agoda", "onthebeach", "google"})
SCORE_SCALES = frozenset({5, 10})
PRICE_KINDS = frozenset({"sale", "rent"})
CURRENCIES = frozenset({"EUR", "USD", "TRY", "GBP"})
DATA_QUALITIES = frozenset({"portal_listing", "official", "modelled", "source_missing"})


def vocabulary_problems(dataset: dict) -> list[str]:
    """Re-check, in Python, every literal union the emitted TypeScript declares.

    The generated file may not be hand-edited, so a value outside a frozen union
    surfaces as a tsc error in a file nobody is allowed to fix, hundreds of lines
    away from the parser that produced it. Naming it here instead is the same
    stance safe_layout() already takes for units[].layout — this is the
    whole-file version of it.
    """
    problems: list[str] = []

    def note(where: str, field: str, value: Any) -> None:
        problems.append(f"{where}.{field} = {value!r} is outside the frozen union")

    def walk(path: str, node: Any) -> None:
        if isinstance(node, dict):
            if "tier" in node and isinstance(node.get("tier"), int):
                if node["tier"] not in TIERS:
                    note(path, "tier", node["tier"])
            if "confidence" in node and "sources" in node:
                if node["confidence"] not in CONFIDENCES:
                    note(path, "confidence", node["confidence"])
            for key, child in node.items():
                walk(f"{path}.{key}" if path else key, child)
        elif isinstance(node, list):
            for index, child in enumerate(node):
                walk(f"{path}[{index}]", child)

    walk("", dataset)

    status = dataset["project"]["buildStatus"]["value"]
    if status is not None and status not in BUILD_STATUSES:
        note("project.buildStatus", "value", status)

    for index, review in enumerate(dataset["reviews"]):
        where = f"reviews[{index}]"
        if review["platform"] not in REVIEW_PLATFORMS:
            note(where, "platform", review["platform"])
        if review["scoreScale"] not in SCORE_SCALES:
            note(where, "scoreScale", review["scoreScale"])

    from azura_parsers.base import LAYOUTS

    for index, listing in enumerate(dataset["portalListings"]):
        where = f"portalListings[{index}]"
        if listing["layout"] is not None and listing["layout"] not in LAYOUTS:
            note(where, "layout", listing["layout"])
        if listing["priceKind"] not in PRICE_KINDS:
            note(where, "priceKind", listing["priceKind"])
        price = listing["price"]
        if price is not None and price["currency"] not in CURRENCIES:
            note(where, "price.currency", price["currency"])

    for index, unit in enumerate(dataset["units"]):
        if unit["dataQuality"] not in DATA_QUALITIES:
            note(f"units[{index}]", "dataQuality", unit["dataQuality"])

    for index, block in enumerate(dataset["blocks"]):
        if block["dataQuality"] not in DATA_QUALITIES:
            note(f"blocks[{index}]", "dataQuality", block["dataQuality"])

    if dataset["amenities"]:
        problems.append(
            "amenities is non-empty but AzuraAmenity is `never` (CONTRACT-GAP-02): "
            "declare the real shape in _TS_TYPES_TAIL before emitting any"
        )

    return problems


def _fact_members(spec: dict[str, str]) -> str:
    return "".join(f"  {name}: AzuraSourcedFact<{ts}>\n" for name, ts in spec.items())


def ts_types() -> str:
    """The type block, with AzuraProject/AzuraHotel members generated in place."""
    return (
        _TS_TYPES_HEAD
        + _fact_members(PROJECT_FACT_TYPES)
        + _TS_TYPES_MID
        + _fact_members(HOTEL_FACT_TYPES)
        + _TS_TYPES_TAIL
    )


def emit_ts(dataset: dict) -> None:
    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(dataset, ensure_ascii=False, indent=2)
    # `satisfies` without `as const`, deliberately, and against the reference file
    # in 1Çatı which uses both. `as const` makes every array readonly, which does
    # not satisfy an interface declaring mutable arrays, and on 656 units it also
    # asks tsc to instantiate a literal type per unit. The check we actually want
    # here is that the emitted shape matches the contract — `satisfies` gives that
    # on its own, and it is what keeps the frozen UnitLayout union enforced at
    # build time rather than discovered at render time.
    TS_OUT.write_text(
        f"{TS_HEADER}{ts_types()}\nexport const azuraWorldDataset = {body} satisfies AzuraWorldDataset\n\n"
        "export const azuraWorldUnits: AzuraUnit[] = azuraWorldDataset.units\n"
        "export const azuraWorldFindings: AzuraFinding[] = azuraWorldDataset.findings\n\n"
        "export default azuraWorldDataset\n",
        encoding="utf-8",
    )


def sql_literal(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def emit_sql(dataset: dict) -> None:
    SQL_OUT.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "-- GENERATED FILE — do not hand-edit.",
        "-- Generator: scripts/build-azura-dataset.py (task W0-B)",
        "-- Regenerate: python scripts/build-azura-dataset.py --strict",
        "--",
        "-- Staging schema on purpose: W1-A owns supabase/migrations and the application",
        "-- tables. This file must be loadable before those exist, so it creates its own",
        "-- namespace and W1-A selects out of it rather than this guessing column names.",
        "",
        "create schema if not exists azura_import;",
        "",
        "drop table if exists azura_import.project_fact;",
        "create table azura_import.project_fact (",
        "  field         text primary key,",
        "  value         jsonb,",
        "  confidence    text not null,",
        "  sources       jsonb not null,",
        "  conflicts     jsonb,",
        "  note          text",
        ");",
        "",
        "drop table if exists azura_import.finding;",
        "create table azura_import.finding (",
        "  id            text primary key,",
        "  severity      text not null,",
        "  area          text not null,",
        "  field         text not null,",
        "  message       text not null,",
        "  resolution    text not null,",
        "  resolved_to   jsonb,",
        "  competing     jsonb not null",
        ");",
        "",
        "drop table if exists azura_import.harvest_entry;",
        "create table azura_import.harvest_entry (",
        "  url               text primary key,",
        "  publisher         text not null,",
        "  tier              int  not null,",
        "  status            text not null,",
        "  fetched_at        text not null,",
        "  snapshot_hash     text,",
        "  bytes             bigint not null,",
        "  content_validated boolean not null",
        ");",
        "",
    ]

    def walk(prefix: str, node: Any) -> list[tuple[str, dict]]:
        out: list[tuple[str, dict]] = []
        if isinstance(node, dict) and "confidence" in node and "sources" in node:
            return [(prefix, node)]
        if isinstance(node, dict):
            for key, child in node.items():
                out.extend(walk(f"{prefix}.{key}" if prefix else key, child))
        return out

    for scope in ("project", "hotel"):
        for field, fact in walk(scope, dataset.get(scope, {})):
            lines.append(
                "insert into azura_import.project_fact (field, value, confidence, sources, conflicts, note) values ("
                f"{sql_literal(field)}, "
                f"{sql_literal(json.dumps(fact.get('value'), ensure_ascii=False))}::jsonb, "
                f"{sql_literal(fact.get('confidence'))}, "
                f"{sql_literal(json.dumps(fact.get('sources', []), ensure_ascii=False))}::jsonb, "
                f"{sql_literal(json.dumps(fact.get('conflictsWith'), ensure_ascii=False))}::jsonb, "
                f"{sql_literal(fact.get('note'))});"
            )
    lines.append("")

    for finding in dataset.get("findings", []):
        lines.append(
            "insert into azura_import.finding (id, severity, area, field, message, resolution, resolved_to, competing) values ("
            f"{sql_literal(finding['id'])}, {sql_literal(finding['severity'])}, "
            f"{sql_literal(finding['area'])}, {sql_literal(finding['field'])}, "
            f"{sql_literal(finding['message'])}, {sql_literal(finding['resolution'])}, "
            f"{sql_literal(json.dumps(finding.get('resolvedTo'), ensure_ascii=False))}::jsonb, "
            f"{sql_literal(json.dumps(finding.get('competingValues', []), ensure_ascii=False))}::jsonb);"
        )
    lines.append("")

    for entry in dataset.get("harvest", []):
        lines.append(
            "insert into azura_import.harvest_entry (url, publisher, tier, status, fetched_at, snapshot_hash, bytes, content_validated) values ("
            f"{sql_literal(entry['url'])}, {sql_literal(entry['publisher'])}, {entry['tier']}, "
            f"{sql_literal(str(entry['status']))}, {sql_literal(entry['fetchedAt'])}, "
            f"{sql_literal(entry.get('snapshotHash'))}, {entry.get('bytes', 0)}, "
            f"{sql_literal(bool(entry.get('contentValidated')))}) on conflict (url) do nothing;"
        )

    SQL_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def emit_csv(dataset: dict) -> None:
    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    with CSV_OUT.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "id", "block_code", "sequence", "layout", "interior_m2", "outdoor_m2",
                "floor_level", "price_amount", "price_currency", "price_confidence",
                "sale_status", "data_quality", "is_modelled", "source_url",
            ]
        )
        for unit in dataset["units"]:
            price = unit["askingPrice"].get("value") or {}
            sources = unit["askingPrice"].get("sources") or []
            writer.writerow(
                [
                    unit["id"], unit["blockCode"], unit["sequence"], unit["layout"],
                    unit["interiorM2"] if unit["interiorM2"] is not None else "",
                    unit["outdoorM2"] if unit["outdoorM2"] is not None else "",
                    unit["floorLevel"] if unit["floorLevel"] is not None else "",
                    price.get("amount", ""), price.get("currency", ""),
                    unit["askingPrice"]["confidence"],
                    unit["saleStatus"].get("value") or "unknown",
                    unit["dataQuality"],
                    "true" if unit["dataQuality"] == "modelled" else "false",
                    sources[0]["url"] if sources else "",
                ]
            )


# -------------------------------------------------------------------- main --


# Derived, not repeated: the emitted TypeScript declares exactly the fields this
# loop builds, because both read the same map. Adding a field in one place and
# forgetting the other used to be possible; now it is not.
PROJECT_FIELDS = list(PROJECT_FACT_TYPES)

HOTEL_FIELDS = list(HOTEL_FACT_TYPES)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    manifest = load_json(MANIFEST)
    captures = build_captures()
    modules = load_parsers()

    say = (lambda *a: None) if args.quiet else print
    say(f"build-azura-dataset · {len(captures)} validated captures · {len(modules)} parser modules")

    by_field, unit_obs, review_obs, parser_failures = collect_claims(captures, modules)
    say(f"  claims: {sum(len(v) for v in by_field.values())} across {len(by_field)} fields")
    say(f"  unit observations: {len(unit_obs)}   reviews: {len(review_obs)}")
    for failure in parser_failures:
        say(f"  ! parser failed for {failure['sourceId']}: {failure['error']}")

    project: dict[str, Any] = {
        "name": "Azura World Residence & Hotel",
        "code": "AZW-TRK",
        "country": "Türkiye",
        "province": "Antalya",
        "city": "Alanya",
        "district": "Türkler",
    }
    for field in PROJECT_FIELDS:
        project[field] = build_fact(
            f"project.{field}",
            by_field.get(f"project.{field}", []),
            f"No validated source states project.{field}. Left null rather than estimated.",
        )
    project["contact"] = {
        part: build_fact(
            f"project.contact.{part}",
            by_field.get(f"project.contact.{part}", []),
            f"No validated source states a contact {part}.",
        )
        for part in ("phone", "email", "address")
    }
    project["social"] = [
        {"platform": record.get("note") or "unknown", "url": record["value"], "source": record["ref"]}
        for record in by_field.get("project.social", [])
    ]

    hotel = {
        field: build_fact(
            f"hotel.{field}",
            by_field.get(f"hotel.{field}", []),
            f"No validated source states hotel.{field}.",
        )
        for field in HOTEL_FIELDS
    }

    # ---- F-007: apply the RECORDED resolution, visibly ----------------------
    # The only source that names a chain is a March 2023 press announcement of a
    # Wyndham LICENCE. Left alone, the builder ranks that single claim as
    # single_source and the UI renders "Wyndham Hotels & Resorts" as the hotel's
    # current affiliation — the precise misreading F-007 exists to prevent, since
    # the hotel's own 2026 site names no chain at all and two booking sites call
    # it "ex. Wyndham Alanya".
    #
    # This is applying a resolution that a human already recorded and argued, not
    # inventing one: the losing value keeps its URL and its snapshot in
    # conflictsWith, so the announcement stays one click away instead of being
    # deleted or being promoted to a fact about today.
    affiliation = hotel["brandAffiliation"]
    if affiliation.get("value"):
        hotel["brandAffiliation"] = {
            "value": None,
            "sources": affiliation["sources"],
            "confidence": "conflicted",
            "conflictsWith": (affiliation.get("conflictsWith") or [])
            + [{"value": affiliation["value"], "source": src} for src in affiliation["sources"]],
            "note": (
                "No CURRENT chain affiliation is asserted. The only source naming a chain is a "
                "2023 press report of a Wyndham licence agreement, retained above. Against it: "
                "the hotel's own site (tier 3, harvested 2026-07-27) names no chain anywhere in "
                "its copy, and Agoda and OnTheBeach both list the property as 'ex. Wyndham "
                "Alanya'. A licence signed in 2023 is not evidence of a brand in 2026 — see "
                "F-007 and F-018."
            ),
        }

    findings = seeded_findings(by_field)

    # F-010 is measured, not asserted.
    entries = manifest.get("entries", [])
    validated = [e for e in entries if e.get("contentValidated")]
    authority = [e for e in validated if int(e.get("tier", 6)) <= 3]
    f010 = next(f for f in findings if f["id"] == "F-010")
    f010["message"] = (
        f"Source authority measured at harvest: {len(validated)}/{len(entries)} sources returned "
        f"validated content. Tier <=3 (official / developer / hotel) sources validated: "
        f"{len(authority)} — {', '.join(sorted(e['id'] for e in authority)) or 'none'}."
    )
    f010["resolution"] = (
        (
            "Tier <=3 corroboration now exists for the fields those sources actually state. "
            "Structural figures they do NOT state still rest on tier 4-6 and are labelled "
            "single_source or conflicted accordingly."
        )
        if authority
        else (
            "No tier-1/2/3 corroboration exists for any project figure. Every structural number "
            "rests on tier 4-6 and this must be stated in the UI, not buried in a document."
        )
    )
    f010["severity"] = "medium" if authority else "critical"

    units, split, portal_listings = build_units(unit_obs, findings)

    # ---- discovered findings, numbered deliberately from F-012 --------------
    # These are what THIS harvest turned up beyond SOURCES.md §3. The numbers are
    # fixed rather than derived from append order because SOURCES.md and the
    # handoff cite them by id, and CONVENTIONS §6 says a finding id is never reused.

    entry_by_id = {e["id"]: e for e in entries}

    hotel_entry = entry_by_id.get("azuraworldhotel", {})
    if hotel_entry:
        repaired = hotel_entry.get("contentValidated") and not hotel_entry.get("tlsToleranceUsed")
        findings.append(
            {
                "id": "F-012",
                "severity": "medium" if repaired else "critical",
                "area": "harvest",
                "field": "harvest.azuraworldhotel",
                "message": (
                    "azuraworldhotel.com (tier 3, the hotel's own site) was recorded as 'TLS invalid' "
                    "on the shallow pass. Under Chromium it validated WITHOUT any tolerance flag. The "
                    "server sends an incomplete certificate chain; browsers repair that by fetching "
                    "the missing intermediate (AIA), Node's strict TLS stack does not. The fetch "
                    "failure was real; the diagnosis 'invalid certificate' was wrong."
                    if repaired
                    else "azuraworldhotel.com presents a certificate chain that could not be validated."
                ),
                "competingValues": [],
                "resolution": (
                    "Content is trusted at its normal tier because no verification was waived to "
                    "obtain it. The server chain is still misconfigured and any non-browser client "
                    "integrating with them will fail — worth telling the client."
                    if repaired
                    else "Recorded, not resolved. Facts from this source stay single_source."
                ),
                "resolvedTo": None,
            }
        )

    alanya_ids = [e for e in ("alanya-home-466", "alanya-home-891") if entry_by_id.get(e, {}).get("contentValidated")]
    if len(alanya_ids) == 2:
        findings.append(
            {
                "id": "F-013",
                "severity": "high",
                "area": "pricing",
                "field": "units[].askingPrice",
                "message": (
                    "Alanya-Home publishes the SAME project twice, as property 466 and property 891, "
                    "with different entry prices and different size ranges (466: from EUR 220,000, "
                    "from 85 m²; 891: from EUR 125,000, 80-300 m²). One publisher contradicting "
                    "itself on its own site is a stronger signal about price reliability than two "
                    "publishers disagreeing, because portal-to-portal variation has innocent "
                    "explanations that this does not."
                ),
                "competingValues": [
                    {"value": record["value"], "source": record["ref"]}
                    for record in by_field.get("project.downPaymentPercent", [])
                    if record["sourceId"] in alanya_ids
                ],
                "resolution": (
                    "Both pages are kept as separate sources and both prices enter the F-002 range. "
                    "Neither is treated as the correction of the other — no evidence says which is "
                    "current, and picking the lower would flatter the project while picking the "
                    "higher would flatter the comparison."
                ),
                "resolvedTo": None,
            }
        )

    booking_wrong = entry_by_id.get("booking-ticket-url")
    if booking_wrong:
        findings.append(
            {
                "id": "F-014",
                "severity": "high",
                "area": "harvest",
                "field": "harvest.booking",
                "message": (
                    "The ticket's Booking.com URL (/hotel/tr/azura-world.html) is a DIFFERENT "
                    "property — a private apartment near Alanya centre, roughly 15 km from Türkler — "
                    "not the 5-star hotel. The hotel kept its pre-rebrand slug, "
                    "/hotel/tr/wyndham-alanya.html, which is itself further evidence for F-007. "
                    "Had this gone unchecked, another property's rating and review count would have "
                    "been published as Azura World's, correctly cited to a URL that genuinely "
                    "resolves — the hardest kind of error to spot downstream."
                ),
                "competingValues": [],
                "resolution": (
                    "The corrected URL is the source of record; the ticket's URL is harvested and "
                    "retained as evidence for this finding only, and contributes no hotel facts. "
                    "Both are anti-bot blocked in any case, so Booking scores remain a gap."
                ),
                "resolvedTo": None,
            }
        )

    blocked = [e for e in entries if e.get("status") == "robots_disallowed"]
    if blocked:
        findings.append(
            {
                "id": "F-015",
                "severity": "medium",
                "area": "harvest",
                "field": "harvest.robots",
                "message": (
                    f"{len(blocked)} source(s) publish `Disallow: /` for all agents and were NOT "
                    f"fetched: {', '.join(sorted(e['id'] for e in blocked))}. The ticket lists "
                    "Facebook as a source; Facebook's robots.txt refuses it."
                ),
                "competingValues": [],
                "resolution": (
                    "Respected. Recorded as unavailable rather than empty — 'we were not allowed to "
                    "look' and 'we looked and found nothing' are different claims and only one of "
                    "them is true here."
                ),
                "resolvedTo": None,
            }
        )

    next_id = 16

    def add(severity: str, area: str, field: str, message: str, resolution: str,
            competing: list | None = None) -> None:
        nonlocal next_id
        findings.append({
            "id": f"F-{next_id:03d}", "severity": severity, "area": area, "field": field,
            "message": message, "competingValues": competing or [],
            "resolution": resolution, "resolvedTo": None,
        })
        next_id += 1

    # ---- syndicated review scores ------------------------------------------
    # The single most dangerous thing found in the review group.
    # A score is syndicated when the platform that produced it is not the host
    # that served the page.
    serving_platform = {
        "tripadvisor": "tripadvisor", "onthebeach": "onthebeach", "wyndham-antalyacoast": "wyndham",
    }
    syndicated = [
        (rv, cap) for rv, _, cap in review_obs
        if rv.platform != serving_platform.get(cap.source_id, rv.platform)
    ]
    if syndicated:
        add(
            "high", "branding", "reviews[].score",
            "Neither reseller in the review set publishes its own guest score. OnTheBeach's "
            "4.6/5 is an embedded Tripadvisor widget carrying the SAME Tripadvisor location id "
            "(33144231) as the direct Tripadvisor capture, and the Wyndham-brand page's 6.7/10 "
            "is a Booking.com badge. Filed under the serving host, one number would have "
            "appeared as two independent hosts agreeing — which is exactly the input that makes "
            "a fact 'confirmed' under CONTRACTS §1 invariant 3. A single opinion would have been "
            "laundered into corroboration, and the laundering would have been invisible.",
            "Each score is attributed to the platform that PRODUCED it, not the site that served "
            "it, so it can never double-count. A score whose provenance cannot be read off the "
            "page is not recorded at all.",
        )

    # ---- the four confusable Cebeci properties ------------------------------
    if entry_by_id.get("cebecigroup-index", {}).get("contentValidated"):
        add(
            "high", "branding", "hotel.name",
            "Cebeci Group's own project index lists FOUR confusable properties: 'Azura World "
            "Residence & Hotel' (Alanya/Türkler), 'Wyndham Hotel Alanya' (Antalya/Türkler) as a "
            "SEPARATE entry in the same district, 'Azura Deluxe Resort and SPA Hotel' "
            "(Alanya/Avsallar) and 'Azura Park Residence' (Alanya/Mahmutlar). F-007 assumes "
            "Azura World Hotel simply IS the rebranded Wyndham Alanya. The developer's own "
            "roster is consistent with that reading but does not establish it, because it shows "
            "a separately-named Wyndham hotel in the same district rather than one property "
            "under two names.",
            "UNRESOLVED, and deliberately so. Every hotel fact in this dataset is sourced to a "
            "page naming 'Azura World Hotel' specifically. No fact is merged across these four "
            "properties, and the ex-Wyndham identity is carried as formerName evidence from "
            "Agoda/OnTheBeach/Tripadvisor rather than inferred from the developer's roster.",
        )

    # ---- the hotel's own site cites the wrong property's reviews ------------
    hotel_capture = next((c for c in captures if c.source_id == "azuraworldhotel"), None)
    if hotel_capture and "Azura_Deluxe_Resort_Spa" in hotel_capture.html:
        add(
            "critical", "branding", "reviews[].url",
            "azuraworldhotel.com — the hotel's OWN site — links a Tripadvisor review page for "
            "'Azura_Deluxe_Resort_Spa-Avsallar' (g609052-d7391617), a different Cebeci hotel "
            "60 km away. The correct listing for this property is g1069655-d33144231. Anyone "
            "collecting reviews by following the operator's own link attaches another hotel's "
            "ratings to Azura World, with a citation that resolves perfectly.",
            "The review set uses the independently resolved Tripadvisor id, never the operator's "
            "link. The bad link is recorded here because a downstream consumer or a later "
            "harvest would otherwise walk into it.",
        )

    # ---- listings tagged to the wrong district ------------------------------
    misdistrict = [
        (u, ref) for u, ref, _ in unit_obs
        if u.note and "WRONG-DISTRICT" in u.note
    ]
    if misdistrict:
        add(
            "high", "pricing", "units[].askingPrice",
            f"{len(misdistrict)} Haspo listing(s) inside the 'AZURA WORLD' complex state a "
            f"district other than Türkler — one says Oba, one says Mahmutlar while its own "
            f"headline says Türkler. Azura World Residence & Hotel is in Türkler. The Oba "
            f"listing is the EUR 112,000 / 80 m² entry price that anchors the bottom of the "
            f"F-002 range and that SOURCES.md quotes as Haspo's 1+1 price. If it is a different "
            f"building, the 2.1x spread in F-002 is partly an artefact of comparing two projects.",
            "Both listings are kept, priced as published, and flagged in their unit note. "
            "Neither is deleted (that would hide the cheapest evidence) and neither is trusted "
            "as an Azura World anchor. This directly weakens F-002's low end and must be "
            "surfaced wherever the price range is shown.",
            [{"value": {"amount": u.price_amount, "currency": u.price_currency, "note": u.note},
              "source": ref} for u, ref in misdistrict],
        )

    # ---- every remaining conflicted fact gets a finding ---------------------
    # A conflicted SourcedFact with no Finding is a disagreement recorded in the
    # type system and invisible in the UI, which is half the job. Generating these
    # rather than hand-listing them means a conflict discovered by a future
    # harvest cannot slip through unnamed.
    covered = {f["field"] for f in findings}
    for scope_name, scope in (("project", project), ("hotel", hotel)):
        for key, fact in scope.items():
            if not isinstance(fact, dict) or fact.get("confidence") != "conflicted":
                continue
            path = f"{scope_name}.{key}"
            if path in covered:
                continue
            values = [fact["value"]] + [c["value"] for c in fact.get("conflictsWith", [])]
            publishers = [s["publisher"] for s in fact["sources"]] + [
                c["source"]["publisher"] for c in fact.get("conflictsWith", [])
            ]
            add(
                "medium", "structure" if scope_name == "project" else "branding", path,
                f"Sources disagree on {path}: "
                + "; ".join(
                    f"{v!r} ({p})" for v, p in list(dict.fromkeys(zip(values, publishers)))[:6]
                )
                + ". Discovered by the W0-B harvest; not in SOURCES.md §3.",
                "Display value follows tier order (CONTRACTS §1). Every competing value is "
                "retained in conflictsWith with its own source and snapshot. Not resolved — no "
                "evidence here justifies preferring one publisher's figure over another's.",
                [{"value": c["value"], "source": c["source"]} for c in fact.get("conflictsWith", [])],
            )

    if pending_layout_violations:
        findings.append(
            {
                "id": f"F-{next_id:03d}",
                "severity": "high",
                "area": "structure",
                "field": "units[].layout",
                "message": (
                    f"{len(pending_layout_violations)} parsed layout value(s) fell outside the frozen "
                    f"UnitLayout union in CONTRACTS.md §2: " + "; ".join(pending_layout_violations[:8])
                ),
                "competingValues": [],
                "resolution": (
                    "Those units degrade to 1+1 so the generated TypeScript still compiles against "
                    "the frozen union. Fix the parser, never the generated file."
                ),
                "resolvedTo": None,
            }
        )
        next_id += 1

    for failure in parser_failures:
        findings.append(
            {
                "id": f"F-{next_id:03d}",
                "severity": "high",
                "area": "harvest",
                "field": f"parser.{failure['sourceId']}",
                "message": f"Parser {failure['module']} raised on {failure['sourceId']}: {failure['error']}",
                "competingValues": [],
                "resolution": "That host contributed no claims to this build. Other hosts are unaffected.",
                "resolvedTo": None,
            }
        )
        next_id += 1

    # F-002's competing values are the real observations, not a retyped table.
    # F-002's competing values are the real observations, deduplicated the same way
    # the inventory is — one apartment seen on three pages is one price, not three.
    #
    # `layout is None` is INCLUDED on purpose: Alanya-Home and TERRA publish an
    # entry price without attaching it to a layout, and those are two of the four
    # anchors SOURCES.md names in F-002. Dropping them for lacking a layout would
    # quietly narrow the very spread this finding exists to show.
    seen_prices: set[tuple] = set()
    sale_prices = []
    # An unlabelled row qualifies as 1+1 evidence only if its size could be a 1+1.
    # Capital Estate publishes 305 m2 and 312 m2 rows whose stated layout ("5+
    # rooms") is outside the frozen union and therefore parses to None; without a
    # size ceiling those EUR 1.2m villas would land in a finding about the entry
    # price of a one-bedroom flat and inflate the spread with the wrong product.
    # The largest 1+1 actually observed anywhere in this harvest is 92 m2.
    ONE_PLUS_ONE_CEILING_M2 = 120

    for u, ref, cap in unit_obs:
        if u.price_kind != "sale" or not u.price_amount:
            continue
        if u.layout == "1+1":
            pass
        elif u.layout is None and (u.interior_m2 is None or u.interior_m2 <= ONE_PLUS_ONE_CEILING_M2):
            pass
        else:
            continue
        host = host_of(u.url or cap.final_url)
        key = ("ref", host, str(u.reference)) if u.reference else (
            "val", host, u.price_amount, u.price_currency, u.interior_m2
        )
        if key in seen_prices:
            continue
        seen_prices.add(key)
        sale_prices.append({
            "value": {
                "amount": u.price_amount, "currency": u.price_currency, "layout": u.layout,
                "interiorM2": u.interior_m2, "isStale": u.is_stale,
                "isEntryPrice": u.layout is None, "note": u.note,
            },
            "source": ref,
        })
    sale_prices.sort(key=lambda p: (p["value"]["currency"] or "", p["value"]["amount"]))
    f002 = next(f for f in findings if f["id"] == "F-002")
    f002["competingValues"] = sale_prices
    # The message is written from the array immediately after it is attached, so
    # the two cannot drift (M-010) and no ratio can span two currencies (M-003).
    f002["message"] = compose_f002_message(sale_prices)
    if f002["message"] == F002_MESSAGE_PLACEHOLDER:
        raise SystemExit("F-002 message composition produced the placeholder.")

    blocks = [
        {
            "code": f"B{index:02d}",
            "unitCount": size,
            "dataQuality": "modelled",
            "note": "Block composition is not published by any source; the split is even across the corroborated total of 656.",
        }
        for index, size in enumerate(block_sizes(TOTAL_UNITS_TARGET, BLOCK_COUNT), start=1)
    ]

    reviews = []
    for review, ref, capture in review_obs:
        reviews.append(
            {
                "platform": review.platform,
                "url": review.url or capture.final_url,
                "score": {
                    "value": review.score,
                    "sources": [ref],
                    "confidence": "single_source" if review.score is not None else "gap",
                    **({} if review.score is not None else {"note": "No score stated on the validated snapshot."}),
                },
                "scoreScale": review.score_scale,
                "reviewCount": {
                    "value": review.review_count,
                    "sources": [ref] if review.review_count is not None else [],
                    "confidence": "single_source" if review.review_count is not None else "gap",
                    **({} if review.review_count is not None else {"note": "No review count stated."}),
                },
                "ranking": {
                    "value": review.ranking,
                    "sources": [ref] if review.ranking else [],
                    "confidence": "single_source" if review.ranking else "gap",
                    **({} if review.ranking else {"note": "No ranking stated."}),
                },
                "sentiment": review.sentiment,
                "notableQuotes": review.quotes,
            }
        )

    harvest = [
        {
            "url": e.get("url", ""),
            "publisher": e.get("publisher", ""),
            "tier": int(e.get("tier", 6)),
            "status": e.get("status"),
            "fetchedAt": e.get("fetchedAt", ""),
            "snapshotPath": e.get("snapshotPath"),
            "snapshotHash": e.get("snapshotHash"),
            "bytes": int(e.get("bytes", 0)),
            "contentValidated": bool(e.get("contentValidated")),
        }
        for e in entries
    ]

    confidence_counts: dict[str, int] = defaultdict(int)
    for scope in (project, hotel):
        for value in scope.values():
            if isinstance(value, dict) and "confidence" in value:
                confidence_counts[value["confidence"]] += 1
    for fact in project["contact"].values():
        confidence_counts[fact["confidence"]] += 1

    dataset = {
        "generatedAt": now_iso(),
        "contractVersion": CONTRACT_VERSION,
        "harvest": harvest,
        "project": project,
        "blocks": blocks,
        "units": units,
        "hotel": hotel,
        "reviews": reviews,
        "portalListings": portal_listings,
        "amenities": [],
        "findings": findings,
        "unitSplit": split,
        "coverage": {
            "sourcesTotal": len(entries),
            "sourcesValidated": len(validated),
            "sourcesTierLe3Validated": len(authority),
            "projectFactsByConfidence": dict(confidence_counts),
            "unitObservations": len(unit_obs),
            "parserFailures": len(parser_failures),
        },
    }

    # Checked before the file is written, so the message names the parser rather
    # than arriving later as a tsc error in a file nobody may hand-edit.
    vocabulary = vocabulary_problems(dataset)
    for problem in vocabulary:
        say(f"  ! vocabulary: {problem}")

    emit_ts(dataset)
    emit_sql(dataset)
    emit_csv(dataset)
    DEBUG_OUT.write_text(
        json.dumps(
            {field: [{k: v for k, v in r.items() if k != "ref"} | {"host": host_of(r["ref"]["url"])}
                     for r in records]
             for field, records in sorted(by_field.items())},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )

    say(f"  units: {split['portalListing']} portal_listing + {split['modelled']} modelled = {split['total']}")
    say(f"  findings: {len(findings)}   reviews: {len(reviews)}   portalListings: {len(portal_listings)}")
    say(f"  -> {TS_OUT.relative_to(ROOT)}")
    say(f"  -> {SQL_OUT.relative_to(ROOT)}")
    say(f"  -> {CSV_OUT.relative_to(ROOT)}")

    if args.strict:
        problems = []
        if not captures:
            problems.append("no validated captures")
        if split["total"] != TOTAL_UNITS_TARGET:
            problems.append(f"unit total {split['total']} != {TOTAL_UNITS_TARGET}")
        if parser_failures:
            problems.append(f"{len(parser_failures)} parser failure(s)")
        if vocabulary:
            problems.append(f"{len(vocabulary)} frozen-vocabulary violation(s)")
        if problems:
            print("STRICT: " + "; ".join(problems), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
