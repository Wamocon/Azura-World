# W-UX — End-user readiness: plain language, zero friction, full admin control

**Runs:** alone, before W5. **Blocks:** client demo.

> Read `SYSTEM-PROMPT.md`, `.claude/skills/azura-ui-ux/SKILL.md`, `HANDOFF/W3-B.md`,
> `HANDOFF/W3-C.md`, `HANDOFF/W1-B.md` (permission matrix), then this file.
>
> Load `azura-ui-ux`, then the gstack **`design-review`** skill — it finds AI-slop patterns and
> visual inconsistency specifically, which is half this task.

---

## Who actually uses this

A **non-technical property or sales manager**. They know Türkler, they know what a 2+1 costs,
they have never heard of a virtualised table and never will. Every word on screen must make sense
to them without explanation.

Right now it does not. The dashboard home currently shows this:

```
DataTable — 656 Zeilen
Nur Entwicklung. Synthetische Zeilen: 631 modelliert ohne Preisquelle, 25 mit Inserat.
[ready] [loading] [empty] [error]        656 synthetische Zeilen · virtualisiert ab 100
```

That is a developer harness. It ships as the first screen an end user sees.

---

## 1. Remove the demo harness from the product

`app/[locale]/dashboard/page.tsx` mounts `components/dashboard/table-demo.tsx` with hardcoded
German dev copy. W3-B built it to prove the four table states, which the brief asked for — but a
proof belongs in the kitchen-sink route, not on the dashboard home.

- Move the demo to `/[locale]/kitchen-sink`, which already gates behind
  `AZURA_ENABLE_KITCHEN_SINK=1` and `notFound()`s in production.
- The dashboard home shows the **role-aware KPI view** W3-B built, and nothing else.
- Delete the `ready / loading / empty / error` toggle from anything a user reaches. Those are
  state-machine names, not buttons.
- Grep for hardcoded German in `.tsx` — every user-visible string belongs in `messages/*`.
  `title="DataTable — 656 Zeilen"` is untranslatable as written.

## 2. The vocabulary — technical to business

Rewrite in all four locales. **German is authoritative**; en/tr/ru follow its meaning, not its
word order.

| Now | Should be (de) | Why |
|---|---|---|
| `DataTable — 656 Zeilen` | `Wohnungen` + `656 Einheiten` | Nobody outside engineering says "rows" |
| `Nur Entwicklung. Synthetische Zeilen…` | *(delete)* | Dev note |
| `virtualisiert ab 100` | *(delete)* | Implementation detail |
| `ready / loading / empty / error` | *(delete)* | State names |
| `modelliert` | `Preis nicht von der Quelle bestätigt` | Say what it means |
| `Nicht belegt` | `Keine Angabe` | "Belegt" reads as *occupied* to a property manager |
| `Beleg-Cockpit` | `Quellen und Nachweise` | "Cockpit" is internal jargon |
| `deals` | `Abschlüsse` | Untranslated English among German labels |
| `QA · Administrator` | `Administrator` | QA is our word |
| `AZW-B01-0001` as the primary label | `Block B01 · Wohnung 1`, ID small and secondary | The ID is for us; the location is for them |
| `Demo-Daten` | `Beispieldaten` | Keep the honesty, drop the jargon |

**`In Arbeit` appears on 15+ nav items.** That is not information, it is noise, and it makes the
product look unfinished on first impression. Either group unfinished modules under one quiet
heading, or drop the badge and let the empty state explain itself when opened.

## 3. No em dashes. Anywhere.

An em dash (`—`) in body copy is the single strongest tell of machine-written text, and this is
client-facing German. Remove every one from user-visible strings.

**This includes the null placeholder.** `azura-ui-ux` §6 currently says a `gap` fact renders `—`.
That was my instruction and it is wrong twice over: it is an em dash, and it tells the user
nothing.

```
before:   Preis  —
after:    Preis  Keine Angabe
```

Rewrite that rule in the skill file as part of this task. Use `Keine Angabe` (de),
`Not stated` (en), `Belirtilmemiş` (tr), `Нет данных` (ru).

Rules for the rewrite:
- No em dashes. Use a full stop and a new sentence, or a comma, or brackets.
- No `·` as a sentence connector in prose. It is fine as a separator in dense metadata rows.
- Short sentences. One idea each.
- No hedging stacked on hedging. "Möglicherweise könnte eventuell" is three hedges for one fact.
- Never open a heading with a gerund chain or a colon-heavy construction.
- Read every string aloud. If it does not sound like a person explaining something to a colleague,
  rewrite it.

## 4. Friction

Walk every task an end user actually performs and count the clicks and the moments of doubt.

- **Empty states must say what to do next**, not just that something is empty. `Es liegen noch
  keine Belege vor.` tells the user nothing actionable.
- **Errors must say what happened and what to do.** No codes, no `503`, no `SQLSTATE`.
- Every destructive action confirms, and names what is affected. Every long action shows progress.
- The search placeholder currently reads `Suchen … (Strg + K)` **and** shows a `Strg + K` chip.
  Say it once.
- Nothing on screen should require the user to already know what it is.

## 5. Admin must genuinely be able to run the system

The brief is: an administrator can do anything, without a developer.

Audit `lib/rbac.ts` against reality and close every gap. An admin must be able to:

- **Users:** invite, create, edit, deactivate, reactivate, delete, and **change anyone's role**,
  including creating another admin
- **Data:** correct any record they own the business meaning of
- **Content:** anything a business owner would expect to edit without a deployment
- **Oversight:** see the audit trail, see who did what, export it

Two guards stay, and they are not friction, they are what stops the system becoming
unrecoverable:

1. An admin **cannot demote or delete the last remaining admin**. Explain why in plain language
   when it is refused.
2. An admin **cannot silently elevate themselves**. Self-elevation is logged and visible in the
   audit trail. It is not blocked, it is recorded.

Every one of these actions is server-side enforced and audited. If the UI offers it, the API must
allow it for admin, and the RLS policy must too. **A button that returns 403 is worse than no
button.**

## 6. What must NOT get lost

Friendlier must not mean vaguer. The honesty controls are the product, and plain language makes
them *stronger*, not weaker:

- A modelled unit is still unmistakably not a real listing. `Preis nicht von der Quelle bestätigt`
  is clearer than `modelliert`, not softer.
- Conflicting sources still show every competing value with its publisher.
- A gap still reads as a gap. `Keine Angabe` is honest. Blank, or `0`, is not.
- `Beispieldaten` still tells the user this is not live data.

If a rewrite makes a limitation harder to notice, it is wrong. Say the true thing in words the
user knows.

---

## Definition of done

```bash
pnpm --dir apps/web typecheck && pnpm --dir apps/web lint && pnpm --dir apps/web build
node scripts/check-i18n.mjs
pnpm qa:csp
```

Plus, evidence pasted:

1. **Zero em dashes in any user-visible string** across all four locales. Show the grep.
2. **Zero hardcoded user-visible strings** in `.tsx`. Show the grep.
3. Dashboard home screenshot, `admin` and `manager`, German, with no developer copy on it
4. The demo harness reachable only at `/de/kitchen-sink` and 404 in a production build
5. Admin capability matrix: every action in §5 tried in the running app, each with its result
6. Last-admin protection refuses in plain language. Screenshot.
7. Self-elevation succeeds and appears in the audit trail. Screenshot both.
8. Ten user-visible strings before and after, side by side
9. `design-review` run over the dashboard and landing, with its findings and your fixes

## Handoff must state

- The full vocabulary mapping as shipped
- Any admin capability you could not close, and exactly what blocks it
- Anything you softened, and your evidence that the limitation is still obvious to a user
- The updated `azura-ui-ux` §6 rule replacing the em-dash placeholder
