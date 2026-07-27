# Security & confidentiality

**Classification: INTERNAL — CONFIDENTIAL.** This repository must remain **private**.

---

## Why this repository cannot be public

| # | Content | Risk if public |
|---|---|---|
| 1 | Competitor analysis naming **Cebeci Group A.Ş.** and **Azura World**, including stale-listing findings and verbatim negative review quotes | Published under the Wamocon org, this reads as Wamocon's public position on a named company. Reputational and potentially legal exposure. |
| 2 | References to a **separate client engagement** (Ataberk Estate / 1Çatı) — its repo structure, conventions and methodology, across ~31 files | Client-confidentiality breach independent of anything about Azura |
| 3 | **Supabase project ref** in `HANDOFF/W0-ENV.md` | Not a secret, but it names the exact target for an attacker probing the auth endpoint |
| 4 | Harvested competitor **imagery, renders and floor plans** (`sources/media/`, arriving with W0-D) | Third-party copyright. Ours to analyse internally, not to redistribute. |
| 5 | Wamocon's internal delivery methodology — orchestration, contracts, QA discipline | Commercial IP |

`sources/raw/` (112 MB of scraped competitor HTML and screenshots) is git-ignored and must stay
ignored. It is evidence, not source code, and it is not ours to publish.

## Secret handling

**Never committed:** `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`.
`.env.example` carries placeholders only.

Enable the guard once per clone:

```bash
git config core.hooksPath .githooks
```

### If a secret is committed

1. **Rotate it immediately** — assume it is compromised the moment it is pushed. Rotation is the
   fix; history rewriting is only cleanup.
   - Supabase: Dashboard → Settings → API → Rotate
   - Jira / Xray: revoke the token in the respective admin console
2. Purge from history (`git filter-repo`), force-push, and notify everyone with a clone.
3. Record it in the security review.

### Credentials in use

| Credential | Scope | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses all RLS** | Server-only. Enforced by `import "server-only"` so a leak breaks the build. |
| `SUPABASE_DB_URL` | Full database | Contains the database password |
| `AI_API_KEY` | Gateway | Server-only |
| `JIRA_API_TOKEN`, `XRAY_CLIENT_SECRET` | Jira/Xray write | Never run Jira sync without `--dry-run` unless explicitly approved |
| Five generated server secrets | HMAC / peppers | Generated locally, never derived from the service-role key |

## Application security

Binding rules are in [SYSTEM-PROMPT.md](SYSTEM-PROMPT.md) §2 and [CONVENTIONS.md](CONVENTIONS.md) §4.
Audited adversarially in `tasks/W4-C-security-review.md`, which includes an **honesty audit** —
seed data presented as live, fake write successes, or unconfigured integrations shown as healthy
are treated as **High** findings, because for an intelligence product they cause bad decisions.

## Scope of authorised testing

Security testing covers **this repository and a local instance only**.

Competitor websites are **out of scope**. We read their public pages at a polite rate, respecting
`robots.txt`, with ≥2s between requests per host. We do not probe, scan, brute-force, or access
anything behind authentication.

## Reporting

Internal issue in Jira project `INTERNAL`, or direct to the maintainer. Do not open a public
issue for a security matter.
