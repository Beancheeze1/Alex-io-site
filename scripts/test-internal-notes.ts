// scripts/test-internal-notes.ts
//
// Step 39V: adding a dated, signed line to a quote's internal notes
// (app/lib/internal-notes-core.ts).
// Run: npm run test:notes   (= npx --yes tsx scripts/test-internal-notes.ts)

import { appendNote, cleanNote, NOTE_MAX, NOTES_MAX, noteLine } from "../app/lib/internal-notes-core";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

check("clean: trims", cleanNote("  call Dan Monday  "), "call Dan Monday");
check("clean: empty / spaces / not text = null", [cleanNote(""), cleanNote("   "), cleanNote(5), cleanNote(null)], [null, null, null, null]);
check("clean: keeps line breaks, CRLF -> LF", cleanNote("a\r\nb"), "a\nb");
check("clean: capped", cleanNote("x".repeat(NOTE_MAX + 50))?.length, NOTE_MAX);

const at = new Date("2026-10-24T14:00:00Z");
check("line: date, name, text", noteLine("Sample cut OK", "Chuck Admin", at), "Oct 24, 2026 – Chuck Admin: Sample cut OK");
check("line: shop time zone decides the day", noteLine("x", "A", new Date("2026-10-25T02:00:00Z"), "America/Los_Angeles"), "Oct 24, 2026 – A: x");
check("line: bad time zone falls back to UTC", noteLine("x", "A", at, "Not/AZone"), "Oct 24, 2026 – A: x");
check("line: no name = Staff", noteLine("x", "  ", at), "Oct 24, 2026 – Staff: x");

check("append: first note", appendNote(null, "L1"), "L1");
check("append: under the existing notes", appendNote("From the rep form\n", "L2"), "From the rep form\nL2");
check("append: blank existing", appendNote("   ", "L1"), "L1");
const big = appendNote("a".repeat(NOTES_MAX), "NEW");
check("append: kept under the cap, newest kept", [big.length, big.endsWith("\nNEW")], [NOTES_MAX, true]);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
