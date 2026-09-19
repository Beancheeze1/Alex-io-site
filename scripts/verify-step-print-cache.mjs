// scripts/verify-step-print-cache.mjs
//
// Regression test for the STEP-regeneration caching fix in
// app/api/quote/print/route.ts, investigated after /admin/logs showed the
// same "STEP generated for Q-REP-20260805-080423 with 2 spacing warning(s)"
// line repeating 15+ times over 3 days, clustered within minutes of each
// other on an UNLOCKED quote.
//
// Root cause: GET /api/quote/print's staffUnlockedRegen branch called the
// external STEP microservice (lib/cad/step.ts's buildStepFromLayout, which
// round-trips to STEP_SERVICE_URL) unconditionally on every request, with
// no check for whether the layout had actually changed since the last
// generation. Both AdminQuoteClient.tsx and QuotePrintClient.tsx fetch this
// route in a useEffect on every mount -- i.e. every time staff open or
// reload an unlocked quote's page -- so every view silently re-hit the
// external service and re-logged the same warning, even with zero layout
// changes in between.
//
// The fix: extractGeometryHashFromStep() (new, in app/lib/layout/exports.ts,
// counterpart to the existing embedGeometryHashInStep()) reads the hash
// already embedded in the stored step_text (written by whatever Apply last
// ran) and compares it to a freshly computed hash of the current
// layout_json. If they match, the stored step_text is served as-is and the
// microservice is never called. This mirrors the locked-quote branch's
// existing quotes.geometry_hash comparison, just sourcing the "last known
// good" hash from the stored STEP text instead (since quotes.geometry_hash
// is intentionally never written pre-lock).
//
// This script drives the REAL routes end to end against a running server,
// with a local STUB STEP microservice standing in for the real
// alex-io-step-service -- the real service is an external, network-called
// dependency we don't want this test hitting, and a stub lets us assert on
// exactly how many times it was called.
//
// Covers:
//   1. Apply a layout -> confirm the stored step_text has the geometry hash
//      embedded (extractGeometryHashFromStep round-trips).
//   2. GET /api/quote/print twice in a row, no layout change in between ->
//      confirm the STEP stub is NOT called a second time and the served
//      step_text is byte-identical both times (served from storage, not
//      regenerated).
//   3. Directly mutate quote_layout_packages.layout_json in the DB (a
//      cavity added) WITHOUT touching step_text -- simulates a stale
//      cache/out-of-band layout change, isolating the print route's own
//      regen-detection from Apply's own (separate, already-correct,
//      unconditional) regeneration -- then GET /api/quote/print again ->
//      confirm the stub IS called this time, and the newly returned
//      step_text's embedded hash differs from the pre-change one.
//   4. Directly mark the quote locked with a matching quotes.geometry_hash
//      -> confirm GET /api/quote/print serves the existing step_text
//      completely unchanged and does NOT call the stub -- proves the fix
//      didn't touch/regress the locked-quote hash-check path, which never
//      called buildStepFromLayout from this route at all, before or after.
//
// Usage:
//   1. Start a local stub STEP microservice on its own (this script starts
//      one automatically on STUB_STEP_PORT, default 8799) -- or just let
//      this script start it; the URL is printed at startup.
//   2. Start (or restart) your dev/test server with:
//        STEP_SERVICE_URL=http://127.0.0.1:8799
//      pointing at that stub -- the app must be talking to the stub, not
//      the real Render-hosted microservice, for the call-count assertions
//      to mean anything.
//   3. Run:
//        BASE_URL=http://localhost:3000 \
//        ADMIN_SESSION_COOKIE=<a valid admin alexio_session cookie value> \
//        DATABASE_URL=<same DB the server is using> \
//        npx tsx scripts/verify-step-print-cache.mjs
//
// Requires: an admin session cookie for a real tenant/user, a running
// server at BASE_URL (started with STEP_SERVICE_URL pointing at this
// script's stub), a material id=1 (or set MATERIAL_ID) in that tenant's
// materials table, and Postgres access via DATABASE_URL to directly mutate
// layout_json/quotes for steps 3-4 and to clean up afterward.
//
// Run via `npx tsx` (not plain node) so the direct import below of
// app/lib/layout/exports.ts's pure hash helpers works without a build step.

import pg from "pg";
import http from "node:http";
import { computeGeometryHash, extractGeometryHashFromStep } from "../app/lib/layout/exports.ts";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const COOKIE = process.env.ADMIN_SESSION_COOKIE;
const DATABASE_URL = process.env.DATABASE_URL;
const MATERIAL_ID = Number(process.env.MATERIAL_ID || 1);
const QUOTE_NO = process.env.QUOTE_NO || `Q-STEPCACHE-${Date.now()}`;
const STUB_STEP_PORT = Number(process.env.STUB_STEP_PORT || 8799);

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

// ---- Stub STEP microservice -----------------------------------------------
// Mimics alex-io-step-service's POST /step-from-layout contract just enough
// for buildStepFromLayout() (lib/cad/step.ts) to treat it as a real
// success: { ok: true, step: "...", warnings: [...] }. Tracks call count so
// this script can assert exactly when the app does and doesn't reach out to
// it.
let stubCallCount = 0;
const stubServer = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/step-from-layout") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      stubCallCount++;
      let quoteNo = "unknown";
      try {
        quoteNo = JSON.parse(body)?.quoteNo || "unknown";
      } catch {
        // ignore
      }
      const step = `ISO-10303-21;\n/* stub call #${stubCallCount} for ${quoteNo} */\nEND-ISO-10303-21;`;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, step, warnings: [] }));
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

async function startStub() {
  await new Promise((resolve, reject) => {
    stubServer.once("error", reject);
    stubServer.listen(STUB_STEP_PORT, "127.0.0.1", resolve);
  });
  console.log(`Stub STEP microservice listening on http://127.0.0.1:${STUB_STEP_PORT}/step-from-layout`);
  console.log(`Make sure the app server at ${BASE_URL} was started with STEP_SERVICE_URL=http://127.0.0.1:${STUB_STEP_PORT}\n`);
}

// ---- App HTTP helpers -------------------------------------------------

const H = { "Content-Type": "application/json", Cookie: `alexio_session=${COOKIE}` };

function baseLayout(cavityCount) {
  const cavities =
    cavityCount > 0
      ? [{ id: "cav1", shape: "rect", x: 0.2, y: 0.2, lengthIn: 2, widthIn: 2, depthIn: 0.5 }]
      : [];
  return {
    block: { lengthIn: 10, widthIn: 10, thicknessIn: 2 },
    stack: [{ thicknessIn: 2, label: "Layer 1", cavities }],
    cavities,
  };
}

async function apply(layout) {
  const res = await fetch(`${BASE_URL}/api/quote/layout/apply`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ quoteNo: QUOTE_NO, layout, materialId: MATERIAL_ID, qty: 1 }),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(`apply failed: ${JSON.stringify(json)}`);
  return json;
}

async function print() {
  const res = await fetch(`${BASE_URL}/api/quote/print?quote_no=${encodeURIComponent(QUOTE_NO)}`, { headers: H });
  const json = await res.json().catch(() => null);
  if (!json?.ok) throw new Error(`print failed: ${JSON.stringify(json)}`);
  return json;
}

// ---- DB helpers ---------------------------------------------------------

const db = new pg.Client({ connectionString: DATABASE_URL });

async function getLatestLayoutPkg() {
  const { rows } = await db.query(
    `select lp.id, lp.layout_json, lp.step_text
     from quote_layout_packages lp
     join quotes q on q.id = lp.quote_id
     where q.quote_no = $1
     order by lp.created_at desc, lp.id desc
     limit 1`,
    [QUOTE_NO],
  );
  return rows[0] ?? null;
}

async function mutateLayoutJsonOnly(newLayout) {
  // Simulates an out-of-band layout change that left step_text stale --
  // deliberately NOT calling apply here, so this isolates the print
  // route's own regen-vs-serve decision from apply's separate (already
  // correct, unconditional) STEP regeneration.
  const pkg = await getLatestLayoutPkg();
  await db.query(`update quote_layout_packages set layout_json = $2 where id = $1`, [pkg.id, newLayout]);
}

async function lockWithMatchingHash() {
  const pkg = await getLatestLayoutPkg();
  const hash = computeGeometryHash(pkg.layout_json);
  await db.query(
    `update quotes set locked = true, geometry_hash = $2, locked_at = now() where quote_no = $1`,
    [QUOTE_NO, hash],
  );
  return hash;
}

async function cleanup() {
  await db.query(`delete from quote_layout_packages where quote_id = (select id from quotes where quote_no = $1)`, [QUOTE_NO]);
  await db.query(`delete from quote_items where quote_id = (select id from quotes where quote_no = $1)`, [QUOTE_NO]);
  await db.query(`delete from quotes where quote_no = $1`, [QUOTE_NO]);
  await fetch(`${BASE_URL}/api/admin/mem`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ key: QUOTE_NO, replace: {} }),
  }).catch(() => null);
  console.log(`\nCleaned up test quote ${QUOTE_NO}.`);
}

// ---- Run ------------------------------------------------------------------

try {
  await startStub();
  await db.connect();

  console.log(`Testing against ${BASE_URL}, quote ${QUOTE_NO}\n`);

  console.log("=== Step 1: apply a layout, confirm the stored step_text embeds the geometry hash ===");
  const layoutA = baseLayout(0);
  await apply(layoutA);
  const pkgAfterApply = await getLatestLayoutPkg();
  const hashA = computeGeometryHash(pkgAfterApply.layout_json);
  const embeddedHashAfterApply = extractGeometryHashFromStep(pkgAfterApply.step_text);
  check(
    "stored step_text has a geometry hash embedded, matching the just-applied layout",
    embeddedHashAfterApply === hashA,
    `embedded="${embeddedHashAfterApply}" expected="${hashA}"`,
  );
  const callsAfterApply = stubCallCount;
  console.log(`(stub call count after apply: ${callsAfterApply})`);

  console.log("\n=== Step 2: GET /api/quote/print twice with no layout change -- second call must NOT hit the STEP stub ===");
  const print1 = await print();
  const callsAfterPrint1 = stubCallCount;
  const print2 = await print();
  const callsAfterPrint2 = stubCallCount;

  check(
    "first print did not need to call the stub (Apply already stored a matching step_text)",
    callsAfterPrint1 === callsAfterApply,
    `calls: after apply=${callsAfterApply}, after print1=${callsAfterPrint1}`,
  );
  check(
    "second print made ZERO additional stub calls (cache hit, not regenerated)",
    callsAfterPrint2 === callsAfterPrint1,
    `calls: after print1=${callsAfterPrint1}, after print2=${callsAfterPrint2}`,
  );
  check(
    "step_text served identically both times (byte-identical, straight from storage)",
    print1.layoutPkg?.step_text === print2.layoutPkg?.step_text,
    `print1 len=${print1.layoutPkg?.step_text?.length}, print2 len=${print2.layoutPkg?.step_text?.length}`,
  );

  console.log("\n=== Step 3: layout changes out-of-band (stale step_text) -- next print MUST regenerate ===");
  const layoutB = baseLayout(1); // adds a cavity -> different geometry hash
  await mutateLayoutJsonOnly(layoutB);
  const hashB = computeGeometryHash(layoutB);
  check("layout B actually hashes differently from layout A (sanity check on the test itself)", hashB !== hashA, `hashA=${hashA} hashB=${hashB}`);

  const print3 = await print();
  const callsAfterPrint3 = stubCallCount;
  const embeddedHash3 = extractGeometryHashFromStep(print3.layoutPkg?.step_text);

  check(
    "print DID call the STEP stub after the out-of-band layout change (regeneration happened)",
    callsAfterPrint3 === callsAfterPrint2 + 1,
    `calls: after print2=${callsAfterPrint2}, after print3=${callsAfterPrint3}`,
  );
  check(
    "newly served step_text embeds the NEW hash (layout B), not the stale one",
    embeddedHash3 === hashB,
    `embedded="${embeddedHash3}" expected="${hashB}"`,
  );
  check(
    "new step_text differs from the pre-change step_text",
    print3.layoutPkg?.step_text !== print2.layoutPkg?.step_text,
  );

  console.log("\n=== Step 4: locked-quote path is unaffected by this fix ===");
  const lockedHash = await lockWithMatchingHash();
  const print4 = await print();
  const callsAfterPrint4 = stubCallCount;

  check(
    "locked print made ZERO stub calls (locked branch never called the microservice from this route, before or after the fix)",
    callsAfterPrint4 === callsAfterPrint3,
    `calls: after print3=${callsAfterPrint3}, after print4(locked)=${callsAfterPrint4}`,
  );
  check(
    "locked print serves the exact stored step_text unchanged",
    print4.layoutPkg?.step_text === print3.layoutPkg?.step_text,
  );
  check(
    "locked print's step_text still embeds the hash matching quotes.geometry_hash",
    extractGeometryHashFromStep(print4.layoutPkg?.step_text) === lockedHash,
  );

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
} finally {
  await cleanup().catch((e) => console.error("cleanup failed:", e));
  await db.end().catch(() => {});
  await new Promise((resolve) => stubServer.close(resolve));
}

process.exit(failures === 0 ? 0 : 1);
