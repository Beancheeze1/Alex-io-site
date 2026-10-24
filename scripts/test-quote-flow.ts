// scripts/test-quote-flow.ts
//
// Step 39R: tests for the quotes list flow stage (app/lib/quote-flow-core.ts).
// Run: npm run test:quote-flow   (= npx --yes tsx scripts/test-quote-flow.ts)

import { FLOW_INFO, FLOW_STAGES, flowCounts, flowStage, isFlowStage, reviseLabel, type FlowFacts } from "../app/lib/quote-flow-core";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

const base: FlowFacts = { locked: false, shipped_at: null, accepted_at: null, confirmed_at: null, reapprove: false, expired: false, sent: false };
const at = "2026-10-20T12:00:00.000Z";
const st = (o: Partial<FlowFacts>) => flowStage({ ...base, ...o });

check("new quote = draft", st({}) === "draft");
check("sent = sent", st({ sent: true }) === "sent");
check("expired beats sent", st({ sent: true, expired: true }) === "expired");
check("expired without sending = expired", st({ expired: true }) === "expired");
check("accepted = accepted", st({ sent: true, accepted_at: at }) === "accepted");
check("accepted beats expired", st({ expired: true, accepted_at: at }) === "accepted");
check("confirmed = confirmed", st({ accepted_at: at, confirmed_at: at }) === "confirmed");
check("price changed after accept = reapprove", st({ accepted_at: at, reapprove: true }) === "reapprove");
check("price changed after confirm = reapprove", st({ accepted_at: at, confirmed_at: at, reapprove: true }) === "reapprove");
check("released = in production", st({ locked: true, accepted_at: at, confirmed_at: at }) === "in_production");
check("released without accept = in production", st({ locked: true }) === "in_production");
check("released beats reapprove", st({ locked: true, reapprove: true }) === "in_production");
check("shipped = shipped", st({ locked: true, shipped_at: at }) === "shipped");
check("shipped after unlock still shipped", st({ locked: false, shipped_at: at }) === "shipped");

check("8 stages in order", FLOW_STAGES.join(",") === "draft,sent,accepted,reapprove,expired,confirmed,in_production,shipped");
check("every stage has a label, hint and color", FLOW_STAGES.every((s) => FLOW_INFO[s].label && FLOW_INFO[s].hint && /^#[0-9a-f]{6}$/.test(FLOW_INFO[s].color)));
check("colors are all different", new Set(FLOW_STAGES.map((s) => FLOW_INFO[s].color)).size === FLOW_STAGES.length);
check("isFlowStage", isFlowStage("sent") && !isFlowStage("rfm") && !isFlowStage(null));
const c = flowCounts(["draft", "sent", "sent", null, undefined, "shipped"]);
check("counts (missing skipped, zeros present)", c.draft === 1 && c.sent === 2 && c.shipped === 1 && c.accepted === 0 && Object.keys(c).length === 8, c);

check("button: released = Unlock & revise", reviseLabel({ locked: true }) === "Unlock & revise" && reviseLabel({ locked: true, boxes_only: true }) === "Unlock & revise");
check("button: foam not released = Revise", reviseLabel({ locked: false, boxes_only: false }) === "Revise");
check("button: box-only not released = Edit", reviseLabel({ locked: false, boxes_only: true }) === "Edit");

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
