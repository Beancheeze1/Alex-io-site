// scripts/verify-revision-lettering.mjs
//
// Regression test for the revision-lettering scheme (release/revise/apply
// letter advancement) and the display invariant that came out of
// investigating a bug report against Q-REP-20260914-221352: a released
// quote must never show a trailing "S", and an unlocked (staging) quote
// must always show one.
//
// Drives the REAL routes end to end against a running server:
//   POST /api/quote/layout/apply          (staging revision bump)
//   POST /api/admin/quotes/lock           (release / revise)
//   GET  /api/quote/print                 (the sanitized revision the UI
//                                          actually reads -- quote.revision)
//
// Creates its own throwaway quote (quote_no below), runs 3 full
// release -> revise -> apply cycles, asserts on every checkpoint, then
// deletes everything it created (quotes/quote_items/quote_layout_packages
// rows, plus the Redis "facts" key for that quote_no) so it leaves no
// residue when run against a real environment.
//
// Usage:
//   BASE_URL=http://localhost:3000 \
//   ADMIN_SESSION_COOKIE=<a valid admin alexio_session cookie value> \
//   DATABASE_URL=<same DB the server is using> \
//   node scripts/verify-revision-lettering.mjs
//
// Requires: an admin session cookie for a real tenant/user (the quote is
// created under that user's tenant_id + sales_rep_id), a running server at
// BASE_URL with a material id=1 (or set MATERIAL_ID) available in that
// tenant's `materials` table, and Postgres access via DATABASE_URL to seed
// the layout package's step_text (skips needing a real STEP microservice --
// this script only checks lettering/display logic, not CAD fidelity) and to
// clean up afterward.
//
// There is no test framework in this repo (no jest/vitest, no CI) --
// this follows the existing scripts/ convention of a standalone, manually
// invoked Node script rather than introducing one.

import pg from "pg";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const COOKIE = process.env.ADMIN_SESSION_COOKIE;
const DATABASE_URL = process.env.DATABASE_URL;
const MATERIAL_ID = Number(process.env.MATERIAL_ID || 1);
const QUOTE_NO = process.env.QUOTE_NO || `Q-REVTEST-${Date.now()}`;

if (!COOKIE) {
  console.error("Missing ADMIN_SESSION_COOKIE env var (a valid admin alexio_session cookie value).");
  process.exit(2);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var.");
  process.exit(2);
}

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!cond) failures++;
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

const H = { "Content-Type": "application/json", Cookie: `alexio_session=${COOKIE}` };

async function apply(qty) {
  const res = await fetch(`${BASE_URL}/api/quote/layout/apply`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      quoteNo: QUOTE_NO,
      layout: { block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 }, cavities: [] },
      materialId: MATERIAL_ID, qty,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(`apply failed: ${JSON.stringify(json)}`);
  // Give the just-touched package a non-empty step_text so Lock's STEP
  // check passes without needing a real STEP microservice configured --
  // this script is only exercising lettering/display logic, not CAD
  // generation fidelity.
  await db.query(
    `UPDATE public.quote_layout_packages SET step_text = 'ISO-10303-21;PLACEHOLDER;END-ISO-10303-21;'
     WHERE id = (
       SELECT id FROM public.quote_layout_packages
       WHERE quote_id = (SELECT id FROM public.quotes WHERE quote_no = $1)
       ORDER BY created_at DESC, id DESC LIMIT 1
     )`,
    [QUOTE_NO],
  );
  return json;
}

async function lock(doLock) {
  const res = await fetch(`${BASE_URL}/api/admin/quotes/lock`, {
    method: "POST", headers: H,
    body: JSON.stringify({ quoteNo: QUOTE_NO, lock: doLock }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function printState() {
  const res = await fetch(`${BASE_URL}/api/quote/print?quote_no=${encodeURIComponent(QUOTE_NO)}`, { headers: H });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(`print failed: ${JSON.stringify(json)}`);
  return json;
}

function assertInvariant(label, locked, revision) {
  const hasS = /S$/i.test(revision || "");
  const ok = locked ? !hasS : hasS;
  check(
    `invariant @ ${label}: locked=${locked} revision="${revision}" -- ${locked ? "must have NO trailing S" : "must HAVE trailing S"}`,
    ok,
  );
}

async function cleanup() {
  await db.query(`DELETE FROM public.quote_layout_packages WHERE quote_id = (SELECT id FROM public.quotes WHERE quote_no = $1)`, [QUOTE_NO]);
  await db.query(`DELETE FROM public.quote_items WHERE quote_id = (SELECT id FROM public.quotes WHERE quote_no = $1)`, [QUOTE_NO]);
  await db.query(`DELETE FROM public.quotes WHERE quote_no = $1`, [QUOTE_NO]);
  // Best-effort: clear the facts key too, so nothing lingers even under the
  // Redis TTL. Not fatal if this route doesn't exist in a given deployment.
  await fetch(`${BASE_URL}/api/admin/mem`, {
    method: "POST", headers: H,
    body: JSON.stringify({ key: QUOTE_NO, replace: {} }),
  }).catch(() => null);
  console.log(`\nCleaned up test quote ${QUOTE_NO}.`);
}

try {
  console.log(`Testing against ${BASE_URL}, quote ${QUOTE_NO}\n`);

  console.log("=== Cycle 1: first-ever Apply, then release ===");
  await apply(1);
  let state = await printState();
  check("first Apply produces staging label AS (no prior revision)", state.quote.revision === "AS", `got "${state.quote.revision}"`);
  assertInvariant("cycle1 pre-release", state.quote.locked, state.quote.revision);

  const lock1 = await lock(true);
  check("lock 1 (release) succeeded", lock1.json?.ok === true, JSON.stringify(lock1.json));
  state = await printState();
  const released1 = state.quote.revision;
  check("release 1 produces letter A", released1 === "A", `got "${released1}"`);
  assertInvariant("cycle1 post-release", state.quote.locked, state.quote.revision);

  console.log("\n=== Cycle 1: revise (unlock) then Apply again ===");
  check("unlock 1 (Revise) succeeded", (await lock(false)).json?.ok === true);
  await apply(1);
  state = await printState();
  check("staging continues the SAME letter just released: A -> AS (not a reset)", state.quote.revision === "AS", `got "${state.quote.revision}"`);
  assertInvariant("cycle1 post-revise-apply", state.quote.locked, state.quote.revision);

  console.log("\n=== Cycle 2: release again -- released track must advance to B ===");
  const lock2 = await lock(true);
  check("lock 2 (release) succeeded", lock2.json?.ok === true, JSON.stringify(lock2.json));
  state = await printState();
  const released2 = state.quote.revision;
  check("release 2 produces letter B (advances from A, never resets)", released2 === "B", `got "${released2}"`);
  assertInvariant("cycle2 post-release", state.quote.locked, state.quote.revision);

  console.log("\n=== Cycle 2: revise (unlock) then Apply again ===");
  check("unlock 2 (Revise) succeeded", (await lock(false)).json?.ok === true);
  await apply(1);
  state = await printState();
  check("staging continues the SAME letter just released: B -> BS (not a reset to AS)", state.quote.revision === "BS", `got "${state.quote.revision}"`);
  assertInvariant("cycle2 post-revise-apply", state.quote.locked, state.quote.revision);

  console.log("\n=== Cycle 3: one more Apply before release (BS->CS), then release -> C ===");
  await apply(1);
  state = await printState();
  check("staging advances BS->CS on a second Apply before release", state.quote.revision === "CS", `got "${state.quote.revision}"`);
  assertInvariant("cycle3 pre-release (2nd apply)", state.quote.locked, state.quote.revision);

  const lock3 = await lock(true);
  check("lock 3 (release) succeeded", lock3.json?.ok === true, JSON.stringify(lock3.json));
  state = await printState();
  const released3 = state.quote.revision;
  check("release 3 produces letter C (advances from B, never resets)", released3 === "C", `got "${released3}"`);
  assertInvariant("cycle3 post-release", state.quote.locked, state.quote.revision);

  console.log("\n=== Cycle 3: revise (unlock) then Apply again ===");
  check("unlock 3 (Revise) succeeded", (await lock(false)).json?.ok === true);
  await apply(1);
  state = await printState();
  check("staging continues the SAME letter just released: C -> CS (not a reset to AS)", state.quote.revision === "CS", `got "${state.quote.revision}"`);
  assertInvariant("cycle3 post-revise-apply", state.quote.locked, state.quote.revision);

  console.log("\n=== Released-track summary across all 3 cycles ===");
  check("released letters strictly advanced A -> B -> C (never repeated, never reset)",
    released1 === "A" && released2 === "B" && released3 === "C",
    `A=${released1} B=${released2} C=${released3}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
} finally {
  await cleanup();
  await db.end();
}

process.exit(failures === 0 ? 0 : 1);
