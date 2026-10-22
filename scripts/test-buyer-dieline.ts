// scripts/test-buyer-dieline.ts
//
// Step 39E: a buyer's own die line (lib/dieline-import.ts buyerDielineParts)
// and the boxes chat's die line path (app/lib/widget/boxes-chat.ts).
// Run: npm run test:buyer-dieline   (= npx --yes tsx scripts/test-buyer-dieline.ts)

import { BUYER_DIELINE_MAX_PARTS, buyerDielineParts, parseDielineBlank } from "../lib/dieline-import";
import { detectQuoteKind, extractBoxFacts, isBoxesReady, nextBoxQuestion } from "../app/lib/widget/boxes-chat";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

// ---- tiny DXF writer (inches): rectangles on layer CUT, one crease line each on CREASE
function dxf(rects: { x: number; y: number; w: number; h: number }[]): string {
  const o: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 1, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    o.push(0, "LINE", 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0);
  for (const r of rects) {
    line("CUT", r.x, r.y, r.x + r.w, r.y);
    line("CUT", r.x + r.w, r.y, r.x + r.w, r.y + r.h);
    line("CUT", r.x + r.w, r.y + r.h, r.x, r.y + r.h);
    line("CUT", r.x, r.y + r.h, r.x, r.y);
    line("CREASE", r.x, r.y + r.h / 2, r.x + r.w, r.y + r.h / 2);
  }
  o.push(0, "ENDSEC", 0, "EOF");
  return o.join("\n");
}

// 1. one outline = one part, flagged for staff to check
const one = buyerDielineParts(dxf([{ x: 0, y: 0, w: 20, h: 10 }]), "tray.dxf");
check("one outline: ok, not a display", one.ok && !one.display && one.parts.length === 1, one);
if (one.ok) {
  const p = one.parts[0];
  check("one outline: 20 x 10 blank, cut 60, crease 20", p.length_in === 20 && p.width_in === 10 && p.cut_in === 60 && p.crease_in === 20, p);
  check("one outline: check flag + filename, per display 1, no piece", p.check === true && p.filename === "tray.dxf" && p.per_display === 1 && p.piece == null, p);
}

// 2. several outlines = a display, with the buyer's names and counts
const two = buyerDielineParts(
  dxf([
    { x: 0, y: 0, w: 30, h: 40 },
    { x: 34, y: 0, w: 20, h: 10 },
  ]),
  "display.dxf",
  [
    { piece: 1, label: "  Back  ", per_display: 1 },
    { piece: 2, label: "Shelf", per_display: 4 },
  ],
);
check("two outlines: a display with 2 parts", two.ok && two.display && two.parts.length === 2, two);
if (two.ok) {
  const [a, b] = two.parts;
  check("part 1: Back, 30 x 40, x1", a.label === "Back" && a.length_in === 30 && a.width_in === 40 && a.per_display === 1 && a.piece === 1, a);
  check("part 2: Shelf, 20 x 10, x4", b.label === "Shelf" && b.length_in === 20 && b.per_display === 4 && b.piece === 2, b);
  check("every part flagged to check", two.parts.every((p) => p.check === true));
  check("split-aware warning (no tick-Split hint)", !two.warnings.some((w) => /tick "Split"/.test(w)), two.warnings);
}
const unnamed = buyerDielineParts(dxf([{ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 10, h: 10 }]), "x.dxf", [{ piece: 2, per_display: 0 }]);
check(
  "no names: Part 1 / Part 2; bad count -> 1",
  unnamed.ok && unnamed.parts[0].label === "Part 1" && unnamed.parts[1].label === "Part 2" && unnamed.parts[1].per_display === 1,
  unnamed,
);

// 3. too many parts / unreadable -> refused (the form offers the spec request page)
const many = buyerDielineParts(
  dxf(Array.from({ length: BUYER_DIELINE_MAX_PARTS + 1 }, (_, i) => ({ x: i * 12, y: 0, w: 10, h: 10 }))),
  "many.dxf",
);
check("13 parts: refused (too_many_parts)", !many.ok && many.error === "too_many_parts", many);
const empty = buyerDielineParts("", "empty.dxf");
check("empty file: refused", !empty.ok, empty);

// 4. the stored blank keeps the check flag (staff confirm clears it)
check("parseDielineBlank keeps check", parseDielineBlank({ length_in: 1, width_in: 1, cut_in: 4, crease_in: 0, perf_in: 0, rule_in: 4, check: true })?.check === true);
check("parseDielineBlank: no check when cleared", parseDielineBlank({ length_in: 1, width_in: 1, cut_in: 4, crease_in: 0, perf_in: 0, rule_in: 4 })?.check === undefined);

// 5. chat: die line words, display words
check("chat: a dxf for a display is boxes", detectQuoteKind("I have a dxf for a counter display") === "boxes");
check("chat: a foam insert dxf stays foam", detectQuoteKind("I have a dxf of my foam insert") === "foam");
check("chat: 'die line' sets dieline", extractBoxFacts("I have a die line file", {}).dieline === true);
check("chat: size question offers the die line button", nextBoxQuestion({}).quickReplies.includes("I have a die line file"));
const q1 = nextBoxQuestion({ dieline: true });
check("chat: die line -> asks how many (displays), not the size", /number of displays/.test(q1.assistantMessage) && !/inside size/.test(q1.assistantMessage), q1);
check("chat: die line + bare number = qty", extractBoxFacts("500", { dieline: true }).qty === "500");
check("chat: '250 displays' = qty", extractBoxFacts("250 displays", { dieline: true }).qty === "250");
const q2 = nextBoxQuestion({ dieline: true, qty: "500", boardGrade: "recommend" });
check("chat: die line skips the style question", !/RSC/.test(q2.assistantMessage), q2);
const q3 = nextBoxQuestion({
  dieline: true,
  qty: "500",
  boardGrade: "recommend",
  printed: true,
  printColorCount: "1",
  printColors: ["spot"],
  printSides: "1",
});
check("chat: die line skips the 4 panels question", /full name/.test(q3.assistantMessage), q3);
const ready = { dieline: true, qty: "500", boardGrade: "recommend", printed: false, customerName: "Pat Lee", customerEmail: "pat@example.com" };
check("chat: die line ready without a size or style", isBoxesReady(ready));
check("chat: die line done message says upload", /upload your die line/.test(nextBoxQuestion(ready).assistantMessage));
check("chat: without a die line the size is still needed", !isBoxesReady({ ...ready, dieline: null }));

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
