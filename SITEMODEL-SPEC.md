# Azura World — Live Site Model Section

**Task id:** `W-SITEMODEL` · **Jira:** INTERNAL-107 · **Route:** `/[locale]` (landing) · **Written:** 2026-07-29

This spec reconciles five surveys and two adversarial verdicts. Where a verdict found a blocker or a major problem, the fix is already applied here — the broken version is not restated. Three further faults found while validating the corrected numbers are marked **NEW**.

---

## 1. What the section is

> **The section shows Azura World's own masterplan as a readable 3D drawing of the site, with the management system's day running visibly across it — every building selectable and sourced, every moving thing labelled as sample activity.**

It replaces the `skewY` plate in `components/azura/operating-map.tsx` as the landing page's operations beat. It is the one surface that answers "what does your software actually do on my site?" without a screenshot of a dashboard.

---

## 2. The corrected geometry

All coordinates in metres, GENERAL-PLAN frame, origin at the plot polygon centroid (verified at `(0.134, −0.013)`). `rotationDeg` is the plan-view angle of the long axis measured from **+x toward +z**. In three.js that is `mesh.rotation.y = -rotationDeg * Math.PI / 180`; in CSS it is `rotateZ(rotationDeg)` applied **inside** the `.azura-iso-field` transform, before the counter-rotation. Getting the sign backwards mirrors the crescent and swaps A with E.

### 2.1 Top-level constants

```ts
plotMetres            = { w: 372, d: 432 }   // derived from vertices, not restated (was 435)
plotAreaSqm           = 73_618               // shoelace of the 11 vertices
blockIParcelAreaSqm   =  2_584
totalPlotSqm          = 76_202               // vs published 76,000 (+0.27%)
storeyHeightM         = 3.2
podiumHeightM         = 4.5
globalYawDeg          = 40, confidence "guessed"
seaDirectionTrue      = "south"
seaDirectionPlanFrame = "plan bearing 140 deg, +/- 25 deg"
metresPerPlanPixel    = 0.63
```

`plot-outline` and `perimeter-ring-road` carry **`geometryFrom: "vertices"` and no `centre`/`size`.** The old boxes were 17 m east and 23 m north of their own polygons.

Plot vertices, clockwise from the north apex:
`(-14,-193) (140,-78) (203,-23) (60,67) (42,94) (25,239) (-27,239) (-38,176) (-145,125) (-54,50) (-169,-73)`

`perimeter-ring-road` = the same ring inset 8 m.

### 2.2 Shape enum (was undefined)

| shape | meaning | extra fields |
|---|---|---|
| `bar` | plain rectangular prism | — |
| `curved-bar` | facade bows on an arc; `size.w` is the **chord**, `curveDeg` is the total sweep, bulge toward the crescent's outer side | `curveDeg` |
| `domed-centre` | `curved-bar` plus a drum and dome above the roof line | `curveDeg`, `domeDiameterM`, `domeHeightM` |
| `string` | zig-zag townhouse run; footprint is a band of `size.d` swept along `polyline` (local `u` along the long axis, `v` across) | `polyline` |
| `fan` | units splayed radially around an arc centre | `fanRadius`, `fanSweepDeg`, `unitCount` |

`curveDeg: 0` is illegal — omit the field instead. `serpentine` is deleted: it was paired with `curveDeg: 0`, which cancels to a straight bar.

### 2.3 Blocks — final

Every block carries **per-field confidence** `{ centre, size, rotation, storeys, shape }`. A single scalar cannot be true when the centre is read, the rotation is fitted, the storeys are counted off a different drawing and the shape is a simplification.

| key | role | storeys | centre (x,z) | size (w×d) | rot° | shape | footprint m² | confidence (c/s/r/st/sh) |
|---|---|---|---|---|---|---|---|---|
| A | residence | 8 | (−119, −52) | 34 × 24 | −80 | bar | 816 | inf / inf / inf / guessed / inf |
| B | residence | 8 | (−95, −94) | 42 × 22 | −55 | curved-bar (26°) | 924 | inf / inf / inf / guessed / inf |
| C1 | residence | 8 | (−62, −124) | 34 × 22 | −29 | curved-bar (19°) | 748 | inf / inf / inf / guessed / inf |
| C2 | **hotel** | 8 | (−13, −137) | 48 × 32 | 0 | domed-centre (27°), dome ⌀18 × 14 h | 1 536 | read / inf / read / guessed / read |
| C3 | residence | 8 | (36, −124) | 34 × 22 | +29 | curved-bar (19°) | 748 | inf / inf / inf / guessed / inf |
| D | residence | 8 | (69, −94) | 42 × 22 | +55 | curved-bar (26°) | 924 | inf / inf / inf / guessed / inf |
| E | residence | 8 | (93, −52) | 34 × 24 | +80 | bar | 816 | inf / inf / inf / guessed / inf |
| F2 | residence | 3 | (54, 45) | 46 × 16 | −32 | string | 736 | inf / inf / inf / guessed / inf |
| H | residence | 3 | (98, 17) | 48 × 18 | −32 | string | 864 | inf / inf / inf / guessed / inf |
| F1 | residence | 3 | (142, −10) | 46 × 16 | −32 | string | 736 | inf / inf / inf / guessed / inf |
| G | residence | 2 | (150, −41) | 38 × 20 | −32 | fan (r 26, 70°, 12 units) | 760 | guessed ×5 |
| I | residence | 8 | (−86, 204) | 62 × 22 | −25 | bar | 1 364 | inf / inf / inf / guessed / inf |
| UNREAD-1 | unknown | 1 | (−13, 29) | 45 × 38 | 0 | domed-centre (open-air amphitheatre, ellipse footprint) | 1 343 | inf ×5 |
| UNREAD-2 | unknown | 1 | (−22, 130) | 14 × 70 | 0 | bar (retail arcade, west row) | 980 | inf ×5 |
| UNREAD-3 | unknown | 1 | (5, 130) | 14 × 70 | 0 | bar (retail arcade, east row) | 980 | inf ×5 |
| UNREAD-4 | unknown | 1 | (−84, 118) | 22 × 14 | −38 | bar (SW-wing building, inside the water-park zone) | 308 | guessed ×5 |
| GATEHOUSE | service | 1 | (−11, 223) | 30 × 20 | 0 | bar | 600 | read / inf / inf / guessed / read |

`endStepDownStoreys: 2` on A, B, C1, C3, D and E — the elevation strip shows terracing at the ends.

**Storeys are `guessed` on every block, and never rendered as a number.** They contradict `project.floorsPerBuilding = 6` (single source) and its conflicting 5. They drive extrusion height only.

**Footprint self-check, published honestly:** 12 lettered blocks = **10 972 m²**. Plus UNREAD-1..4 (amphitheatre as an ellipse) = **14 583 m²**. Plus the gatehouse = **15 183 m²**, against a published `buildingFootprintSqm` of 15 000 — **+1.2 %**. The old spec claimed "about 14 900" and its own numbers summed to 17 358. `footprintSqm` is a field on every block so the sum is machine-checkable.

**buildingCount reconciles.** The developer's own 3D site plan letters exactly eleven keys (A, B, C1, C2, C3, D, E, I, F1, F2, H) and additionally carries `? BLOK` labels on the amphitheatre and the two arcade rows. 11 + 3 = **14 = `project.buildingCount`**. G is real but appears only in the Alanya-Home renders and one caption, so it sits outside that arithmetic; UNREAD-4 is a fourth unread label with no counterpart in the published count. The spec no longer claims the gap is unresolvable and no longer invents keys M and N.

### 2.4 Non-building features — final

Every feature now carries **`rotationDeg`** (the old schema had none while four notes demanded one) and **`featureClass`**. `zone` may contain other features; `structure`, `water` and `surface` may not intersect a block or each other.

| key | class | centre (x,z) | size (w×d) | rot° | notes |
|---|---|---|---|---|---|
| plot-outline | zone | *(vertices)* | — | 0 | `geometryFrom: "vertices"` |
| perimeter-ring-road | surface | *(vertices, inset 8 m)* | — | 0 | `geometryFrom: "vertices"` |
| block-I-parcel | zone | (−86, 204) | 68 × 38 | **−25** | detached; block I is contained in this, **not** in `plot-outline` |
| lagoon-pool | water | (−11, −45) | 76 × 74 | 0 | largest water body |
| lazy-river | zone | (−4, −20) | 100 × 145 | 0 | `geometryFrom: "ring"`, 14 m channel; a loop, not a solid |
| lap-pool-west | water | **(−78, −46)** | 56 × 14 | **+41** | sign flipped from −38; see the discrepancy below |
| lap-pool-east | water | **(53, −47)** | 56 × 14 | **−47** | sign flipped from +37 |
| aquapark | zone | (−84, 118) | 46 × 34 | −38 | contains UNREAD-4. Do **not** claim 13 slides from geometry |
| tennis-court | surface | (−52, 104) | 34 × 17 | −38 | `sourceKind: "render-backprojected"` |
| car-park | structure | (−110, 110) | 26 × 20 | −38 | the plan's large SW rectangle with the `OTOPARK`-like label |
| childrens-playground | zone | (−56, 74) | 42 × 26 | −38 | |
| circular-pool-west | water | (−51, 74) | 24 × 22 | 0 | `within: "childrens-playground"`; the plan labels it as a children's pool |
| kids-club-circle | zone | (20, 68) | 26 × 24 | 0 | |
| landscaped-spine | zone | (−8, 122) | 40 × 190 | 0 | contains the canal and both arcade rows |
| spine-canal | water | (−9, 128) | 11 × 156 | 0 | `within: "landscaped-spine"`; a mirror pool, not swimmable |
| surface-parking | surface | (25, 125) | 18 × 60 | 0 | note reworded: *immediately east of, and outside, the spine zone* |

The retail arcade and the amphitheatre are **no longer features** — they are blocks UNREAD-1..3.

### 2.5 Discrepancies that survive, and must be recorded in the data file

1. **The plan's own lap-pool line passes through block A's fitted footprint.** Measured off the raster, the west pool runs `(−120,−76) → (−78,−38)`. Block A on the fitted r = 100 circle occupies `x −134..−104`. One of the two readings is wrong and the raster cannot settle it. **Decision: keep the arc** (seven centres lie 99.8–100.4 m from `(−13,−37)`, every rotation is the exact tangent to 0.5° — the strongest internal evidence in the whole spec), keep the **plan-measured orientations** (+41 / −47), and re-place the pools into the largest courtyard gap that clears every block. `sourceKind: "plan-measured-orientation, fitted-position"`, `confidence: "inferred"`.
2. **Block long-axis angles come from a circle fit, not from the plan.** The plan's lap-pool orientations disagree with the fitted tangents by 35–45°. The elevation strip is an unrolled projection and cannot yield plan angles.
3. **NEW — the original tennis court was outside the plot.** `(−109, 84)` fails point-in-polygon: the west boundary at z = 84 is x ≈ −96. The notch between the two western protrusions was never checked. The verdict's own suggested aquapark box `(−80,118) 62×56` also escapes. Both are corrected above.
4. **NEW — five more escapes, all corrected:** the gatehouse (corner at `(−29,233)`, stem edge is `−28.05`), the landscaped spine (corner `(−33,226)`), surface parking (corner `(43,151)`), the lazy river (corner `(−66,53)`), and H / F1 / G, which sat outside the south-east barb entirely.
5. **NEW — block I never fitted its own parcel.** 62 × 22 at −25° has a 65.5 × 46.1 m axis-aligned bounding box against a declared axis-aligned 66 × 38. Parcel is now 68 × 38 **at −25°**, co-rotated with the block, and I is tested against the parcel rather than the plot ring.
6. **`dataset.blocks[]` is B01..B07 and nothing joins it to A/B/C1/C2/C3/D/E.** Any mesh labelled "Block A" that also renders a unit count from B01 asserts a join no source supports. **This section renders block letters from the plan and never a per-block unit count.**
7. **`hotel.roomCount = 188` is not attributed to C2.** C2 is badged HOTEL on the render; nothing says the 188 rooms are its.
8. **Every feature is unsourced.** `dataset.amenities` is empty (`AzuraAmenity = never`, CONTRACT-GAP-02). The lagoon, water park, courts, amphitheatre and spine are pixels in six drawings. They carry no confidence above what an image citation supports.

---

## 3. Rendering decision

### **CSS 3D / DOM. No WebGL. Decided.**

The reference settles it empirically: `site-command-simulation.tsx` is a live-operations 3D site model of eight blocks and 769 units, it is one of the most premium-reading surfaces in that product, and it contains zero WebGL. This repo has independently rediscovered the same thing twice — `globals.css` `.azura-iso-*` is a strictly better version of the reference's `.site-*` system, and `components/azura/masterplan.tsx:21-23` already states the argument.

The deciding constraint is `SourcedFact<T>`. A number inside a canvas cannot carry a `ProvenanceValue` popover, cannot be counted by `pnpm qa:evidence`, cannot be selected, indexed, or read by a screen reader. Putting operations figures into WebGL does not cost polish, it breaks the project's central invariant. And the scale is DOM-sized: 16 volumes, not 656.

**Concretely:**

- Reuse the existing `@layer utilities` block at `globals.css:773-918`: `.azura-iso-scene` (`perspective: 1000px; transform-style: preserve-3d`), `.azura-iso-sea`, `.azura-iso-ground` (`rotateX(64deg) rotateZ(-8deg)`), `.azura-iso-field` (`rotateX(58deg)` — deliberately different, so buildings parallax against the plate), `.azura-iso-slot`, `.azura-iso-block`, `.azura-iso-block::before` (the `rotateY(84deg)` side wall), `.azura-iso-window`, `.azura-iso-shadow` (`filter: blur; translateZ(-12px)`), `.azura-iso-label` (`rotateX(-58deg) rotateZ(8deg)`, the exact inverse, or the text lies flat).
- Geometry reaches CSS as **custom properties written from JSX**, never as inline transform strings: `--iso-x`, `--iso-z`, `--iso-w`, `--iso-d`, `--iso-rot`, `--iso-h`, `--sim-pulse`. The plot polygon and every feature is an inline `clip-path: polygon(...)` — `style-src 'self' 'unsafe-inline'` covers inline style attributes.
- **Zero new globals.css classes.** No W1-D dependency for layout. (One token request, §5.)
- Depth ordering is `translateZ` plus back-to-front source order — never `z-index`, which fights `preserve-3d`.
- Any keyframe on a transformed element restates the full transform.
- **Zero bytes against the 260 KB three.js budget.** The section contains none of `WebGLRenderer`, `PerspectiveCamera`, `BufferGeometry`, `react-three`, so both harnesses charge it to the 250 KB landing budget, where it costs ≈ 8 KB gz. File names deliberately avoid `/three|r3f|drei|maquette|coast/i` so `scripts/landing-budget.mjs` and `scripts/quality-gate.mjs` agree.
- **The R3F `CoastMaquette` is not promoted and not modified.** It stays on `kitchen-sink`, data-less and decorative, which is the only job it can honestly do. It is not added to the landing route, so the 60 s soak's `canvases <= max(1, first)` assertion is untouched.

### 3.1 Frameloop policy

There is no renderer, so there is no frameloop. There is **one tick source, and it is the one that already exists**:

```
gsap.ticker  ──▶ lenis.raf()            (existing, lenis-provider.tsx)
             ──▶ siteModelTick(time)    (new, added and removed by this section)
```

- `registerGsap()` is the first statement inside the effect, after the early returns (`components/anim/gsap.ts`).
- The callback accumulates and early-returns until `TICK_MS = 250` real ms have elapsed. It is **not** a second `requestAnimationFrame` loop.
- Teardown calls `gsap.ticker.remove(tick)` and never touches `lagSmoothing`.
- On `document.hidden` the tick returns immediately and the simulation clock pauses. It does **not** fast-forward on resume (`lib/simulation-clock.ts:110-171` already implements this — use `createSimulationClock`).
- Scroll coupling is quantised, not continuous: the section opts into `LandingChoreography` with `data-rise` and `data-parallax` only. No new `gsap.context`, no ScrollTrigger owned by this section, no `pin:` anywhere. Pinning, if wanted, is `position: sticky` inside `@media (scripting: enabled) and (prefers-reduced-motion: no-preference)`.

### 3.2 The four fallbacks

| condition | what renders |
|---|---|
| **No JavaScript** | The full DOM: the isometric plate with every block and feature in its final position, the block list, every `ProvenanceValue` figure, the source strip, the sample-activity banner, and the feed pre-rendered at `TICK_FINAL` (see §4.6). The section is authored server-side; the client component only *animates* what the server already painted. Nothing is hidden first. |
| **`prefers-reduced-motion: reduce`** | Identical to the no-JS state, and the ticker is never registered. **The feed is complete, not paused at frame one.** No block pulse, no travelling dots, no float. `data-reveal` is present on any element that would otherwise be hidden, so the `globals.css:489-496` safety net restores it. Lenis does not mount at all. |
| **Narrow viewport (< 1024 px)** | A genuinely different cheap path, not a squashed plate: the isometric scene is replaced by a **flat top-down plan** — the same `clip-path` polygon and the same block rectangles, no `perspective`, no `preserve-3d`, no shadows, no side walls, one CSS layer. The feed stacks below it. The switch is a CSS container/media query on the section, so it costs no JavaScript and no layout thrash. The simulation still runs; it pulses the flat rectangles. |
| **Anything fails at runtime** | The client component is wrapped in an error boundary that renders the server DOM unchanged and shows `siteModel.states.error`. There is no frame in which the box is empty and no spinner that never resolves. |

`motionTier()` and `isWebGLAvailable()` are not used — there is no WebGL context to probe, and `WEBGL_MIN_HARDWARE_CONCURRENCY` does not apply. `saveData === true` **does** suppress the ticker (final state only), because a metered connection is a signal about the device, not only the network.

---

## 4. The live simulation

### 4.1 What was wrong, and what replaces it

Fourteen independent Poisson streams cannot demonstrate an ERP: they dispatch and resolve reports that were never opened. The one thing an ERP does that a spreadsheet cannot is **link records**. So:

- **Only intake events are sampled.** Everything else is a *scheduled consequence* of a specific simulated record, carrying the same reference and the same block.
- **Two clocks.** A continuous stream at a declared compression, and a scripted milestone track so the four most ERP-demonstrative events actually appear in a ten-minute viewing.
- **No unit identifiers are printed, ever.** F-011 states that block/sequence ids are internal addressing keys and not developer unit numbers. Printing `AZW-B03-0071` invites Azura World to look up an apartment that does not exist under that number, and forces a modelled-record notice onto 96 % of rows. The feed names **the block letter and a plain-language subject**. This also makes the `B03 · AZW-B01-0056` coherence bug structurally impossible.
- **Hotel events are rhythm markers, not a rate.** The old 0.032/min derived 23 arrivals a day from an invented occupancy (85 %), an invented stay length (7 nights) and a conflicted room count (188). All three are gone. Check-in 14:00 and check-out 12:00 are `confirmed` with two sources, so the *shape of the day* is real and that is all that is shown.
- **`lift_fault` is a subtype of intake**, not an additive stream — a lift fault is a `service_tickets` row in this schema (the seed's own AZW-T-0002 is exactly that), and modelling it separately double-counted intake.
- **The service charge run is on the calendar, not the dice.** A monthly billing run that fires at random is wrong about what the record means.
- **No `reservation_confirmed`.** There is no reservations table in any migration.
- **No money, anywhere.** Not in the feed, not in the block panel, not in a tooltip.

### 4.2 Clocks

```ts
export const OPERATING_MINUTES_PER_DAY = 720;   // 12-hour operating day
export const SIM_MINUTES_PER_REAL_SECOND = 2.5; // 150x compression, stated on screen
export const TICK_MS = 250;                     // 0.625 simulated minutes per tick
export const TICKS_PER_SIM_DAY = 1152;          // 288 real seconds
export const MILESTONE_LOOP_TICKS = 480;        // 120 real seconds
export const TICK_FINAL = 2304;                 // the reduced-motion / no-JS frame: two simulated days
```

The compression is printed in words: *"One second here is about two and a half minutes of a normal day on site."* Inflating the rates instead of declaring the compression is the dishonest version of the same fix.

### 4.3 Continuous track — sampled intake

Rates are per **simulated operating minute**. Every one divides `OPERATING_MINUTES_PER_DAY = 720`, which is now an exported constant rather than an unstated assumption.

| event | rate/min | per day | target | group | derivation |
|---|---|---|---|---|---|
| `report_opened` | 0.025 | 18 | block (from the drawn unit's own blockCode) | intake | ≈ 0.8 reports per apartment per month across 656 apartments plus pools, lifts, water park and grounds. Correct order for stock completed May 2024. **2 % of draws target a shared asset and render as `lift_fault`.** |
| `resident_message` | 0.035 | 25 | block | intake | ≈ 1 per apartment per 26 days. Unremarkable for foreign owners across four languages. Six real channels exist. |
| `payment_received` | 0.030 | 21.6 | site | money | 656 apartments settling a monthly charge. Clusters around the due date in reality; if the run crosses one, the cluster is more honest than a flat drip. |
| `payment_overdue` | 0.004 | 2.9 | block | exception | **NEW.** The single most valuable ERP function for a property manager, missing from the old model entirely. No amount is shown: *"a charge on an apartment in block D passed its due date"* is the whole argument. |
| `finance_approval_requested` | 0.003 | 2.2 | block | money | **NEW.** `requires_finance_approval` is a real column that the old model named in a rationale and never used. |
| `document_filed` | 0.012 | 8.6 | block | work | ≈ 9 a day across 656 apartments. Twelve real categories in `document-data.ts`. |
| `activity_opened` | 0.003 | 2.2 | block | work | ≈ 2 a day. Seed vocabulary exists: sunrise yoga on B02's pool terrace, a kids-club water-park afternoon, a tennis tournament. |
| `vendor_invoice_approved` | 0.002 | 1.4 | site | money | ≈ 43 supplier invoices a month. Ties back to the report that caused it. |

**Sampled total: 0.114/sim-min.** With consequences, ≈ 0.16/sim-min = one row every ≈ 2.5 real seconds. Readable.

### 4.4 Consequences — scheduled, never sampled

Each `report_opened` creates a **simulated report record** in the reducer state:

```ts
interface SimReport {
  n: number;                 // rendered as "Sample report {n}"
  block: string;             // the drawn unit's own blockCode. Never a second draw.
  shared: boolean;           // lift / pool / grounds rather than an apartment
  openedTick: number;
  assignTick: number | null; // opened + rng(4..40 sim-min), 88% of reports
  resolveTick: number | null;// assigned + rng(90..600 sim-min)
  slaTick: number;           // opened + 240 sim-min; 8% of reports miss it
}
```

- `report_assigned` fires at `assignTick`. **88 %** of opens — the remainder are `reject`ed (a real transition; there is no merge transition, and the old rationale's "merged as duplicates" claim is deleted).
- `report_resolved` fires at `resolveTick`. **Resolve rate equals assign rate in steady state.** The old model encoded +0.002/min of permanent drift — 518 extra open reports a year, which over a long demo becomes an accusation about their operation. Instead the state seeds a **fixed initial backlog of 6 open reports** at tick 0, so the feed shows work in progress without implying deterioration.
- `report_overdue` fires at `slaTick` for the 8 % that miss it. Deliberately far below the seed fixture's 2-in-9 — that fixture was built to exercise every state, not to describe a healthy site.
- `hotel_check_out` schedules a **cleaning report** 20 sim-min later, carrying its own reference. One event producing another, visibly.
- `finance_approval_requested` on a report with a high estimated cost blocks its `assignTick` until the following tick, so the viewer sees the job wait for sign-off.

All three lifecycle rows render **`Sample report {n}`** and the **same block letter**, so a viewer can watch one record move. That is the entire ERP argument and the old model could not produce it.

**Correction to the model's prose:** `lib/ticket-workflow.ts` has **15** transitions, not 12: `submit, discard_draft, assign, reject, start, hold, resume, resolve, verify_and_close, reopen, reopen_closed`, plus four `cancel` variants. There is no `close` — it is `verify_and_close`.

### 4.5 Milestone track — scripted, with its true cadence printed on the row

Placed at fixed tick offsets inside a `MILESTONE_LOOP_TICKS = 480` (120 real second) loop, so each appears at least once per viewing. **Each milestone row prints how often it really happens**, which is what stops its on-screen frequency from being a claim.

| tick offset | event | cadence string on the row | render |
|---|---|---|---|
| 48 | `hotel_check_in` | *Happens every afternoon* | Fires only when the simulated clock is past 14:00. Names the hotel and nothing more: no room number, no room type, no guest, no rate, no occupancy, no stay length. `public.hotel_rooms` ships empty on purpose and its own table comment calls a plausible room mix "precisely the fabrication SYSTEM-PROMPT.md 2.3 forbids." |
| 136 | `lift_fault` | *Happens about every six weeks in a building* | ≈ 1 callout per building per six weeks over 14 buildings. Targets a **block**, not an apartment. |
| 232 | `hotel_check_out` | *Happens every morning* | Fires only before 12:00. Schedules the cleaning report. |
| 344 | `service_charge_run_posted` | *Runs once a month* | **One row**, naming the run and the number of accounts touched — never 656 rows scrolling past. Posted ledger entries are immutable by trigger, which is worth saying. No amount. |
| 440 | `unit_handover` | *Happens about once a month* | Lowered from 3/month: at 3/month the remaining ~25 unsold units are exhausted in eight months, contradicting the model's own framing that most handovers are behind them. Real supporting records exist: the pipeline ends `title_deed → handover → closed`, `documentCategories` includes `handover`, and the seed carries a handover protocol and a key-handover thread. |

Loop index `k` rotates the offsets by `k * 37` ticks so the sequence is not metronomic, deterministically.

### 4.6 The loop — deterministic, and it does not thrash React

**`Math.random()` and `Date.now()` are banned in this section.** Three reasons, all already written down in `lib/simulation-clock.ts:1-26`: Playwright snapshots must be stable, the first server frame must equal the first client frame, and a bug in a feed is only reproducible if the feed is. `ScrambleTextPlugin` is not registered for exactly this reason.

```ts
// lib/site-simulation.ts — pure, no React, no DOM, importable by the server
export function simulationStateAt(tick: number, seedKey: string): SimState
export function stepSimulation(prev: SimState, tick: number, seedKey: string): SimState
```

- `const rng = createRng(hashSeed(`${seedKey}:${tick}`))` — one PRNG per tick, from `lib/simulation-clock.ts`.
- Timestamps come from `simulationTime(tick, TICK_MS)` off `SIMULATION_EPOCH`, formatted by `formatSimulationTime` — **time only, never a date**, so nobody checks it against today.
- `simulationStateAt(0, …)` is what the **server** renders. `simulationStateAt(TICK_FINAL, …)` is what **reduced motion and no-JS** render. Both are pure and hydration-identical.

**State discipline — the two-lane rule:**

| lane | what | mechanism | frequency |
|---|---|---|---|
| **Discrete** | the feed list, the open-report count, which block is selected | one `useReducer` dispatch, and **only when `stepSimulation` returns at least one new event** | ≈ 0.4 dispatches/second |
| **Continuous** | block pulse, dot travel, canal brightness, decay | the ticker writes CSS custom properties **directly on refs** — `el.style.setProperty("--sim-pulse", v)` — plus a CSS transition on `opacity`/`transform` at `--duration-base` | never touches React |

The ticker holds `useRef` handles to the 16 block elements and the canal element, resolved once on mount. React re-renders at most 25 times a minute; the animation runs at 60 fps on the compositor. Nothing animates `width`, `height`, `top`, `box-shadow` or `filter`. Every duration and easing comes from `lib/motion.ts` (`duration.fast` 0.2 / `duration.base` 0.32 / `duration.slow` 0.5; `ease.out` = `power3.out`; `cubic.coastal` = `[0.16, 1, 0.3, 1]`). No hardcoded `0.42s`. No `ease-in`.

### 4.7 What each event does visually

Four groups. **Colour is never the only carrier** — every group has a distinct icon (lucide only) and a text label in the legend, and every feed row carries the group name in words.

| group | events | map | token |
|---|---|---|---|
| **intake** | `report_opened`, `resident_message` | the target block's `--sim-pulse` goes 0 → 1 and decays over `duration.slow`; a `MessageSquare` / `Wrench` dot rises 12 px off the roof and fades | `--chart-2` |
| **work** | `report_assigned`, `report_resolved`, `document_filed`, `activity_opened` | a 6 px dot travels the block's own long edge in `duration.slow`, `transform: translate3d` only | `--chart-3` |
| **money** | `payment_received`, `vendor_invoice_approved`, `service_charge_run_posted` | the spine canal's opacity lifts from 0.4 to 0.85 and settles; on the charge run, every block flashes once in sequence with a `stagger.tight` of 0.03 s, capped at `STAGGER_CAP = 12` | `--chart-1` |
| **exception** | `report_overdue`, `payment_overdue`, `lift_fault` | the block outline switches to `--destructive` for 2 s and an `AlertTriangle` glyph appears at the label | `--destructive` |
| **milestone** | `hotel_check_in/out`, `unit_handover` | C2 (hotel) or the target block gets a single slow ring expansion at `duration.hero`, once | `--primary` |

**Token verification is mandatory in the night palette**, because the immersion band renders inside `data-surface="night"` (`app/[locale]/page.tsx:211`). Known collisions to avoid: `--chart-1 == --primary` in light and night — so `--primary` is reserved for milestones and `--chart-1` for money, and the two never appear in the same row. Dark `--chart-3 == --confidence-confirmed` — acceptable only because no confidence vocabulary is present on this surface at all, and the legend names the group in words.

**No provenance framing, at all.** No source chips, no confidence badges, no conflict popovers, no "n sources" caption, no evidence band, no tier, no snapshot hash, no findings count. `--confidence-*` and `--quality-*` are not used. The `ProvenanceValue` component **is** used for the five real figures in the DOM panel — that is a source link on a fact, not a research badge.

**No integration is shown as healthy.** There is no sync indicator, no freshness vocabulary, no green connector. The admin surface already states the position: not one service is set up.

---

## 5. Honesty

### 5.1 The label concept, in English

> **Sample activity.** The buildings and the block letters are Azura World's. Everything moving across them was created for this demonstration and is marked as sample data throughout the system.

That is the whole rule in one sentence. German is authoritative and is written separately; the word is **Beispieldaten**, never Demo-Daten, never live, never Echtzeit.

### 5.2 How it is labelled

1. **`SimulationBanner`** from `components/immersion/simulation-label.tsx`, in **normal document flow** above the plate. Not overlaid, not sticky-coverable, not croppable off the top. Real text, so it survives a print and a screen reader. **Do not write a new label component.**
2. **`SimulationChip`** in the stage header and again in the block panel's activity half.
3. **A per-row disclosure that survives a bad crop in greyscale.** Every feed row renders, in this order: a `FlaskConical` glyph (always this glyph, never the category icon), the literal word from `siteModel.feed.rowPrefix`, then the simulated time, then the block letter, then the sentence. The category icon sits at the *end* of the row. A cropped single row still reads `⚗ Sample · 09:14 · Block B03 · A fault was reported`. The old design put the category icon in the disclosure slot and deleted the only per-row marker that existed.
4. **A text strip inside the plate's own box**, along its bottom edge, carrying the same words. A crop that keeps the drawing keeps the strip.
5. **The compression sentence**, printed in plain words next to the feed.
6. **The schematic caption**, part of the component and not the page that embeds it: *the layout is a drawing, not a survey.*
7. **The identifier caption**: apartment numbers are not shown, and the reference codes in this system are internal addresses.

### 5.3 The disclosure colour must be fixed first

`--simulation` is **byte-identical to `--confidence-conflicted`** in all three palettes: light `#8a5200`, dark `#f0b45c`, night `#f2b862`. A reader who learned amber means *Widerspruch* on the same page reads the banner as a conflict badge. The rule "those two tokens appear nowhere else in the build" is currently false.

**This is a blocking precondition.** Filed under §8 as a request to W1-D: give `--simulation` its own hue in all three palettes, at least 20 % relative-luminance apart from `--confidence-conflicted` so it separates in greyscale, and add a quality-gate assertion that no two semantic tokens in `globals.css` resolve to the same hex. Until it lands, the section still passes its own honesty test because every disclosure is **words plus a glyph**, not hue.

### 5.4 Rules this section holds to

- **Never invent money.** No euro figure appears anywhere in this section. A payment event says a payment was matched; that is more honest and reads better. Amounts in different currencies are never summed.
- **The block always comes from the drawn record's own `blockCode`.** Never a second draw.
- **Nothing in the feed is a link.** References render as text. The **block buttons** are links (they write `?block=B03`, resolved server-side so a cited link works with JS off) — but they open a panel whose two halves are separately headed *Your building* (real figures through `ProvenanceValue`) and *Sample activity* (chipped).
- **No per-block unit count is printed as a fact about Azura World.** No source publishes how 656 units divide across 7 blocks; the 94/94/94/94/94/93/93 split is an even division and every block row is `dataQuality: "modelled"`. The block letter without a count is the safe rendering. Where the section shows a count for a block, it is the count of **open sample reports** and it is labelled as such.
- **The hotel has no rooms in this system.** Check-in and check-out name the hotel and nothing more specific.
- **Every string is translated, German is authoritative, no em dashes, no hardcoded German in a `.tsx`.**
- **Closing test.** Screenshot any frame, crop it badly, print it greyscale, hand it to someone who missed the meeting. If they could mistake it for Azura World's live operations, the labelling has failed regardless of how correct the code is.

### 5.5 Two shipped strings that overclaim and must be amended first

- **`landing.system.demoNote`** says *"Bestand, Blöcke und Hotelzimmer entsprechen Ihrer Anlage. Die Vorgänge darin sind Beispieldaten: Meldungen, Buchungen und Dokumente…"*. `public.hotel_rooms` is empty, `roomCount = 188` is conflicted against a Wyndham-era 112, and there is no bookings table in any migration. **Drop "Hotelzimmer" from the list of things that correspond to their property, and replace "Buchungen" with "Zahlungen".** Request to the window owning `app/sections/system.tsx` — this section must not reuse the string until it is amended.
- **Four `seedNotice` strings** (`dashboard.documents`, `dashboard.compliance`, `dashboard.users`, `dashboard.admin.audit`) open with "Demodaten.", which the vocabulary gate would reject as `Demo-Daten` if it scanned them. Request to normalise to Beispieldaten.

---

## 6. New images to publish

**Hard precondition.** `lib/media-manifest.ts` reports `attributed_display 0 / internal_only 789 / unknown 44` and says `delivery: "internal"` assets must never appear on a public route, while `lib/journey-media.ts` claims its 21 entries were promoted. **Resolve `MEDIA-LICENSE.md` before promoting anything below.** Then run `node scripts/publish-journey-media.mjs` — `journey-media.ts` is generated and must not be hand-edited — and `node scripts/journey-media-guard.mjs`.

Two new acts are added to `JourneyAct`: `"construction"` and `"residence-interior"`. The five existing acts keep their names.

### 6.1 Required by this section (12 assets)

**`cut` — the source the geometry was fitted to.** This is the single most important publish in the list: the section asserts a masterplan and must show the drawing it read.

- `azw-azuraworld-com-38780992492b` (1533 × 1600, `category: "siteplan"`) — the developer's numbered 3D masterplan, alt "vaziyet Plani". The only first-party plan asset in the entire harvest, and currently unpublished while three TERRA floorplans occupy the act.

**`construction` — the delivery-timeline evidence strip**, six dated frames, oldest to newest, each captioned with the burnt-in date and **never with its harvested alt text**. All 42 assets in this folder carry alt "Plan 1".."Plan 44" and are not plans: they are dated drone progress photos. `constructionProgress = true` is correct on exactly those 42, so the flag is trustworthy and the alt is not. Any surface rendering alt verbatim captions a construction photo as a floor plan.

- `azw-cebecigroup-com-f4d095e145af` — 08.06.2023
- `azw-cebecigroup-com-66f008a67b46` — 31.08.2023
- `azw-cebecigroup-com-7f0e75e3d800` — 25.12.2023
- `azw-cebecigroup-com-271e458ca98c` — 22.02.2024
- `azw-cebecigroup-com-f4a8d0aa48d6` — 26.04.2024
- `azw-cebecigroup-com-c58fe5dea57e` — 27.08.2024

**`approach` — siting, small and captioned beside the plate.**

- `azw-cebecigroup-com-215b53ebb383` — annotated coastal aerial, AZURA WORLD / beach club / shopping centre labelled
- `azw-cebecigroup-com-c55341c472be` — wide aerial of the complex in its landscape

**`complex` — the ensemble as one object**, to corroborate the crescent the drawing asserts.

- `azw-cebecigroup-com-693ac9cc6c61` — curved blocks wrapped around the lagoon
- `azw-cebecigroup-com-5b47014d264e` — the complex and its pools from the seaward side
- `azw-cebecigroup-com-2e105cfd4955` — across the pool system between the two wings

**Rights posture for this section:** these are **small, captioned, sourced, as evidence** — a strip beside the drawing with a visible publisher credit. **Not full-bleed hero decoration.** 833 harvested assets carry `usage: internal_only` and this repository is public.

**Category correction to make in the manifest before publishing:** the 43 cebecigroup "Image 1".."Image 43" assets are classified `category: "render"` and are photographs — real drone frames of a built resort. `journey-media.ts` deliberately labels non-photo categories in the UI, and labelling these as renders understates them. Re-check the field before it drives the label.

### 6.2 Queued for the journey acts, same pass (not consumed by this section)

- **`hotel-exterior` (NEW act, 5):** `azw-azuraworldhotel-com-4273f710323a`, `azw-azuraworldhotel-com-8ad0e9763be0`, `azw-azuraworldhotel-com-d3c5f1ea072b`, `azw-azuraworldhotel-com-0b6455f87ec1`, `azw-cebecigroup-com-539404b6ba33`
- **`aquapark` (NEW act, 6):** `azw-cebecigroup-com-2a27f12681fd`, `-1601fb769452`, `-5d50fbf69d4b`, `-a26442d9c7cb`, `-741f53d266b4`, `-2c68329dca65`
- **`lobby` (NEW act, 5):** `azw-azuraworldhotel-com-a3169ece0243`, `-9bd68e3e429a`, `-15251a2fa921`, `-8ef66074b16f`, `-45f502fe3def`
- **`restaurant-bar` (NEW act, 6):** `azw-azuraworldhotel-com-f3d55b0815c0`, `azw-cebecigroup-com-f87189c2f428`, `-05d15a5d86da`, `-43f83370c2b2`, `-6cc725c9d917`, `-94fbb135a728`. Also **move** the three already-published bar/restaurant frames out of act `grounds`, where they are wrong: `azw-azuraworldhotel-com-fce38d965709`, `-4d29956b9d38`, `-507b55eb1bc5`.
- **`spa` (NEW act, 7):** `azw-cebecigroup-com-e79185867bab`, `-3f8ab7c89b3c`, `-a40e56b22515`, `-74d079b109d2`, `-45cff1de8ad2`, `-660efe0afdf3`, `-288f5196c615`
- **`kids` (NEW act, 3):** `azw-cebecigroup-com-4511ad8bd579`, `-092640a98c65`, `-08ceec03d1f8`
- **`sport-and-service` (NEW act, 4):** `azw-cebecigroup-com-7010d8e1002e`, `-55b1046639d4`, `-c27b4377ef7e`, `-1f5176635172`
- **`grounds` (6 more):** `azw-cebecigroup-com-ce462dee3e76`, `-1192ef6642d4`, `-d4b28bb7cbab`, `-a2a693d4a0ba`, `-d9a324f4f761`, `azw-azuraworldhotel-com-525a7f9b29de`
- **`room` — the real hotel rooms (7):** `azw-azuraworldhotel-com-0bfeeb278049`, `-2dfeebd578a0`, `-3bab15695e68`, `-80dcc04e99a7`, `-491e6cce1ca1`, `-86603ec744a2`, `-d196264a3624`
- **`residence-interior` (NEW act, 7 cover frames):** `azw-cebecigroup-com-cb9c5a287ff5` (AW E-33 1+1), `-4f7cdc5d8751` (AW E-34 2+1), `-f577659f2f41` (AW E-35 2+1 XL), `-3f3562d19e8f` (AW E-37 2+1 XL), `-651116c17172` (#134), `-328fb0afe8f8` (#135), `-cc8c48af2dcd` (#136). **The existing act `room` currently holds six of these show-flat frames and must be re-acted** — they are residence photos, not hotel rooms.

### 6.3 Hard exclusions

| asset | why |
|---|---|
| `azw-azuraworldhotel-com-4800a02eb429` | captioned "Azura Deluxe World", a different Cebeci property. Not usable as a hero until someone confirms which building it is. |
| `azw-cebecigroup-com-eaf57fd13f6c` | third-party licensed cartoon characters visible. |
| `azw-azuraworld-com-7910d02e5b7b`, `-2ae6b1e5414a` | YouTube thumbnails on i.ytimg.com, not first-party, and the films are not embedded. |
| `azw-azuraworld-com-7cab8c2e1a2e`, `-2f6edc1b90ca` | undetected duplicates of the two above; the harvester's dedupe did not fire on either pair. |
| `azw-azuraworldhotel-com-637b917c9a23` | 2400 × 176, a decorative header sliver. Add a minimum-height or aspect-ratio floor to the filter. |
| Show-flat unit labels on folders #134 / #135 / #136 | 43 photographs with no unit label anywhere in the harvest. Do not caption them with a unit type. Every file in all seven folders is named `aw_e-39_1_1-NNN.jpg` regardless of folder; **the filename slug cannot be used to infer unit type or bedroom count.** |
| Interleaving hotel photography with progress aerials without dates | the hotel material shows a finished five-star hotel; the aerials show the residence blocks under construction as late as August 2024. Mixing eras is a claim. The construction strip is dated on every frame. |

---

## 7. i18n keys

Namespace: **`siteModel`**, a new top-level key in all four catalogues. Keys are English, dotted, grouped by surface. **No arrays** — the four legend entries, the sixteen event labels and the ten feature names are numbered/named object keys, never a JSON list, because an array makes the key-parity rules unanswerable.

English source strings below. German is authoritative and written separately.

```jsonc
"siteModel": {
  "eyebrow": "Site and operations",
  "heading": "Azura World, building by building",
  "intro": "This is the layout of the development, drawn from the developer's own site plan. Sample activity from the management system runs across it, so you can see what a working day looks like.",
  "schematicNotice": "The layout is a drawing, not a survey. Positions and heights are read from published plans and photographs.",

  "sample": {
    "chip": "Sample",
    "title": "Sample activity",
    "body": "Nothing on this map comes from your operations. The buildings and the block letters are yours. Everything moving across them was created for this demonstration.",
    "speed": "One second here is about two and a half minutes of a normal day on site.",
    "identifiers": "Apartment numbers are not shown. The reference codes in this system are internal addresses, not the developer's apartment numbers.",
    "paused": "Sample activity pauses while this tab is in the background."
  },

  "legend": {
    "heading": "What the markers mean",
    "intake": "Something came in",
    "work": "Work in progress",
    "money": "Money and billing",
    "exception": "Needs attention",
    "milestone": "A milestone"
  },

  "blocks": {
    "heading": "Buildings",
    "residence": "Apartments",
    "hotel": "Hotel",
    "shared": "Shared building",
    "select": "Show block {code}",
    "selected": "Block {code}",
    "yours": "Your building",
    "activity": "Sample activity",
    "openReports": "{count} open sample reports",
    "heightNotice": "Heights on this drawing are counted from photographs, not taken from a published figure.",
    "unlabelled": "This building is drawn on the site plan, but its letter cannot be read at the resolution we have.",
    "countNotice": "How the apartments divide between the buildings is not published. This system holds its own even split and shows the letter without a number."
  },

  "features": {
    "notice": "The pools, the water park and the gardens are read from published drawings and photographs. No source lists them.",
    "lagoon": "Lagoon pool",
    "lazyRiver": "Lazy river",
    "lapPool": "Lap pool",
    "aquapark": "Water park",
    "amphitheatre": "Open air theatre",
    "spine": "Central gardens",
    "canal": "Water channel",
    "arcade": "Shops and restaurants",
    "playground": "Playground",
    "kidsClub": "Kids club",
    "tennis": "Tennis court",
    "carPark": "Car park",
    "parking": "Visitor parking",
    "gatehouse": "Gatehouse",
    "beach": "Beach"
  },

  "feed": {
    "heading": "A working day, in sample form",
    "summary": "A list of sample events across the buildings. It repeats, and it is not connected to any live system.",
    "rowPrefix": "Sample",
    "reference": "Sample report {n}",
    "empty": "No sample activity yet.",
    "block": "Block {block}",
    "shared": "Shared area"
  },

  "events": {
    "reportOpened": "A fault was reported in block {block}",
    "reportAssigned": "The report was passed to a technician",
    "reportResolved": "The work was finished and signed off",
    "reportOverdue": "This report passed the response time agreed for it",
    "liftFault": "A lift in block {block} reported a fault and was taken out of service",
    "residentMessage": "A resident in block {block} sent a message",
    "documentFiled": "A document was filed against an apartment in block {block}",
    "activityOpened": "A resident activity opened for booking",
    "paymentReceived": "A resident payment arrived and was matched to the right account",
    "paymentOverdue": "A charge on an apartment in block {block} passed its due date",
    "approvalRequested": "This job needs sign off before work starts",
    "invoiceApproved": "A contractor invoice was checked against the work and released for payment",
    "chargeRun": "The monthly service charge was posted to {count} apartment accounts in one run",
    "hotelCheckIn": "Guests arrived at the hotel",
    "hotelCheckOut": "Guests left, and the rooms went into the cleaning queue",
    "cleaningOpened": "A cleaning job was created for the rooms that were vacated",
    "unitHandover": "Keys were handed over and a new owner's file was opened"
  },

  "cadence": {
    "monthly": "Happens about once a month",
    "sixWeekly": "Happens about every six weeks in a building",
    "morning": "Happens every morning",
    "afternoon": "Happens every afternoon"
  },

  "figures": {
    "blocks": "Residence blocks",
    "units": "Apartments",
    "plot": "Plot area",
    "footprint": "Building footprint",
    "hotelRooms": "Hotel rooms",
    "completed": "Completed"
  },

  "sources": {
    "heading": "Where the drawing comes from",
    "plan": "Site plan published by the developer",
    "progress": "Site photograph, {date}",
    "aerial": "Aerial photograph of the finished complex",
    "credit": "Published by {publisher}"
  },

  "states": {
    "preparing": "Preparing the site plan",
    "failed": "The site plan could not be drawn. The figures below are unaffected.",
    "chooseBuilding": "Choose a building to see what the system holds for it.",
    "partial": "Some figures are not published. Those are marked."
  },

  "noValue": "Not stated",

  "a11y": {
    "plate": "Drawing of the site with sample activity",
    "feed": "List of sample events",
    "skipFeed": "Skip the sample activity list"
  }
}
```

**Rules this list already satisfies:**

- No em dash, no horizontal bar, no en dash in prose.
- No banned vocabulary: no `nicht belegt`, no `modelliert`, no `Cockpit`, no `Deals`, no `QA`, no `Demo-Daten`, no `virtualisiert`, no `synthetisch`, no `DataTable`, no `Zeilen` / `rows`, and no bare `ready` / `loading` / `empty` / `error` as a label — `states.preparing` and `states.failed` are sentences.
- The word **ticket** does not appear. `dashboard.tickets.modelledUnitNotice` is **not** reused verbatim: it opens "Dieses Ticket gehört zu…", which the plain-language rule forbids on a surface written for someone who has never heard the word. `siteModel.blocks.countNotice` says the same thing without it. (The old design also had both message key paths wrong: they are `dashboard.units.provenance.modelledMeaning` and `dashboard.tickets.modelledUnitNotice`, not `inventory.*` / `operations.*`.)
- The gap value is `noValue` = "Not stated" (de: "Keine Angabe"). Never a dash, never `0`, never blank.
- `aria-label` values come from `siteModel.a11y.*` — a string literal on `aria-label` is a `hardcoded-prop` finding.

**Rule 6 watch list.** These keys are ≥ 20 characters in German and at risk of exceeding 1.4× the English. If the German cannot be shortened, ship the declared `<key>_long` sibling in **all four** catalogues: `intro`, `schematicNotice`, `sample.body`, `sample.identifiers`, `blocks.countNotice`, `blocks.heightNotice`, `features.notice`, `feed.summary`, `events.liftFault`, `events.paymentReceived`, `states.failed`.

**Add to `apps/web/lib/proper-nouns.json`** so warning W1 does not fire on legitimate cross-locale repeats: `Azura World`, `Cebeci Group`, `Türkler`, `Alanya`, and the block letters. Do **not** add "Simulation" — the copy above avoids the word entirely in favour of "sample".

**Turkish:** block letters and any slug use `Intl.Collator("tr")`. `"I".toLowerCase()` is not `"ı"` in Turkish.

**Russian:** the plate labels are real DOM text, so the existing Manrope/Playfair Cyrillic subsets cover them. Nothing is painted into a canvas, which would bypass `unicode-range` entirely.

**Layout:** measured at 320 px in German and Russian. Block labels are two characters; the legend wraps to two columns below 400 px; the feed row is a two-line grid, not a single flex row.

---

## 8. File plan

### 8.1 Create — owned by this window

| path | what |
|---|---|
| `apps/web/lib/site-geometry.ts` | The §2 tables as frozen readonly data. Types `SiteBlock`, `SiteFeature`, `FieldConfidence`, the `shape` enum, `plotVertices`, and the top-level constants. Pure data plus three pure predicates: `containsPoint`, `rectCorners`, `rectsOverlap`. No React, no DOM, importable by a Node script. |
| `apps/web/lib/site-simulation.ts` | `SimState`, `SimReport`, `SimEvent`, the rate table, the milestone schedule, `simulationStateAt(tick, seedKey)`, `stepSimulation(prev, tick, seedKey)`. Uses `createRng`, `hashSeed`, `simulationTime` from `lib/simulation-clock.ts`. No `Math.random`, no `Date.now`, no React, no strings — it returns event **kinds and parameters**, never copy. |
| `apps/web/components/azura/site-model-section.tsx` | **Server Component.** The whole section: heading, intro, `SimulationBanner`, the isometric plate rendered at `simulationStateAt(0)`, the block list, the five `ProvenanceValue` figures, the evidence strip, the source list, all four data states. Opts into `LandingChoreography` with `data-rise` / `data-parallax`. Exports `SiteModelSection`. |
| `apps/web/components/azura/site-model-plate.tsx` | Shared markup for the plate, used by both the server render and the client hydration so the frames are byte-identical. Emits `--iso-*` custom properties per block and inline `clip-path` per feature. |
| `apps/web/components/azura/site-model-live.tsx` | **Client Component,** `"use client"`. Registers the `gsap.ticker` callback, holds the refs, runs the two-lane loop, dispatches the reducer. Early-returns on `prefers-reduced-motion` and `saveData` **before** touching any style. Wrapped in an error boundary by the parent. |
| `apps/web/components/azura/site-model-feed.tsx` | The feed list, the row disclosure, the legend, the accessible mirror (§9.11). |
| `scripts/check-site-geometry.mjs` | The geometry invariant gate. Imports `lib/site-geometry.ts` and asserts §9.1–9.4. Exits non-zero on any failure. |

Nothing here matches `/three|r3f|drei|maquette|coast/i`, so `scripts/landing-budget.mjs` and `scripts/quality-gate.mjs` charge these files to the same 250 KB landing budget rather than disagreeing.

### 8.2 Modify — owned by this window

| path | change |
|---|---|
| `apps/web/messages/de.json`, `en.json`, `tr.json`, `ru.json` | Append the `siteModel` namespace. Additive; no other window owns this key path. Identical key sets across all four. |
| `apps/web/lib/proper-nouns.json` | Add the proper nouns in §7. One list, two consumers — `proper-nouns.ts` reads the same file. |
| `MEDIA-LICENSE.md` | Resolve the posture contradiction between `media-manifest.ts` (`internal_only 789`) and `journey-media.ts` (claims promotion). Blocking precondition for §6. |
| `package.json` | Add `"qa:geometry": "node scripts/check-site-geometry.mjs"`. |

### 8.3 Regenerate — never hand-edit

| path | how |
|---|---|
| `apps/web/lib/media-manifest.ts` | Promote the §6.1 assets to `attributed_display`; fix the `category` field on the 43 "Image N" photographs. |
| `apps/web/lib/journey-media.ts` | `node scripts/publish-journey-media.mjs`, then `node scripts/journey-media-guard.mjs`. Add `"construction"` and `"residence-interior"` to `JourneyAct` in the generator, not in the output. |
| `apps/web/public/media` | Written by the same script at the 800 / 1200 / 1600 rungs. |

### 8.4 Requests for other windows

> **`app/sections/*` is being edited concurrently by another window. Do not reach across.** Everything this section needs from those files is one import and one JSX line.

Write these under `## Requests for other windows` in `HANDOFF/W-SITEMODEL.md`:

1. **Window owning `app/[locale]/page.tsx`** — mount the section. Replace `<OperatingMap locale={locale} />` at line 236 with `<SiteModelSection locale={locale} initialBlock={initialBlock} />`, importing from `@/components/azura/site-model-section`. `OperatingMap` can then be deleted; it hardcodes `"76.000" / "7" / "656" / "188"` as bare display strings bypassing `SourcedFact` entirely, carries its own four-locale `COPY` table with an admission in its own comments that it belongs in `messages/*`, and registers an un-coalesced, un-gated `scroll` listener that calls `getBoundingClientRect()` on every event for the life of the page.
2. **W1-D, `app/globals.css`** — give `--simulation` and `--surface-simulation` their own hue in the light, dark and night palettes, distinct from every `--confidence-*` and `--quality-*` value and at least 20 % apart in relative luminance from `--confidence-conflicted`. Currently byte-identical: light `#8a5200`, dark `#f0b45c`, night `#f2b862`. **Blocking for §5.3.**
3. **W1-D, `app/globals.css`** — no layout changes are needed. This section reuses `.azura-iso-*` unmodified. Recorded so nobody adds a class on its behalf.
4. **Window owning `app/sections/system.tsx`** — amend `landing.system.demoNote` in all four locales: remove "Hotelzimmer" from the list of things that correspond to their property, and replace "Buchungen" with "Zahlungen". See §5.5.
5. **W3-B / W3-F** — normalise the four `seedNotice` strings from "Demodaten." to "Beispieldaten.".
6. **W4-D, `scripts/quality-gate.mjs`** — register `node scripts/check-site-geometry.mjs` as a new blocking, fast gate, and add the "no two semantic tokens resolve to the same hex" assertion to the token check.
7. **W1-A** — `public.site_floors` is not populated by `supabase/seed.sql`. Not blocking: this section does not read floors.

---

## 9. Acceptance checks

Every check below is mechanical, has a pass/fail, and either runs in CI or is a scripted Playwright assertion. **A gate that cannot run is reported NOT RUN, never a pass.** Verify under `next start`, never `next dev` — the S-009 CSP bug passed typecheck, lint, build, `next dev` and a 27-check Playwright suite for a full night. Do not pipe a gate through `tail`: `cmd | tail` reports *tail's* status.

### Geometry — `pnpm qa:geometry`

1. **Plot containment.** Every block's rotated 4-corner footprint lies inside `plotVertices`, except block `I`, which must lie inside `block-I-parcel` (68 × 38 at −25°). *Currently: 17 of 17 pass.*
2. **No block intersects another block.** Separating-axis test on all 17 rotated footprints, pairwise. *Currently: 0 intersections.*
3. **No feature centre lies inside any block's rotated footprint, and no `structure` / `water` / `surface` feature intersects any block or any other such feature.** `zone` features are exempt and may contain their declared children. Any feature carrying `within: X` must be fully contained in X. *Currently: 0 violations.*
4. **Arithmetic reproduces.** `sum(block.footprintSqm)` including UNREAD-1..4 and the gatehouse, amphitheatre as an ellipse = **15 183 m²**, within 2 % of the published 15 000. Shoelace of `plotVertices` = **73 618 m²**; plus `block-I-parcel` = **76 202 m²**, within 0.5 % of the published 76 000. `plotMetres` is *derived* from the vertices, never restated — assert `{ w: 372, d: 432 }`.
5. **Schema completeness.** Every feature has a `rotationDeg` and a `featureClass`. Every block has five per-field confidences and a `footprintSqm`. No `curveDeg: 0` exists. No `shape: "serpentine"` exists. `plot-outline` and `perimeter-ring-road` carry `geometryFrom: "vertices"` and no `centre` / `size`.
6. **Rotation convention regression.** Assert that block A renders west of block E in the DOM order and in the computed `--iso-x`. Getting the sign backwards mirrors the crescent and swaps them, silently.

### Simulation

7. **Determinism.** `simulationStateAt(n, "azura")` deep-equals itself across 100 calls, and across a Node run and a browser run, for n ∈ {0, 1, 480, 2304}. Zero occurrences of `Math.random` or `Date.now` in `lib/site-simulation.ts` and the three new components — asserted by grep in the gate.
8. **Hydration.** Playwright: the server HTML's feed rows byte-equal the first client frame's feed rows. Zero React hydration warnings in the console on `/de`.
9. **Lifecycle coherence.** Over 5 000 simulated ticks: every `report_assigned`, `report_resolved` and `report_overdue` references a `n` that a prior `report_opened` created, with the same block letter. Zero orphans. Zero rows where the printed block differs from the record's own `blockCode`.
10. **Backlog does not drift.** Open sample reports over 5 000 ticks stay within `6 ± 6`. Assign count and resolve count differ by less than 5 %.
11. **Every milestone fires.** In a 480-tick loop, each of the five milestone kinds appears at least once, and each carries a `cadence` string.
12. **React is not thrashed.** Instrumented render count on `SiteModelLive` over 60 real seconds is **< 40** (target ≈ 24). Custom-property writes over the same window are **> 3 000**, proving the continuous lane bypasses React.

### Honesty

13. **No money.** Grep the rendered DOM of `/de`, `/en`, `/tr`, `/ru` for `€`, `EUR`, `TRY`, `$`, `£` inside the section — zero hits.
14. **No unit identifier.** Grep the rendered DOM for `/AZW-B\d{2}-\d{4}/` inside the section — zero hits, at any tick.
15. **Per-row disclosure survives a crop.** Playwright screenshots the feed, crops to a single row's bounding box, converts to greyscale: the crop still contains the `FlaskConical` glyph and the `sample.chip` text. Asserted by DOM position, not OCR — the glyph and the word must be the row's first two children.
16. **Banner is in normal flow.** `getComputedStyle(banner).position` is `static` or `relative`, never `fixed`/`absolute`; the banner's bottom edge is above the plate's top edge; the banner text is present in the server HTML.
17. **Token separation.** Once request §8.4.2 lands: `--simulation !== --confidence-conflicted` in all three palettes, with ≥ 20 % relative-luminance separation. Until then this check is **NOT RUN**, not a pass.
18. **No provenance vocabulary.** The section's DOM contains no `SourceChip`, `ConfidenceBadge`, `ConflictPopover`, no `--confidence-*` or `--quality-*` custom property, and no research figure from the do-not-surface list (60 harvest entries, 45 sources, 24 findings, 47 portal listings, 1 354 sourced facts, 111 unit observations).
19. **No per-block unit count.** The section's DOM contains no occurrence of `94`, `93` or any block-scoped integer adjacent to a block letter, except `blocks.openReports`, which is inside a `SimulationChip`-labelled region.

### Motion and accessibility

20. **Reduced motion is complete, not fast.** Playwright with `reducedMotion: "reduce"`: the feed has its full 8 rows, every block is in its final position, `gsap.ticker` has zero registered callbacks from this section, Lenis is not mounted, and **no element inside the section has computed `opacity: 0` or `visibility: hidden`.**
21. **No JavaScript.** Chromium with JS disabled: the section renders the plate, all 17 blocks, all figures, the banner and the feed. Assert on text content, not on a screenshot diff.
22. **Compositor only.** Chrome trace over a 20 s scroll through the section: zero `Layout` or `Paint` records attributable to the section's animated elements. No animated `width`, `height`, `top`, `box-shadow` or `filter`.
23. **One rAF loop.** `gsap.ticker` has exactly the Lenis callback plus this section's tick. Zero bare `requestAnimationFrame` loops originating from the section. Teardown on route change removes the tick and leaves `gsap.ticker.lagSmoothing` at its restored `(500, 33)`.
24. **`pnpm qa:layout`** passes at 320 px in German and Russian, both themes, every public route. Every interactive element ≥ 24 px; block buttons ≥ 44 px.
25. **`pnpm qa:a11y`** — one `<h1>` on `/de` (the section adds an `<h2>`), Lighthouse a11y ≥ 95, visible focus on every block button, contrast ≥ 4.5:1 in both themes, keyboard path through every block without a mouse, and a skip link past the feed.
26. **The feed is readable without sight.** The animated list stays `aria-hidden="true"`; a visually-hidden `<ul>` mirrors the current events, updated **without** `aria-live` so it does not announce on every beat, plus one `aria-live="polite"` region throttled to a **generated** summary every 30 s. The old static `feedSummary` is not the accessible rendering.

### Gates and budgets

27. **`pnpm --dir apps/web typecheck`, `lint --max-warnings 0`, `format`, `build`** — exit 0. `verbatimModuleSyntax`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on: `import type`, handle `T | undefined`, and never pass `x: undefined` to an optional prop.
28. **`node scripts/check-i18n.mjs`** — identical key sets across `de`/`en`/`tr`/`ru`, zero empty values, placeholder parity on `{block}`, `{code}`, `{count}`, `{n}`, `{date}`, `{publisher}`, no value equal to its key, no array anywhere in `siteModel`, and no German string ≥ 20 chars exceeding 1.4× its English without a declared `_long` sibling.
29. **`node scripts/check-plain-language.mjs`** — zero em dashes and zero horizontal bars in all four catalogues and in every new `.tsx`; zero `hardcoded-jsx-text`; zero `hardcoded-prop` (including `aria-label` on the plate); zero banned vocabulary.
30. **`pnpm qa:csp`** — `/de` raises zero `securitypolicyviolation`, transfers JavaScript, and hydrates, under `next start`. No route is prerendered. No `wasm`, no `blob:` fetch, no third-party asset origin, no static CSP header, no `middleware.ts`.
31. **`pnpm qa:perf`** — LCP ≤ 2.5 s throttled mobile, CLS ≤ 0.1 on **every** configuration including `desktop:warm`, INP ≤ 200 ms, landing JS ≤ 250 KB gz (this section's share ≤ 12 KB gz), 3D chunk ≤ 260 KB gz **unchanged at 227.4 KB** — this section adds nothing to it. 60 s soak on `/de`: heap growth < 50 MB, zero console errors, canvas count unchanged.
32. **`pnpm qa:evidence`** — every figure the section prints resolves to a `SourcedFact` with a source URL. Zero bare numeric literals in the section's JSX.