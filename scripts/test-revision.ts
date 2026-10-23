// scripts/test-revision.ts
//
// Step 39K: revision labels (app/lib/revision-label.ts) without a server:
// the next staging letter, Revise opening it right away, and what a locked /
// unlocked quote shows. (scripts/verify-revision-lettering.mjs drives the
// real routes against a running server.)
// Run: npm run test:revision   (= npx --yes tsx scripts/test-revision.ts)

import { displayRevisionLabel, nextStageLabel, revisedFacts } from "../app/lib/revision-label";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

check("next stage: none -> AS", nextStageLabel(null), "AS");
check("next stage: AS -> BS", nextStageLabel("AS"), "BS");
check("next stage: Rev CS -> DS", nextStageLabel("Rev CS"), "DS");
check("next stage: bare released B -> BS", nextStageLabel("B"), "BS");
check("next stage: ZS stays ZS", nextStageLabel("ZS"), "ZS");

// Chuck's case (Oct 22): a boxes-only quote, staged AS, released A, then Revise
const released = { stage_rev: "AS", released_rev: "A", revision: "A", pack_type: "boxes_only" };
check("released quote shows A", displayRevisionLabel(released, true), "A");
const revised = revisedFacts(released);
check("Revise -> stage BS", revised.stage_rev, "BS");
check("Revise -> revision BS", revised.revision, "BS");
check("Revise marks the letter fresh", revised.stage_fresh, true);
check("Revise keeps the released letter", revised.released_rev, "A");
check("Revise keeps other facts", revised.pack_type, "boxes_only");
check("revised quote shows BS (not AS)", displayRevisionLabel(revised, false), "BS");

// Release B, then Revise again -> CS
const released2 = { ...revised, released_rev: "B", revision: "B" };
check("released again shows B", displayRevisionLabel(released2, true), "B");
check("second Revise -> CS", revisedFacts(released2).revision, "CS");

// A quote with no revision history at all
check("Revise with no history -> BS (after the first staging AS)", revisedFacts({}).revision, "BS");
check("unlocked, no history shows AS", displayRevisionLabel({}, false), "AS");

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
