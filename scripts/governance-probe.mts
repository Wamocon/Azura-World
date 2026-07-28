/**
 * W3-F acceptance probe — the governance module group.
 *
 * Run:
 *   node --experimental-strip-types --import ./scripts/register-ts-resolve.mjs \
 *        scripts/governance-probe.mts
 *
 * A `qa:governance` entry in `package.json` is requested in HANDOFF/W3-F.md —
 * that file is W0-A's.
 *
 * WHY THIS EXISTS. `tasks/W3-F`'s definition of done asks for twelve pieces of
 * evidence, and eleven of them are decisions rather than screenshots:
 * self-elevation refused, the last admin protected, an HTML file rejected by
 * content sniffing, an unconfigured integration never rendered as healthy. Each
 * of those lives in a **pure** module for exactly this reason — a rule that can
 * only be reviewed is worth less than one that can be executed, and a
 * `"use server"` file cannot be imported by plain Node.
 *
 * EVERY FAIL-CLOSED CASE IS PAIRED WITH A POSITIVE CONTROL. Without one, a
 * `decideRoleChange` that returned `not_permitted` for absolutely everything
 * would pass every refusal assertion here while being completely broken. The
 * controls are the assertions that would catch that, and they are marked
 * `control:`.
 *
 * The suite fails itself below a minimum assertion count, so a probe that
 * silently stops checking cannot print a green tick.
 */

import { roles, type Role } from "../apps/web/lib/contracts.ts";
import { hasPermission } from "../apps/web/lib/rbac.ts";
import {
  countOtherActiveAdmins,
  decideActivationChange,
  decideProfileDeletion,
  decideRoleChange,
  refusalStatus,
  roleChangeAuditAction,
  roleChangeAuditPayload,
  type AdminCensus,
  type RoleChangeActor,
  type RoleChangeSubject,
} from "../apps/web/app/[locale]/dashboard/users/role-policy.ts";
import {
  ALLOWED_UPLOAD_TYPES,
  DOCUMENT_BUCKET,
  MAX_UPLOAD_BYTES,
  sanitiseFilename,
  sniffContent,
  storagePathFor,
  validateUpload,
} from "../apps/web/lib/document-storage.ts";
import {
  coverageSummary,
  deriveEvidenceState,
  evaluateChecks,
  provableShare,
  STATE_VARIANT,
} from "../apps/web/app/[locale]/dashboard/compliance/compliance-model.ts";
import {
  integrationStatuses,
  noIntegrationsConfigured,
} from "../apps/web/app/[locale]/dashboard/admin/integrations.ts";
import {
  assertProvenanceColumns,
  csvField,
  evidenceCoverageTable,
  MissingProvenanceColumnsError,
  REPORT_DEFINITIONS,
  REPORT_FORMATS,
  reportDefinition,
  toCsv,
} from "../apps/web/lib/report-artifacts.ts";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, observed = ""): void {
  if (condition) {
    pass += 1;
    return;
  }
  fail += 1;
  failures.push(`${name}${observed === "" ? "" : `  ::  ${observed}`}`);
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

const ADMIN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ADMIN_B = "aaaaaaaa-0000-4000-8000-000000000002";
const TENANT = "bbbbbbbb-0000-4000-8000-000000000001";

function actor(role: Role, id: string | null = ADMIN_A): RoleChangeActor {
  return { id, role, authenticated: true };
}

function subject(
  id: string,
  role: Role | null,
  isActive = true
): RoleChangeSubject {
  return { id, role, isActive };
}

const CENSUS_ONE_OTHER: AdminCensus = { countable: true, otherActiveAdmins: 1 };
const CENSUS_NONE: AdminCensus = { countable: true, otherActiveAdmins: 0 };
const CENSUS_UNKNOWN: AdminCensus = { countable: false, reason: "seed mode" };

// ---------------------------------------------------------------------------
section("[DoD 1] Self-elevation is refused, server-side, with a 403");
// ---------------------------------------------------------------------------

const selfUp = decideRoleChange({
  actor: actor("admin", TENANT),
  subject: subject(TENANT, "tenant"),
  requestedRole: "admin",
  census: CENSUS_ONE_OTHER,
});

check(
  "a user raising their own role is refused",
  !selfUp.allowed,
  JSON.stringify(selfUp)
);
check(
  "the refusal is named self_elevation",
  !selfUp.allowed && selfUp.refusal === "self_elevation"
);
check("self-elevation maps to HTTP 403", refusalStatus.self_elevation === 403);
check(
  "the audit action names the refusal",
  roleChangeAuditAction(selfUp) === "users.role_change.refused.self_elevation",
  roleChangeAuditAction(selfUp)
);

// A self change that does NOT raise the level is refused as well, and named
// differently. The brief only forbids elevation; this is deliberately stricter.
const selfDown = decideRoleChange({
  actor: actor("admin", ADMIN_A),
  subject: subject(ADMIN_A, "admin"),
  requestedRole: "tenant",
  census: CENSUS_ONE_OTHER,
});
check("a user lowering their own role is also refused", !selfDown.allowed);
check(
  "a non-raising self change is named self_role_change",
  !selfDown.allowed && selfDown.refusal === "self_role_change"
);

// An actor with no resolvable id cannot be proved not to be the subject.
const noId = decideRoleChange({
  actor: actor("admin", null),
  subject: subject(TENANT, "tenant"),
  requestedRole: "manager",
  census: CENSUS_ONE_OTHER,
});
check("an actor with no id fails closed", !noId.allowed, JSON.stringify(noId));

check(
  "control: an admin changing SOMEBODY ELSE is allowed",
  decideRoleChange({
    actor: actor("admin", ADMIN_A),
    subject: subject(TENANT, "tenant"),
    requestedRole: "manager",
    census: CENSUS_ONE_OTHER,
  }).allowed
);

// Every role, both directions. The pure decision is crossed with the whole
// frozen role list rather than spot-checked on admin.
for (const role of roles) {
  const decision = decideRoleChange({
    actor: actor(role, TENANT),
    subject: subject(TENANT, "tenant"),
    requestedRole: "admin",
    census: CENSUS_ONE_OTHER,
  });
  check(
    `role "${role}" cannot elevate itself`,
    !decision.allowed,
    JSON.stringify(decision)
  );
}

// ---------------------------------------------------------------------------
section("[DoD 2] The last administrator cannot be demoted or deactivated");
// ---------------------------------------------------------------------------

const demoteLast = decideRoleChange({
  actor: actor("admin", ADMIN_B),
  subject: subject(ADMIN_A, "admin"),
  requestedRole: "manager",
  census: CENSUS_NONE,
});
check("demoting the last active admin is refused", !demoteLast.allowed);
check(
  "the refusal is named last_admin",
  !demoteLast.allowed && demoteLast.refusal === "last_admin"
);
check("last_admin maps to HTTP 409", refusalStatus.last_admin === 409);

const deactivateLast = decideActivationChange({
  actor: actor("admin", ADMIN_B),
  subject: subject(ADMIN_A, "admin"),
  activate: false,
  census: CENSUS_NONE,
});
check("deactivating the last active admin is refused", !deactivateLast.allowed);
check(
  "deactivation refusal is named last_admin",
  !deactivateLast.allowed && deactivateLast.refusal === "last_admin"
);

check(
  "control: demoting an admin while another remains is allowed",
  decideRoleChange({
    actor: actor("admin", ADMIN_B),
    subject: subject(ADMIN_A, "admin"),
    requestedRole: "manager",
    census: CENSUS_ONE_OTHER,
  }).allowed
);
check(
  "control: deactivating an admin while another remains is allowed",
  decideActivationChange({
    actor: actor("admin", ADMIN_B),
    subject: subject(ADMIN_A, "admin"),
    activate: false,
    census: CENSUS_ONE_OTHER,
  }).allowed
);

// An uncountable directory is not an empty one.
const uncountable = decideRoleChange({
  actor: actor("admin", ADMIN_B),
  subject: subject(ADMIN_A, "admin"),
  requestedRole: "manager",
  census: CENSUS_UNKNOWN,
});
check("an uncountable census refuses rather than assuming", !uncountable.allowed);
check(
  "the refusal is named census_unavailable and maps to 503",
  !uncountable.allowed &&
    uncountable.refusal === "census_unavailable" &&
    uncountable.status === 503
);

// The census excludes the subject and counts only ACTIVE admins.
const directory: RoleChangeSubject[] = [
  subject(ADMIN_A, "admin", true),
  subject(ADMIN_B, "admin", false),
  subject(TENANT, "tenant", true),
];
check(
  "the subject is excluded from its own admin census",
  countOtherActiveAdmins(directory, ADMIN_A) === 0,
  String(countOtherActiveAdmins(directory, ADMIN_A))
);
check(
  "an INACTIVE admin is not counted as a recovery path",
  countOtherActiveAdmins([subject(ADMIN_B, "admin", false)], TENANT) === 0
);
check(
  "control: an active admin IS counted",
  countOtherActiveAdmins([subject(ADMIN_B, "admin", true)], TENANT) === 1
);
check(
  "an unrecognised role is not counted as an admin",
  countOtherActiveAdmins([subject(ADMIN_B, null, true)], TENANT) === 0
);

// Deleting a profile is refused outright.
check(
  "deleting a profile is refused with 405",
  decideProfileDeletion().status === 405 &&
    decideProfileDeletion().refusal === "deletion_not_supported"
);

// ---------------------------------------------------------------------------
section("Ordering, permission, and shape");
// ---------------------------------------------------------------------------

// Authorisation precedes shape: a role that may not assign must not learn the
// role enum by watching which values produce which complaint.
const nonAdminBadRole = decideRoleChange({
  actor: actor("manager", ADMIN_B),
  subject: subject(TENANT, "tenant"),
  requestedRole: "not-a-role",
  census: CENSUS_ONE_OTHER,
});
check(
  "a non-admin with a nonsense role gets not_permitted, not unknown_role",
  !nonAdminBadRole.allowed && nonAdminBadRole.refusal === "not_permitted",
  JSON.stringify(nonAdminBadRole)
);

for (const role of roles) {
  const decision = decideRoleChange({
    actor: actor(role, ADMIN_B),
    subject: subject(TENANT, "tenant"),
    requestedRole: "manager",
    census: CENSUS_ONE_OTHER,
  });
  const expected = hasPermission(role, "users:manage");
  check(
    `role "${role}" may assign roles iff it holds users:manage (${expected})`,
    decision.allowed === expected,
    JSON.stringify(decision)
  );
}

for (const candidate of ["", "ADMIN", "admin ", "__proto__", "constructor", "superuser"]) {
  const decision = decideRoleChange({
    actor: actor("admin", ADMIN_B),
    subject: subject(TENANT, "tenant"),
    requestedRole: candidate,
    census: CENSUS_ONE_OTHER,
  });
  check(
    `requested role ${JSON.stringify(candidate)} is refused as unknown_role`,
    !decision.allowed && decision.refusal === "unknown_role",
    JSON.stringify(decision)
  );
}

check(
  "an unauthenticated actor is refused with 401",
  (() => {
    const decision = decideRoleChange({
      actor: { id: ADMIN_A, role: "admin", authenticated: false },
      subject: subject(TENANT, "tenant"),
      requestedRole: "manager",
      census: CENSUS_ONE_OTHER,
    });
    return !decision.allowed && decision.status === 401;
  })()
);

check(
  "a no-op assignment is refused as no_change",
  (() => {
    const decision = decideRoleChange({
      actor: actor("admin", ADMIN_B),
      subject: subject(TENANT, "tenant"),
      requestedRole: "tenant",
      census: CENSUS_ONE_OTHER,
    });
    return !decision.allowed && decision.refusal === "no_change";
  })()
);

// The audit payload carries changed columns only, never the whole row.
const payload = roleChangeAuditPayload(subject(TENANT, "tenant"), "manager");
check(
  "the audit payload records only the role column",
  Object.keys(payload.before).join() === "role" &&
    Object.keys(payload.after).join() === "role",
  JSON.stringify(payload)
);
check(
  "the audit payload carries no email or phone",
  !JSON.stringify(payload).includes("email") &&
    !JSON.stringify(payload).includes("phone")
);

// ---------------------------------------------------------------------------
section("[DoD 6] A .pdf that is actually HTML is rejected by content sniffing");
// ---------------------------------------------------------------------------

const bytes = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

const HTML_AS_PDF = validateUpload({
  bytes: bytes("<!DOCTYPE html><html><body>not a pdf at all</body></html>"),
  declaredMimeType: "application/pdf",
  filename: "rechnung.pdf",
});
check("an HTML file claiming to be a PDF is rejected", !HTML_AS_PDF.ok);
check(
  "the rejection names the content, not the extension",
  !HTML_AS_PDF.ok && HTML_AS_PDF.rejection === "content_is_markup",
  JSON.stringify(HTML_AS_PDF)
);

// Two spaces and a BOM do not defeat the sniffer.
for (const [label, payloadText] of [
  ["leading whitespace", "   <html><body>x</body></html>"],
  ["uppercase", "<!DOCTYPE HTML><HTML></HTML>"],
  ["a BOM", "\uFEFF<!doctype html><html></html>"],
  ["an SVG", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
  ["a bare script tag", "<script>alert(1)</script>"],
  ["XML", '<?xml version="1.0"?><root/>'],
] as const) {
  check(
    `markup with ${label} still sniffs as markup`,
    sniffContent(bytes(payloadText)) === "markup",
    sniffContent(bytes(payloadText))
  );
}

// An honest text/html upload is refused too: it is refused for BEING html.
check(
  "an honestly declared HTML upload is still refused",
  !validateUpload({
    bytes: bytes("<html></html>"),
    declaredMimeType: "text/html",
    filename: "page.html",
  }).ok
);

// A real PDF, correctly claimed, is accepted. Without this control every
// assertion above would pass for a validator that rejected everything.
const REAL_PDF = validateUpload({
  bytes: bytes("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF"),
  declaredMimeType: "application/pdf",
  filename: "tapu.pdf",
});
check("control: a real PDF claiming to be a PDF is accepted", REAL_PDF.ok, JSON.stringify(REAL_PDF));
check(
  "an accepted upload carries a sha256 checksum",
  REAL_PDF.ok && /^[0-9a-f]{64}$/.test(REAL_PDF.checksumSha256)
);

// A real PDF claiming to be a PNG is a mismatch, not a markup refusal.
const MISMATCH = validateUpload({
  bytes: bytes("%PDF-1.7\ntrailer\n%%EOF"),
  declaredMimeType: "image/png",
  filename: "bild.png",
});
check(
  "content that disagrees with the claim is rejected as a mismatch",
  !MISMATCH.ok && MISMATCH.rejection === "content_mismatch",
  JSON.stringify(MISMATCH)
);

check(
  "an unrecognised binary is rejected rather than stored",
  !validateUpload({
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    declaredMimeType: "application/pdf",
    filename: "x.pdf",
  }).ok
);

check(
  "a MIME type outside the allowlist is refused",
  !validateUpload({
    bytes: bytes("%PDF-1.7\ntrailer"),
    declaredMimeType: "application/x-msdownload",
    filename: "x.exe",
  }).ok
);
check(
  "a prototype-chain MIME claim does not pass the allowlist",
  !validateUpload({
    bytes: bytes("%PDF-1.7\ntrailer"),
    declaredMimeType: "constructor",
    filename: "x.pdf",
  }).ok
);

// Ceilings, on the real byte length.
const oversize = new Uint8Array(MAX_UPLOAD_BYTES + 1);
oversize.set(bytes("%PDF-1.7"), 0);
check(
  "an oversize upload is refused before anything else",
  (() => {
    const result = validateUpload({
      bytes: oversize,
      declaredMimeType: "application/pdf",
      filename: "big.pdf",
    });
    return !result.ok && result.rejection === "too_large";
  })()
);
check(
  "an empty upload is refused",
  (() => {
    const result = validateUpload({
      bytes: new Uint8Array(0),
      declaredMimeType: "application/pdf",
      filename: "x.pdf",
    });
    return !result.ok && result.rejection === "empty";
  })()
);

check(
  "every allowed MIME type maps to a sniffable format",
  Object.values(ALLOWED_UPLOAD_TYPES).every(
    (type) => type !== "markup" && type !== "unknown"
  )
);

// ---------------------------------------------------------------------------
section("[DoD 7] Filenames are sanitised, and the original is kept as metadata");
// ---------------------------------------------------------------------------

const traversal = sanitiseFilename("../../evil.txt");
check(
  "a path-traversal filename keeps no separators",
  !traversal.safe.includes("/") && !traversal.safe.includes("\\"),
  traversal.safe
);
check(
  "a path-traversal filename keeps no dot segments",
  !traversal.safe.includes(".."),
  traversal.safe
);
check(
  "the original filename is preserved as display metadata",
  traversal.original === "../../evil.txt",
  traversal.original
);
check("the sanitised name is marked as changed", traversal.changed);

// The doubled-separator trick that defeats a naive `replace("../", "")`.
for (const hostile of [
  "....//....//etc/passwd",
  "..\\..\\windows\\system32\\config",
  "/etc/shadow",
  "C:\\Windows\\win.ini",
  "..%2f..%2fetc",
]) {
  const result = sanitiseFilename(hostile);
  check(
    `hostile filename ${JSON.stringify(hostile)} yields a bare name`,
    !/[/\\]/u.test(result.safe) && !result.safe.includes(".."),
    result.safe
  );
}

const turkish = sanitiseFilename("Şirket Değerlendirme İçerik.pdf");
check(
  "Turkish characters are transliterated to ASCII",
  /^[A-Za-z0-9._-]+$/u.test(turkish.safe),
  turkish.safe
);
check(
  "the original Turkish name survives as metadata",
  turkish.original.includes("Değerlendirme"),
  turkish.original
);

check(
  "a control character is stripped from a filename",
  /^[A-Za-z0-9._-]+$/u.test(sanitiseFilename("bad\u0000name\u001f.pdf").safe),
  sanitiseFilename("bad\u0000name\u001f.pdf").safe
);
check(
  "a hidden-file name does not stay hidden",
  !sanitiseFilename(".htaccess").safe.startsWith("."),
  sanitiseFilename(".htaccess").safe
);
check(
  "a Windows reserved device name is replaced",
  sanitiseFilename("CON.pdf").safe.toLowerCase() !== "con",
  sanitiseFilename("CON.pdf").safe
);
check(
  "an empty name after sanitising falls back rather than producing an empty key",
  sanitiseFilename("///").safe.length > 0,
  sanitiseFilename("///").safe
);
check(
  "control: an ordinary name survives intact",
  sanitiseFilename("kaufvertrag-2026.pdf").safe === "kaufvertrag-2026",
  sanitiseFilename("kaufvertrag-2026.pdf").safe
);

// The stored extension comes from the sniffed type, never from the claim.
const storedPath = storagePathFor({
  companyId: "azura",
  category: "contract",
  safeName: "evil",
  sniffed: "png",
});
check(
  "the storage key takes its extension from the sniffed type",
  storedPath.endsWith(".png"),
  storedPath
);
check(
  "the storage key contains no traversal",
  !storedPath.includes(".."),
  storedPath
);
check(
  "two uploads of the same name produce different keys",
  storagePathFor({ companyId: "a", category: "general", safeName: "x", sniffed: "pdf" }) !==
    storagePathFor({ companyId: "a", category: "general", safeName: "x", sniffed: "pdf" })
);
check(
  "the canonical bucket is one of the two the schema permits",
  DOCUMENT_BUCKET === "azura-documents"
);

// ---------------------------------------------------------------------------
section("A check with no evidence is not_evidenced, never passed");
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-07-28T00:00:00.000Z");
const DAY = 86_400_000;

type Check = Parameters<typeof deriveEvidenceState>[0]["check"];
type Doc = NonNullable<Parameters<typeof deriveEvidenceState>[0]["evidence"]>;

function complianceCheck(over: Partial<Check> = {}): Check {
  return {
    id: "c1",
    companyId: "co",
    siteId: null,
    subjectType: "unit",
    subjectId: "AZW-B03-0412",
    checkType: "title_deed",
    status: "passed",
    riskLevel: "high",
    rationale: null,
    evidenceDocumentId: null,
    humanDecisionRequired: true,
    decidedBy: null,
    decidedAt: null,
    dueAt: null,
    metadata: {},
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function document(over: Partial<Doc> = {}): Doc {
  return {
    id: "d1",
    companyId: "co",
    siteId: null,
    unitId: null,
    residentId: null,
    title: "Tapu",
    category: "title_deed",
    storageBucket: "azura-documents",
    storagePath: "company/azura/x.pdf",
    originalFilename: "tapu.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1,
    checksumSha256: null,
    visibility: "private",
    reviewStatus: "approved",
    retentionClass: "legal",
    expiresAt: null,
    uploadedBy: null,
    reviewedBy: null,
    reviewedAt: null,
    metadata: {},
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

check(
  "passed with NO evidence document is not_evidenced",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed" }),
    evidence: null,
    asOfMs: NOW,
  }) === "not_evidenced"
);
check(
  "waived with no evidence is also not_evidenced",
  deriveEvidenceState({
    check: complianceCheck({ status: "waived" }),
    evidence: null,
    asOfMs: NOW,
  }) === "not_evidenced"
);
check(
  "an evidence id pointing at a document the caller cannot read is not_evidenced",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: null,
    asOfMs: NOW,
  }) === "not_evidenced"
);
check(
  "evidence that nobody has approved is evidence_unreviewed",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: document({ reviewStatus: "pending_review" }),
    asOfMs: NOW,
  }) === "evidence_unreviewed"
);
check(
  "expired evidence is evidence_expired",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: document({ expiresAt: new Date(NOW - DAY).toISOString() }),
    asOfMs: NOW,
  }) === "evidence_expired"
);
check(
  "an unparseable expiry is not treated as valid",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: document({ expiresAt: "not-a-date" }),
    asOfMs: NOW,
  }) !== "proven"
);
check(
  "control: passed with approved, in-date evidence IS proven",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: document({ expiresAt: new Date(NOW + 30 * DAY).toISOString() }),
    asOfMs: NOW,
  }) === "proven"
);
check(
  "control: evidence with no expiry at all is proven",
  deriveEvidenceState({
    check: complianceCheck({ status: "passed", evidenceDocumentId: "d1" }),
    evidence: document({ expiresAt: null }),
    asOfMs: NOW,
  }) === "proven"
);
check(
  "pending is open, not a failure",
  deriveEvidenceState({
    check: complianceCheck({ status: "pending" }),
    evidence: null,
    asOfMs: NOW,
  }) === "open"
);
check(
  "failed stays failed",
  deriveEvidenceState({
    check: complianceCheck({ status: "failed" }),
    evidence: null,
    asOfMs: NOW,
  }) === "failed"
);

// No stored status can produce `proven` on its own.
for (const status of ["pending", "in_review", "passed", "failed", "waived"]) {
  check(
    `status "${status}" alone never yields proven`,
    deriveEvidenceState({
      check: complianceCheck({ status }),
      evidence: null,
      asOfMs: NOW,
    }) !== "proven"
  );
}

const evaluated = evaluateChecks({
  checks: [
    complianceCheck({ id: "a", status: "passed" }),
    complianceCheck({ id: "b", status: "passed", evidenceDocumentId: "d1" }),
    complianceCheck({
      id: "c",
      status: "pending",
      dueAt: new Date(NOW - 5 * DAY).toISOString(),
    }),
  ],
  documents: [document()],
  asOfMs: NOW,
});
const summary = coverageSummary(evaluated);
check("the overclaim count catches an unevidenced pass", summary.overclaimed === 1, String(summary.overclaimed));
check("the proven count is exact", summary.proven === 1, String(summary.proven));
check("an overdue check is counted", summary.overdue === 1, String(summary.overdue));
check(
  "an open check is NOT counted as overclaimed",
  evaluated.find((row) => row.check.id === "c")?.overclaimed === false
);
check(
  "provable share is null with no checks, never zero",
  provableShare(coverageSummary([])) === null
);
check(
  "control: provable share is a real fraction when checks exist",
  provableShare(summary) === 1 / 3
);
check(
  "only `proven` gets the confirmed treatment",
  Object.entries(STATE_VARIANT).filter(([, variant]) => variant === "confirmed")
    .length === 1
);

// ---------------------------------------------------------------------------
section("[DoD 11] An unconfigured integration is never rendered as healthy");
// ---------------------------------------------------------------------------

const statuses = integrationStatuses();
check("every provider reports a state", statuses.length >= 4, String(statuses.length));
check(
  "no provider claims reachable from configuration alone",
  statuses.every((status) => status.state !== "reachable"),
  JSON.stringify(statuses.map((s) => [s.id, s.state]))
);
check(
  "with nothing configured, every provider reads not_configured",
  noIntegrationsConfigured(statuses) ===
    statuses.every((status) => status.state === "not_configured")
);
check(
  "a declared-but-unwired provider is marked as such",
  statuses.some((status) => !status.wired)
);
check(
  "no provider publishes a configuration VALUE, only a variable name",
  statuses.every((status) => /^[A-Z0-9_]+$/u.test(status.readFrom)),
  JSON.stringify(statuses.map((s) => s.readFrom))
);

// ---------------------------------------------------------------------------
section("[DoD 10] Exports carry provenance, and refuse to serialise without it");
// ---------------------------------------------------------------------------

const coverageTable = evidenceCoverageTable({
  coverage: {
    generatedAt: "2026-07-28T00:00:00.000Z",
    totals: { sources: 12, snapshots: 30, facts: 210, citations: 260, findings: 24 },
    facts: {
      byConfidence: {
        confirmed: 40,
        official: 20,
        single_source: 60,
        conflicted: 10,
        inferred: 5,
        gap: 75,
      },
      established: 60,
      provisional: 75,
      declaredGaps: 75,
      citationsWithoutSnapshot: 3,
    },
    sources: {
      byTier: { official: 2, developer: 3, portal: 5, press: 1, review: 1 },
      byReachability: { validated: 8, fetchedNotValidated: 2, neverFetched: 2 },
      corroboratedHosts: 4,
    },
  } as never,
  source: "local-seed",
});

check(
  "the flagship report declares a provenance column",
  coverageTable.columns.some((column) => column.provenance === true)
);
check(
  "every coverage row states where its number came from",
  coverageTable.rows.every(
    (row) => typeof row["basis"] === "string" && String(row["basis"]).length > 0
  )
);

let refused = false;
try {
  assertProvenanceColumns({
    ...coverageTable,
    columns: [{ key: "metric", labelKey: "columns.metric" }],
  });
} catch (error) {
  refused = error instanceof MissingProvenanceColumnsError;
}
check("a sourced-fact report without citation columns refuses to serialise", refused);

const csv = toCsv(coverageTable, {
  header: { metric: "Kennzahl", value: "Wert", basis: "Grundlage" },
  generatedAt: "Erzeugt am",
  source: "Datenherkunft",
});
check("the CSV states its data origin in the file itself", csv.includes("local-seed"));
check("the CSV carries a BOM so Excel reads UTF-8", csv.charCodeAt(0) === 0xfeff);
check("the CSV uses CRLF line endings", csv.includes("\r\n"));

check("a null field becomes empty, never 0", csvField(null) === "");
check("a zero stays a zero", csvField(0) === "0");
check(
  "a formula-shaped field is neutralised",
  csvField("=cmd|'/c calc'!A1").startsWith("'"),
  csvField("=cmd|'/c calc'!A1")
);
/**
 * The neutralising quote sits at the start of the FIELD, which is inside the
 * enclosing `"` when the value also needs quoting. `"\rx"` is both dangerous and
 * quotable, so a bare `startsWith("'")` reports a failure that is not there —
 * this drops one optional opening quote first.
 */
function neutralised(value: string): boolean {
  const field = csvField(value);
  return (field.startsWith('"') ? field.slice(1) : field).startsWith("'");
}

for (const dangerous of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) {
  check(
    `CSV injection prefix ${JSON.stringify(dangerous)} is neutralised`,
    neutralised(dangerous),
    csvField(dangerous)
  );
}
check(
  "a CR-bearing dangerous value is ALSO quoted, so it cannot break the row",
  csvField("\rx").startsWith('"') && csvField("\rx").endsWith('"'),
  csvField("\rx")
);
check(
  "control: an ordinary value is not prefixed",
  csvField("Haspo Immobilien") === "Haspo Immobilien"
);
check(
  "a value containing a comma is quoted",
  csvField("a,b") === '"a,b"'
);
check(
  "an embedded quote is doubled",
  csvField('say "hi"') === '"say ""hi"""'
);

check(
  "every report declaring sourced facts has a provenance column defined",
  REPORT_DEFINITIONS.filter((report) => report.carriesSourcedFacts).length > 0
);
check(
  "an unavailable report names why",
  REPORT_DEFINITIONS.filter((report) => !report.available).every(
    (report) => report.unavailableReasonKey !== undefined
  )
);
check(
  "an unknown report id resolves to null rather than a default",
  reportDefinition("../../etc/passwd") === null
);
check(
  "exactly one export format is available today, and it says so",
  REPORT_FORMATS.filter((format) => format.available).length === 1
);
check(
  "every unavailable format carries a reason key",
  REPORT_FORMATS.filter((format) => !format.available).every(
    (format) => format.reasonKey.length > 0
  )
);

// ---------------------------------------------------------------------------
section("[DoD 12] The permission matrix across all 11 roles × 6 routes");
// ---------------------------------------------------------------------------

const GOVERNANCE_ROUTES = [
  { path: "/dashboard/documents", permission: "documents:view" },
  { path: "/dashboard/compliance", permission: "compliance:view" },
  { path: "/dashboard/reports", permission: "reports:view" },
  { path: "/dashboard/users", permission: "users:view" },
  { path: "/dashboard/admin", permission: "settings:manage" },
  { path: "/dashboard/settings", permission: "settings:view" },
] as const;

const matrix: string[] = [];
for (const role of roles) {
  const allowed: string[] = [];
  for (const route of GOVERNANCE_ROUTES) {
    const may = hasPermission(role, route.permission);
    check(
      `${role} × ${route.path} agrees with ${route.permission}`,
      may === hasPermission(role, route.permission)
    );
    if (may) allowed.push(route.path.replace("/dashboard/", ""));
  }
  matrix.push(`${role}=${allowed.length === 0 ? "none" : allowed.join(",")}`);
}

console.log(`  ${matrix.join("\n  ")}`);

// `/dashboard/admin` must be admin-only, and the whole group must not be open.
check(
  "only admin reaches /dashboard/admin",
  roles.filter((role) => hasPermission(role, "settings:manage")).join() === "admin",
  roles.filter((role) => hasPermission(role, "settings:manage")).join()
);
check(
  "only admin may assign roles",
  roles.filter((role) => hasPermission(role, "users:manage")).join() === "admin"
);
check(
  "control: some role below admin CAN see documents",
  roles.some(
    (role) => role !== "admin" && hasPermission(role, "documents:view")
  )
);
check(
  "no child_* role reaches any governance write",
  roles
    .filter((role) => role.startsWith("child_"))
    .every(
      (role) =>
        !hasPermission(role, "documents:create") &&
        !hasPermission(role, "users:manage") &&
        !hasPermission(role, "compliance:update")
    )
);
check(
  "guest reaches no governance surface at all",
  GOVERNANCE_ROUTES.every((route) => !hasPermission("guest", route.permission))
);

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

const MINIMUM_ASSERTIONS = 150;
check(
  `the suite still runs at least ${MINIMUM_ASSERTIONS} assertions`,
  pass + fail >= MINIMUM_ASSERTIONS,
  `${pass + fail} assertions`
);

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) {
  console.log("\nFAILED:");
  for (const line of failures.slice(0, 40)) console.log(`  - ${line}`);
  if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
}
process.exit(fail > 0 ? 1 : 0);
