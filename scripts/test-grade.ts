// scripts/test-grade.ts
//
// Step 37G: board grade from a buyer's words (lib/corrugated/grade-match.ts)
// and the boxes chat's plain-text extraction of it (app/lib/widget/boxes-chat.ts).
// Run: npm run test:grade   (= npx --yes tsx scripts/test-grade.ts)

import { matchGrade, parseGradeText, type GradeChoice } from "../lib/corrugated/grade-match";
import { extractBoxFacts } from "../app/lib/widget/boxes-chat";

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
  check("chat: two sides", f.printSides, "2");
  check("chat: no grade said", extractBoxFacts("500 mailers 10x8x4", {}).boardGrade, undefined);
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
