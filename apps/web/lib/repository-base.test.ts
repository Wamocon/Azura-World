/**
 * W2-A contract tests for the repository envelope.
 *
 * The W2-A brief names eight required tests and says of two of them: "Test 3 and
 * test 4 are the ones that catch real bugs. Write them first." They are the first
 * two suites below.
 *
 * Run: node --test --experimental-strip-types apps/web/lib/repository-base.test.ts
 */

import assert from "node:assert/strict"
import test from "node:test"

import type { RepositoryResult } from "./contracts"
import {
  RepositoryError,
  asMoney,
  asNullableNumber,
  asNumber,
  clampLimit,
  clampOffset,
  degraded,
  runRepository,
  seedIso,
  seedResult,
  toApiError,
  totalsByCurrency,
  type RepositoryClient,
  type RepositoryDeps,
} from "./repository-base"

// A client stand-in. `runRepository` only ever passes it through to `fn`, so the
// tests never touch its surface and a cast is the honest way to say so.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque handle; never dereferenced in these tests
const FAKE_CLIENT = {} as any as RepositoryClient

const configured: RepositoryDeps = {
  isConfigured: () => true,
  getClient: async () => FAKE_CLIENT,
}

const unconfigured: RepositoryDeps = {
  isConfigured: () => false,
  getClient: async () => null,
}

const SEED = ["seed-row"]

// ---------------------------------------------------------------------------
// Test 3 — configured + failing must THROW, and must NOT fall back
// ---------------------------------------------------------------------------

test("configured Supabase that fails throws a mapped ApiError and never serves seed data", async () => {
  let fallbackCalled = false

  await assert.rejects(
    () =>
      runRepository(
        async () => {
          throw Object.assign(new Error("permission denied for table units"), {
            code: "42501",
          })
        },
        () => {
          fallbackCalled = true
          return SEED
        },
        "test.throws",
        configured,
      ),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryError, "throws a RepositoryError")
      assert.equal(error.apiError.code, "forbidden", "42501 maps to forbidden")
      assert.equal(error.apiError.retryable, false)
      return true
    },
  )

  // The whole point: an outage must not be disguised as plausible seed data.
  assert.equal(fallbackCalled, false, "the seed fallback was NOT invoked")
})

test("the mapped ApiError never leaks the Postgres message to the client", () => {
  const raw = "permission denied for table finance_ledger_entries"
  const mapped = toApiError({ code: "42501", message: raw }, "test.leak")
  assert.ok(!mapped.message.includes("finance_ledger_entries"), "no table name in the message")
  assert.ok(!mapped.message.includes(raw), "no raw Postgres text in the message")
})

test("Postgres error codes map onto the frozen ApiError union", () => {
  assert.equal(toApiError({ code: "42501", message: "" }, "t").code, "forbidden")
  assert.equal(toApiError({ code: "23505", message: "" }, "t").code, "conflict")
  assert.equal(toApiError({ code: "23514", message: "" }, "t").code, "validation_failed")
  assert.equal(toApiError({ code: "23503", message: "" }, "t").code, "validation_failed")
  assert.equal(toApiError({ code: "PGRST116", message: "" }, "t").code, "not_found")
  // 22023: the search RPC rejects an over-long query. It is the caller's input that is
  // wrong, so it must not come back as a retryable 503.
  assert.equal(toApiError({ code: "22023", message: "" }, "t").code, "validation_failed")
  assert.equal(toApiError({ code: "22023", message: "" }, "t").retryable, false)
  assert.equal(toApiError({ code: "42P01", message: "" }, "t").code, "persistence_unavailable")
  assert.equal(toApiError({ code: "40001", message: "" }, "t").retryable, true)
  // An unrecognised failure is an outage, never a 500 for the caller.
  assert.equal(toApiError(new Error("boom"), "t").code, "persistence_unavailable")
})

// ---------------------------------------------------------------------------
// Test 4 — configured + empty is a fact about the database, not a failure
// ---------------------------------------------------------------------------

test("configured Supabase returning zero rows reports source=supabase and does NOT substitute seed data", async () => {
  let fallbackCalled = false

  const result = await runRepository<string[]>(
    async () => [],
    () => {
      fallbackCalled = true
      return SEED
    },
    "test.empty",
    configured,
  )

  assert.equal(result.source, "supabase", "an empty table is still the database talking")
  assert.deepEqual(result.data, [], "the empty result is preserved")
  assert.equal(fallbackCalled, false, "the seed fallback was NOT invoked")
  assert.equal(result.degradedReason, undefined, "an empty result is not degraded")
})

// ---------------------------------------------------------------------------
// Tests 1 & 2 — the envelope itself
// ---------------------------------------------------------------------------

test("unconfigured Supabase falls back to local-seed and labels the reason", async () => {
  const result = await runRepository<string[]>(
    async () => {
      throw new Error("must not be called when unconfigured")
    },
    () => SEED,
    "test.unconfigured",
    unconfigured,
  )

  assert.equal(result.source, "local-seed")
  assert.deepEqual(result.data, SEED)
  assert.ok(result.degradedReason, "a local-seed fallback always explains itself")
})

test("every result carries source and fetchedAt", async () => {
  const results: RepositoryResult<unknown>[] = [
    await runRepository(async () => ["x"], () => SEED, "t", configured),
    await runRepository(async () => ["x"], () => SEED, "t", unconfigured),
    seedResult(["x"]),
  ]

  for (const result of results) {
    assert.ok(
      result.source === "supabase" || result.source === "local-seed",
      "source is one of the two contract values",
    )
    assert.ok(result.fetchedAt, "fetchedAt is present")
    assert.doesNotThrow(() => new Date(result.fetchedAt).toISOString(), "fetchedAt is a real ISO instant")
  }
})

test("a configured environment whose client cannot be built is an outage, not a fallback", async () => {
  let fallbackCalled = false

  await assert.rejects(
    () =>
      runRepository(
        async () => ["x"],
        () => {
          fallbackCalled = true
          return SEED
        },
        "test.nullclient",
        { isConfigured: () => true, getClient: async () => null },
      ),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryError)
      assert.equal(error.apiError.code, "persistence_unavailable")
      return true
    },
  )

  assert.equal(fallbackCalled, false, "a broken client does not silently serve seed data")
})

// ---------------------------------------------------------------------------
// Test 7 — seed determinism
// ---------------------------------------------------------------------------

test("seedIso is deterministic and independent of the wall clock", () => {
  assert.equal(seedIso(0), seedIso(0), "two calls agree")
  assert.equal(seedIso(0, 9), "2026-07-27T09:00:00.000Z", "anchored, not now()")
  assert.equal(seedIso(-1, 9), "2026-07-26T09:00:00.000Z", "negative offsets go backwards")
  assert.equal(seedIso(1, 13), "2026-07-28T13:00:00.000Z", "the hour is honoured")
})

// ---------------------------------------------------------------------------
// Coercion — the PostgREST numeric-as-string trap, and null vs 0
// ---------------------------------------------------------------------------

test("numeric columns arrive as strings and are parsed, not assumed", () => {
  assert.equal(asNullableNumber("112000.00"), 112000)
  assert.equal(asNullableNumber(112000), 112000)
  assert.equal(asNullableNumber("0.01"), 0.01)
})

test("null stays null and never becomes 0 — a price of 0 is a bug, null is an honest gap", () => {
  assert.equal(asNullableNumber(null), null)
  assert.equal(asNullableNumber(undefined), null)
  assert.equal(asNullableNumber(""), null)
  assert.equal(asNullableNumber("not a number"), null)
  // The explicit-default path still exists, but the caller has to ask for it.
  assert.equal(asNumber(null, 0), 0)
})

test("asMoney refuses an amount without a currency rather than inventing one", () => {
  assert.deepEqual(asMoney("112000.00", "EUR"), { amount: 112000, currency: "EUR" })
  assert.equal(asMoney("112000.00", null), null, "no currency means no Money")
  assert.equal(asMoney(null, "EUR"), null, "no amount means no Money")
  assert.equal(asMoney("112000.00", "XYZ"), null, "an unknown currency is rejected, not defaulted")
})

test("totals are computed per currency and never summed across them", () => {
  const totals = totalsByCurrency([
    { amount: 100, currency: "EUR" },
    { amount: 50, currency: "EUR" },
    { amount: 200, currency: "USD" },
  ])
  assert.deepEqual(totals, { EUR: 150, USD: 200 })
  assert.equal(Object.keys(totals).length, 2, "EUR and USD stay separate")
})

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("limits are clamped — never an unbounded select", () => {
  assert.equal(clampLimit(undefined), 50, "default 50")
  assert.equal(clampLimit(10), 10)
  assert.equal(clampLimit(0), 1, "floor of 1")
  assert.equal(clampLimit(-5), 1)
  assert.equal(clampLimit(5000), 500, "hard ceiling of 500")
  assert.equal(clampLimit(656), 500, "the full unit inventory is still capped")
  assert.equal(clampLimit(Number.NaN), 50)
  assert.equal(clampOffset(undefined), 0)
  assert.equal(clampOffset(-10), 0)
  assert.equal(clampOffset(25), 25)
})

// ---------------------------------------------------------------------------
// Partial failure
// ---------------------------------------------------------------------------

test("degraded() names what failed without discarding what succeeded", () => {
  const base = seedResult(["panel-a"])
  const marked = degraded(base, "finance panel unavailable")

  assert.deepEqual(marked.data, ["panel-a"], "the successful data survives")
  assert.ok(marked.degradedReason?.includes("finance panel"), "the failure is named")

  const twice = degraded(marked, "tickets panel unavailable")
  assert.ok(twice.degradedReason?.includes("finance panel"))
  assert.ok(twice.degradedReason?.includes("tickets panel"), "reasons accumulate rather than overwrite")
})
