# Threat model — Azura World CATI

Written by W4-C, 2026-07-28, from the tree as reviewed. Companion to `SECURITY-REVIEW.md`: that
document lists what is broken, this one describes the shape of the system so the next finding has
somewhere to sit.

---

## 1. What this system is, in security terms

An **intelligence product about a third party**. That inverts two ordinary assumptions.

- The most valuable asset is not user data. It is the **analysis** — 60 fetched sources, 24
  findings, 656 unit records, a documented harvest methodology — and its subject is a named,
  identifiable company that would prefer not to read it.
- The worst failure is not a breach. It is a **number that is wrong and carries a citation**. A
  leaked dashboard costs one disclosure. A fabricated price with a source URL stapled to it gets
  quoted into a decision, and nothing downstream can tell it apart from a real one.

Everything below follows from those two.

---

## 2. Assets, by what their loss costs

| Asset | Where it lives | Loss looks like |
|---|---|---|
| The evidence dataset and its findings | `apps/web/lib/azura-world-data.ts`, `evidence-data.ts`, git | Competitor learns exactly what we know and how we know it |
| The **correctness** of a displayed figure | `SourcedFact<T>` + `ProvenanceValue` | A decision made on an invented or silently altered number |
| Third-party personal data in harvested content | reviewer text, staff names in quotes | A real person named in a public repository (SEC-004) |
| Cebeci Group's copyrighted media | `sources/media/`, git-ignored | Republication of `internal_only` assets |
| Tenant/owner/finance data | Supabase, once seeded | Ordinary confidentiality breach |
| Service-role key, DB URL, AI gateway key | environment only | Full data-plane compromise |

Note the ordering. In most products the last row is first. Here the second row is the one the
product exists to protect, and it is the row that ordinary security review does not look at.

---

## 3. Actors

| Actor | Can do | Assumed to |
|---|---|---|
| Anonymous visitor | Read `/[locale]`, `/[locale]/hotel`, `/[locale]/kitchen-sink`, POST to the public AI endpoints | Enumerate routes, replay requests, rotate headers, inject into any text field |
| Authenticated low role (`tenant`, `guest`, `owner`, …) | Everything above, plus every `/dashboard` route the proxy lets through | Read the RSC payload, disable JavaScript, call routes the nav does not show |
| Authenticated staff (`manager`, `accountant`) | Elevated reads | Be honest; be the wrong person occasionally |
| Administrator | Everything, including `guardianships` writes | Make mistakes — SEC-013 is only reachable this way |
| The subject of the analysis | Read anything public | Read the repository if it is public (SEC-001) |
| A harvested page | Supply arbitrary text into the dataset and into AI retrieval context | Be hostile: prompt injection, HTML, control characters, PII |

The last row is the one this product has and a normal CRM does not. **Scraped competitor content is
untrusted input** and every render path and retrieval path must treat it that way.

---

## 4. Trust boundaries

```
                    ┌──────────────────────────────────────────────┐
  anonymous  ──1──▶ │  proxy.ts    authentication + per-request CSP │
                    └───────────────────────┬──────────────────────┘
                                            │  2
                    ┌───────────────────────▼──────────────────────┐
                    │  Server Components / route handlers          │
                    │  getUserProfile() → role                     │
                    │  ** module must assert its own permission **  │
                    └───────────────────────┬──────────────────────┘
                                            │  3
                    ┌───────────────────────▼──────────────────────┐
                    │  repositories → Supabase (user JWT)          │
                    │  RLS is the real boundary                    │
                    └──────────────────────────────────────────────┘

  4: RSC flight payload ──▶ browser        5: AI gateway (outbound)
```

1. **`proxy.ts`** decides authenticated / not, for `/dashboard*` only. It does **not** decide role.
   Everything else is public by construction.
2. **The module** is where the role decision must happen, and it is the boundary that was missing —
   SEC-003. `dashboard/layout.tsx` asserts `dashboard:view` and nothing narrower; a module needing
   more must say so itself.
3. **RLS** is the only boundary that survives an application bug. `CONVENTIONS` §2 says so and it is
   right. Note that in local-seed mode this boundary **does not exist at all** — the repositories
   mirror the RLS predicates in TypeScript specifically to cover that, and those mirrors are the
   thing to check when a repository is edited.
4. **The flight payload is on the far side of a trust boundary.** Anything a Server Component
   renders is transmitted, whether or not a client component mounts it. A client-side guard moves
   pixels, not bytes.
5. **The gateway is outbound and untrusted in both directions.** §2.8 requires the RBAC decision
   before the call so a denied user never causes a request; the reply is discarded when ungrounded
   (`gatewayOutcome: "discarded_ungrounded"`).

---

## 5. The properties that must hold

Each is stated so it can be falsified. Where a probe check enforces it, the id is given.

**Provenance**
- P1 · A figure reaching a user carries at least one source URL. `SourcedFact<T>` + `assertFactInvariants()`.
- P2 · A `gap` renders as "—", never `0`, never blank. — SEC-H02
- P3 · A formatter never changes the value it is given. — SEC-H01
- P4 · A finding's narrative never claims more corroboration than its data carries. — SEC-H03
- P5 · No figure is derived across currencies without a rate **and** a rate date. — SEC-H04
- P6 · A modelled record is distinguishable from an observed one *in the list*, not only on the detail page.
- P7 · Seed data is labelled as seed wherever it is served. — SEC-H06

**Authorisation**
- P8 · No `/dashboard` route is served to an unauthenticated caller. — SEC-M01
- P9 · Every allowed (role, route) pair is backed by a permission the role holds. — SEC-M02
- P10 · A module whose permission is narrower than `dashboard:view` asserts it **server-side**. — SEC-D01, SEC-D02
- P11 · No profile-resolution branch produces a role above what the database stated. — SEC-A01
- P12 · No added role out-ranks its parent. — SEC-M04
- P13 · A user cannot change any authority-bearing column on their own row. — SEC-A02 (application side); pgTAP owns the SQL side.

**Secrets and boundaries**
- P14 · No secret value in any client chunk. — SEC-C01
- P15 · No server-only module in the client graph. — SEC-C02, SEC-C03
- P16 · The role picker cannot be enabled in production by any environment. — SEC-B01, SEC-B02
- P17 · Every tracked source file is legible to the secret scanner. — SEC-S01

**Input**
- P18 · Every API input is validated for type, length and shape, and errors are typed.
- P19 · Untrusted text renders as text. No `dangerouslySetInnerHTML` on harvested content.
- P20 · A prompt-injection attempt neither discloses the system prompt nor produces an unsourced figure.

---

## 6. Where the next hole will be

Ranked by where this review found the ones it found.

1. **The next dashboard module.** SEC-003 is a pattern, not an incident: the shell makes a
   client-side guard look like enforcement. Six more modules are waiting on W3-B's table contract
   and every one of them will inherit the same shape unless P10 is a habit.
2. **The units table.** 631 of 656 records are modelled. P6 has never been tested in a list —
   there is no list yet. A table that badges the detail page and not the row breaks the honesty
   control for the whole product.
3. **The first `[id]` route.** There is no object-reference surface today, so IDOR is untested by
   absence rather than by assurance (§9.5 of the review). The first one lands with no precedent to
   copy.
4. **The first real Supabase session.** SEC-002 means the entire authenticated path is currently
   unexercised. When it is fixed, everything downstream of it is being run for the first time.
5. **The guardian relation.** SEC-013 is admin-write-gated today. It stops being gated the moment a
   self-service guardian-invite flow exists.
6. **Anything that starts persisting anonymous data.** The AI feedback route is currently honest
   because it writes nothing. The pressure to give a thumbs-down somewhere to live is what turns
   that into an IP-keyed transcript store.
