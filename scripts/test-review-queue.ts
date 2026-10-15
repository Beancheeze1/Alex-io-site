// scripts/test-review-queue.ts
//
// Step 32: tests for the review queue rules (app/lib/review-queue-core.ts).
// Run: npm run test:queue   (= npx --yes tsx scripts/test-review-queue.ts)

import {
  groupBySection,
  isSnoozed,
  proofNeedsAttention,
  sectionCounts,
  snoozeUntil,
  visibleItems,
  waitedLabel,
  type QueueItem,
} from "../app/lib/review-queue-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const now = new Date("2026-10-15T16:00:00Z");
const item = (p: Partial<QueueItem>): QueueItem => ({
  section: "new",
  quote_id: 1,
  quote_no: "Q-1",
  customer: null,
  since: "2026-10-14T16:00:00Z",
  detail: "",
  assigned_user_id: null,
  assigned_name: null,
  snoozed_until: null,
  ...p,
});

const items = [
  item({ quote_no: "Q-B", since: "2026-10-13T00:00:00Z", section: "to_confirm", assigned_user_id: 7 }),
  item({ quote_no: "Q-A", since: "2026-10-10T00:00:00Z", section: "to_confirm" }),
  item({ quote_no: "Q-C", section: "proofs", snoozed_until: "2026-10-18T12:00:00Z" }),
  item({ quote_no: "Q-D", section: "needs_review", snoozed_until: "2026-10-14T12:00:00Z" }),
];

check("snoozed in the future", isSnoozed(items[2], now), true);
check("snooze in the past is over", isSnoozed(items[3], now), false);
check("hidden: snoozed", visibleItems(items, { now }).length, 3);
check("show snoozed", visibleItems(items, { now, showSnoozed: true }).length, 4);
check("oldest first", visibleItems(items, { now }).map((i) => i.quote_no).join(","), "Q-A,Q-B,Q-D");
check("mine", visibleItems(items, { now, mineUserId: 7 }).map((i) => i.quote_no).join(","), "Q-B");
const g = groupBySection(visibleItems(items, { now }));
check("grouped to_confirm", g.to_confirm.length, 2);
check("grouped proofs empty (snoozed)", g.proofs.length, 0);
check("counts total", sectionCounts(visibleItems(items, { now })).total, 3);
check("counts needs_review", sectionCounts(visibleItems(items, { now })).needs_review, 1);

check("proof changes -> attention", proofNeedsAttention({ status: "changes", sent_at: "2026-10-15T00:00:00Z" }, now), true);
check("proof waiting 2 days -> not yet", proofNeedsAttention({ status: "sent", sent_at: "2026-10-13T17:00:00Z" }, now), false);
check("proof waiting 3 days -> attention", proofNeedsAttention({ status: "sent", sent_at: "2026-10-12T16:00:00Z" }, now), true);
check("approved proof -> no", proofNeedsAttention({ status: "approved", sent_at: "2026-10-01T00:00:00Z" }, now), false);

check("waited minutes", waitedLabel("2026-10-15T15:30:00Z", now), "30 min");
check("waited hours", waitedLabel("2026-10-14T16:00:00Z", now), "24 h");
check("waited days", waitedLabel("2026-10-10T16:00:00Z", now), "5 days");

check("snooze tomorrow", snoozeUntil("tomorrow", now), "2026-10-16T16:00:00.000Z");
check("snooze 1 week", snoozeUntil("1w", now), "2026-10-22T16:00:00.000Z");
check("snooze to a date", snoozeUntil("2026-10-20", now), "2026-10-20T12:00:00.000Z");
check("snooze past date refused", snoozeUntil("2026-10-01", now), undefined);
check("snooze junk refused", snoozeUntil("soon", now), undefined);
check("clear snooze", snoozeUntil("clear", now), null);
check("null clears", snoozeUntil(null, now), null);

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nALL PASS");
