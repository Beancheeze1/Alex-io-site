// scripts/test-grade.ts
//
// Step 37G: board grade from a buyer's words (lib/corrugated/grade-match.ts)
// and the boxes chat's plain-text extraction of it (app/lib/widget/boxes-chat.ts).
// Run: npm run test:grade   (= npx --yes tsx scripts/test-grade.ts)

import { matchGrade, parseGradeText, type GradeChoice } from "../lib/corrugated/grade-match";
import { extractBoxFacts, nextBoxQuestion, isBoxesReady, GRADE_RECOMMEND } from "../app/lib/widget/boxes-chat";
import { describePrintSpec, parsePrintSpec } from "../lib/corrugated-price";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// The live shop grades (Alex-IO Demo, Oct 16)
const G: GradeChoice[] = [
  { id: 1, name: "32 ECT E", flute: "E", ect_label: "32 ECT", is_default: false },
  { id: 2, name: "32 ECT C", flute: "C", ect_label: "32 ECT", is_default: true },
  { id: 3, name: "44 ECT C", flute: "C", ect_label: "44 ECT", is_default: false },
  { id: 4, name: "32 ECT B", flute: "B", ect_label: "32 ECT", is_default: false },
  { id: 5, name: "48 ECT BC", flute: "BC", ect_label: "48 ECT", is_default: false },
  { id: 6, name: "51 ECT BC", flute: "BC", ect_label: "51 ECT", is_default: false },
];

// ---- parseGradeText
check("parse: 32 ECT", parseGradeText("I need 2500 boxes, 18 x 12 x 10 inside, 32 ECT, printed")?.label, "32 ECT");
check("parse: 44ect no space", parseGradeText("44ect please")?.label, "44 ECT");
check("parse: 44 ECT C", parseGradeText("44 ECT C flute")?.label, "44 ECT C");
check("parse: 32 ECT B-flute", parseGradeText("32 ECT, B-flute")?.label, "32 ECT B");
check("parse: 48 ECT BC", parseGradeText("48 ECT BC")?.label, "48 ECT BC");
check("parse: 200#", parseGradeText("200# test")?.label, "200#");
check("parse: 275 lb", parseGradeText("275 lb double wall")?.label, "275# BC");
check("parse: double wall only", parseGradeText("needs to be double wall")?.label, "double wall");
check("parse: nothing", parseGradeText("2500 boxes 18x12x10"), null);
check("parse: qty not mullen", parseGradeText("2500 boxes"), null);
check("parse: 'box' isn't B flute", parseGradeText("32 ECT box")?.label, "32 ECT");
check("parse: empty", parseGradeText(""), null);

// ---- matchGrade
check("match: 32 ECT -> default C", matchGrade("32 ECT", G), 2);
check("match: 32 ECT B", matchGrade("32 ECT B flute", G), 4);
check("match: 32 ECT E", matchGrade("32ECT E-flute", G), 1);
check("match: 44 ECT", matchGrade("44 ECT", G), 3);
check("match: 48 ECT BC", matchGrade("48 ECT BC", G), 5);
check("match: 44 ECT BC not offered", matchGrade("44 ECT BC", G), null);
check("match: 61 ECT not offered", matchGrade("61 ECT", G), null);
check("match: 200# (no mullen grades)", matchGrade("200#", G), null);
check("match: double wall -> lightest BC", matchGrade("double wall", G), 5);
check("match: no grades", matchGrade("32 ECT", []), null);
check("match: default not C", matchGrade("32 ECT", G.map((g) => ({ ...g, is_default: g.id === 4 }))), 4);
check("match: no default -> C", matchGrade("32 ECT", G.map((g) => ({ ...g, is_default: false }))), 2);

// ---- boxes chat extraction
{
  const f = extractBoxFacts("I need 2500 shipping boxes, 18 x 12 x 10 inside, 32 ECT, printed 1 color black on two sides", {});
  check("chat: grade", f.boardGrade, "32 ECT");
  check("chat: qty still 2500", f.qty, "2500");
  check("chat: size", `${f.boxL}x${f.boxW}x${f.boxD}`, "18x12x10");
  check("chat: rsc", f.boxStyle, "rsc");
  // Step 37N: "two sides" of a box = two panels, not inside + outside
  check("chat: two sides = 2 panels", f.printPanels, "2");
  check("chat: two sides doesn't set inside/outside", f.printSides, undefined);
  check("chat: no grade said", extractBoxFacts("500 mailers 10x8x4", {}).boardGrade, undefined);
}

// ---- Step 37N: board grade asked; outside / inside; panels
{
  const base = { boxL: "18", boxW: "12", boxD: "10", boxStyle: "rsc" as const, qty: "2500" };
  check("37N: asks grade after qty", /board grade/.test(nextBoxQuestion(base).assistantMessage), true);
  check("37N: grade quick replies", nextBoxQuestion(base).quickReplies.join("|"), "32 ECT|44 ECT|Double wall|Not sure");
  check("37N: 'Not sure' -> recommend", extractBoxFacts("Not sure", base).boardGrade, GRADE_RECOMMEND);
  check("37N: '44 ECT' answer", extractBoxFacts("44 ECT", base).boardGrade, "44 ECT");
  check("37N: 'not sure' ignored when not asking grade", extractBoxFacts("not sure", { ...base, boardGrade: "32 ECT" }).boardGrade, undefined);
  const g = { ...base, boardGrade: "32 ECT", printed: true, printColorCount: "1" as const, printColors: ["spot" as const] };
  check("37N: asks outside / inside", nextBoxQuestion(g).assistantMessage, "Printed on the outside of the box only, or outside and inside?");
  check("37N: 'Outside only'", extractBoxFacts("Outside only", g).printSides, "1");
  check("37N: 'Outside + inside'", extractBoxFacts("Outside + inside", g).printSides, "2");
  check("37N: 'printed on the outside'", extractBoxFacts("printed on the outside", base).printSides, "1");
  check("37N: dims 'inside' isn't print", extractBoxFacts("2500 boxes 18x12x10 inside, printed 1 color", {}).printSides, undefined);
  check("37N: 'outside dimensions' isn't print", extractBoxFacts("outside dimensions 12x10x8", {}).printSides, undefined);
  const h = { ...g, printSides: "1" as const };
  check("37N: asks panels", /4 side panels/.test(nextBoxQuestion(h).assistantMessage), true);
  check("37N: 'All 4 panels'", extractBoxFacts("All 4 panels", h).printPanels, "4");
  check("37N: 'front and back'", extractBoxFacts("front and back", h).printPanels, "2");
  check("37N: '3 panels'", extractBoxFacts("3 panels", h).printPanels, "3");
  check("37N: '1 panel'", extractBoxFacts("1 panel", h).printPanels, "1");
  check("37N: not ready without panels", isBoxesReady({ ...h, customerName: "Pat", customerEmail: "p@x.com" }), false);
  check("37N: ready with panels", isBoxesReady({ ...h, printPanels: "2", customerName: "Pat", customerEmail: "p@x.com" }), true);
  check("37N: not ready without grade", isBoxesReady({ ...h, printPanels: "2", boardGrade: null, customerName: "Pat", customerEmail: "p@x.com" }), false);
  check("37N: plain box skips print questions", /full name/.test(nextBoxQuestion({ ...base, boardGrade: "recommend", printed: false }).assistantMessage), true);
}

// ---- Step 37N: print wording and panels in the print spec
check("37N: outside", describePrintSpec({ colors: ["spot"], sides: 1 }), "1-color print (1 spot), outside");
check("37N: outside + inside, 2 panels", describePrintSpec({ colors: ["spot"], sides: 2, panels: 2 }), "1-color print (1 spot), outside + inside, 2 panels");
check("37N: all 4 panels", describePrintSpec({ colors: ["flood"], sides: 1, panels: 4 }), "1-color print (1 flood), outside, all 4 panels");
check("37N: panels kept", parsePrintSpec({ colors: ["spot"], sides: 1, panels: 3 })?.panels, 3);
check("37N: bad panels dropped", parsePrintSpec({ colors: ["spot"], sides: 1, panels: 7 })?.panels, undefined);
check("37N: no panels when unprinted", parsePrintSpec({ colors: [], sides: 1, panels: 2 })?.panels, undefined);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
