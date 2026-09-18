// scripts/verify-revision-lettering.mjs
//
// Regression test for the revision-lettering scheme (release/revise/apply
// letter advancement) and the display invariant that came out of
// investigating a bug report against Q-REP-20260914-221352.
//
// Two fully independent, monotonically-advancing sequences live on every
// quote:
//   - RELEASED (facts.released_rev / bare letter, e.g. "B"): advances by
//     exactly one letter on every Lock/RFM release, via
//     nextReleasedLetter() in app/api/admin/quotes/lock/route.ts.
//   - STAGING (facts.stage_rev / letter+"S", e.g. "BS"): advances by one
//     letter on every successful Apply while unlocked, via nextStageRev()
//     in app/api/quote/layout/apply/route.ts -- computed from the highest
//     staging letter this quote has EVER reached, across every release
//     cycle. It must NEVER be derived from, reset to, or coupled with the
//     released letter.
//
// A prior version of apply/route.ts (commit 0f307c09, well before this
// script existed) computed the next staging letter from facts.revision
// (which release resets to the bare released letter) instead of
// facts.stage_rev (which release never touches once set) -- coupling
// staging continuation to whatever letter had just been released. This
// script's "reach BS before ever releasing" cycle 1 is specifically
// designed to expose that: with the bug, releasing "BS" as the first-ever
// release mints "A", and the next Apply then reads facts.revision="A" and
// produces "AS" (repeats/regresses); fixed, it reads facts.stage_rev="BS"
// and correctly produces "CS" (continues forward).
//
// This also checks the separate display invariant fixed alongside the
// staging-letter bug: a locked/released quote must never show a trailing
// "S"; an unlocked (staging) quote must always show one -- via the real
// /api/quote/print response (quote.revision, the field the UI reads).
//
// Drives the REAL routes end to end against a running server:
//   POST /api/quote/layout/apply          (staging revision bump)
//   POST /api/admin/quotes/lock           (release / revise)
//   GET  /api/quote/print                 (the sanitized revision the UI
//                                          actually reads -- quote.revision)
//
// Creates its own throwaway quote (quote_no below), runs the full scenario,
// then deletes everything it created (quotes/quote_items/
// quote_layout_packages rows, plus the Redis "facts" key for that
// quote_no) so it leaves no residue when run against a real environment.
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
const seenRevisions = [];

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

async function applyAndCheck(label, expected) {
  await apply(1);
  const state = await printState();
  seenRevisions.push(state.quote.revision);
  check(`${label}: expected "${expected}"`, state.quote.revision === expected, `got "${state.quote.revision}"`);
  assertInvariant(label, state.quote.locked, state.quote.revision);
  return state.quote.revision;
}

async function releaseAndCheck(label, expected) {
  const res = await lock(true);
  check(`${label}: lock succeeded`, res.json?.ok === true, JSON.stringify(res.json));
  const state = await printState();
  seenRevisions.push(state.quote.revision);
  check(`${label}: expected "${expected}"`, state.quote.revision === expected, `got "${state.quote.revision}"`);
  assertInvariant(label, state.quote.locked, state.quote.revision);
  return state.quote.revision;
}

async function reviseAndCheck(label) {
  const res = await lock(false);
  check(`${label}: unlock (Revise) succeeded`, res.json?.ok === true, JSON.stringify(res.json));
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

  console.log("=== Chuck's exact scenario: reach BS pre-release, THEN release for the first time ===");
  console.log("--- First Apply: no prior revision -> AS ---");
  await applyAndCheck("apply 1 (first ever)", "AS");

  console.log("\n--- Second Apply BEFORE any release: AS -> BS ---");
  await applyAndCheck("apply 2 (still pre-release)", "BS");

  console.log("\n--- First-ever release, from BS: mints released letter A ---");
  await releaseAndCheck("release 1 (first ever, from BS)", "A");

  console.log("\n--- Revise, then Apply: staging MUST continue from BS -> CS, NOT reset to AS ---");
  await reviseAndCheck("unlock 1 (Revise)");
  await applyAndCheck("apply 3 (post-release-1): must continue BS -> CS, not reset to AS", "CS");

  console.log("\n--- One more Apply before releasing again: CS -> DS ---");
  await applyAndCheck("apply 4 (still pre-release-2)", "DS");

  console.log("\n--- Release again: released track advances independently, A -> B ---");
  await releaseAndCheck("release 2 (from DS)", "B");

  console.log("\n--- Revise, then Apply: staging MUST continue from DS -> ES, NOT couple to released B (\"BS\") ---");
  await reviseAndCheck("unlock 2 (Revise)");
  await applyAndCheck("apply 5 (post-release-2): must continue DS -> ES, not reset/couple to BS", "ES");

  console.log("\n=== Full sequence produced (must have zero repeats) ===");
  console.log(" ", seenRevisions.join(" -> "));
  const unique = new Set(seenRevisions);
  check("zero repeats anywhere in the sequence", unique.size === seenRevisions.length,
    `${seenRevisions.length} entries, ${unique.size} unique: [${seenRevisions.join(", ")}]`);
  check("staging climbed continuously across two release cycles: AS,BS,CS,DS,ES all appeared in order",
    seenRevisions.filter((r) => /S$/.test(r)).join(",") === "AS,BS,CS,DS,ES",
    seenRevisions.filter((r) => /S$/.test(r)).join(","));
  check("released track advanced independently and never repeated: A, B",
    seenRevisions.filter((r) => !/S$/.test(r)).join(",") === "A,B",
    seenRevisions.filter((r) => !/S$/.test(r)).join(","));

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
} finally {
  await cleanup();
  await db.end();
}

process.exit(failures === 0 ? 0 : 1);
