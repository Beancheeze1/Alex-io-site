// scripts/test-cleanup.ts
//
// Step 36B: tests for the test-quote cleanup rules (app/lib/test-cleanup-core.ts).
// Run: npm run test:cleanup   (= npx --yes tsx scripts/test-cleanup.ts)

import {
  MAX_QUOTES,
  confirmPhrase,
  groupColumns,
  isDeletableTable,
  isProtectedTable,
  isSkippedTable,
  parseQuoteNos,
  phraseMatches,
  totalByTable,
} from "../app/lib/test-cleanup-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ---- parsing
{
  const p = parseQuoteNos("Q-A-261015-21477, q-r-261016-91927\nQ-A-261015-21477;  Q-AI-20251228-192748\tQ-REP-1-2");
  check("parse: count (dedup, case)", p.quoteNos.length, 4);
  check("parse: upper-cased", p.quoteNos[1], "Q-R-261016-91927");
  check("parse: keeps order", p.quoteNos[0], "Q-A-261015-21477");
  check("parse: AI number", p.quoteNos.includes("Q-AI-20251228-192748"), true);
  check("parse: no invalid", p.invalid.length, 0);
  check("parse: not too many", p.tooMany, false);
}
{
  const p = parseQuoteNos("hello Q-A-1 12345 Q-A-1; DROP");
  check("parse: invalid listed", p.invalid.join(","), "HELLO,12345,DROP");
  check("parse: valid kept", p.quoteNos.join(","), "Q-A-1");
}
{
  check("parse: empty", parseQuoteNos("").quoteNos.length, 0);
  check("parse: non-string", parseQuoteNos(42).quoteNos.length, 0);
  check("parse: array input", parseQuoteNos(["Q-A-1", "Q-A-2"]).quoteNos.length, 2);
  check("parse: quote mark rejected", parseQuoteNos("Q-A-1'--").invalid.length, 1);
  check("parse: too long rejected", parseQuoteNos("Q-A-" + "1".repeat(70)).invalid.length, 1);
  const many = Array.from({ length: MAX_QUOTES + 5 }, (_, i) => `Q-A-${i}`).join(" ");
  const p = parseQuoteNos(many);
  check("parse: too many flagged", p.tooMany, true);
  check("parse: capped", p.quoteNos.length, MAX_QUOTES);
}

// ---- tables
check("table: quote_items deletable", isDeletableTable("quote_items"), true);
check("table: quote_facts deletable", isDeletableTable("quote_facts"), true);
check("table: admin_alerts deletable", isDeletableTable("admin_alerts"), true);
check("table: page_events deletable", isDeletableTable("page_events"), true);
check("table: customers kept", isDeletableTable("customers"), false);
check("table: spec_requests kept", isDeletableTable("spec_requests"), false);
check("table: quotes skipped", isSkippedTable("quotes"), true);
check("table: quotes not deletable here", isDeletableTable("quotes"), false);
check("table: expense_payouts protected", isProtectedTable("expense_payouts"), true);
check("table: commissions protected", isProtectedTable("sales_commissions"), true);
check("table: quote_payments protected", isProtectedTable("quote_payments"), true);
check("table: protected never deletable", isDeletableTable("quote_payments"), false);
check("table: quote_items not protected", isProtectedTable("quote_items"), false);

// ---- confirm
check("confirm: plural", confirmPhrase(3), "DELETE 3 QUOTES");
check("confirm: singular", confirmPhrase(1), "DELETE 1 QUOTE");
check("confirm: match case-insensitive", phraseMatches(" delete 3 quotes ", 3), true);
check("confirm: wrong count", phraseMatches("DELETE 2 QUOTES", 3), false);
check("confirm: missing", phraseMatches(undefined, 3), false);

// ---- columns grouped per table (Step 36C: rows counted once)
{
  const g = groupColumns([
    { table: "quote_box_selections", column: "quote_no" },
    { table: "quote_box_selections", column: "quote_id" },
    { table: "quote_items", column: "quote_id" },
    { table: "quote_items", column: "quote_id" },
  ]);
  check("group: two tables", g.length, 2);
  check("group: both columns", g.find((x) => x.table === "quote_box_selections")?.columns.join(","), "quote_id,quote_no");
  check("group: no duplicate column", g.find((x) => x.table === "quote_items")?.columns.length, 1);
}

// ---- totals
{
  const t = totalByTable([
    { table: "quote_emails", columns: ["quote_id"], rows: 2 },
    { table: "quote_items", columns: ["quote_id"], rows: 5 },
    { table: "quote_emails", columns: ["quote_no"], rows: 1 },
  ]);
  check("totals: merged tables", t.length, 2);
  check("totals: biggest first", t[0].table, "quote_items");
  check("totals: summed", t[1].rows, 3);
  check("totals: empty", totalByTable([]).length, 0);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
