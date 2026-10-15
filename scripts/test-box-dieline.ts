// scripts/test-box-dieline.ts
//
// Step 33: tests for the RSC / HSC / FOL flat blank die lines (lib/box-dieline.ts).
// Run: npm run test:dieline   (= npx --yes tsx scripts/test-box-dieline.ts)

import { DEFAULT_FLUTES, DEFAULT_LAYOUT, computeStyleBlank, type LayoutSettings } from "../lib/corrugated-blank";
import { dielineDxf, dielineFilename, isSlottedStyle, slotWidthIn, slottedDieline, type Seg } from "../lib/box-dieline";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  if (got === want) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const flute = (f: string) => DEFAULT_FLUTES.find((x) => x.flute === f)!;
const C = flute("C");
const layout: LayoutSettings = { ...DEFAULT_LAYOUT, waste_pct: 0 };
const dims = { L: 12, W: 10, D: 8 };

/** Every vertex of a closed outline is used by an even number of segment ends. */
function closed(segs: Seg[]): boolean {
  const m = new Map<string, number>();
  for (const s of segs) {
    for (const k of [`${s.x1},${s.y1}`, `${s.x2},${s.y2}`]) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.values()].every((n) => n % 2 === 0);
}
function extent(segs: Seg[]) {
  const xs = segs.flatMap((s) => [s.x1, s.x2]);
  const ys = segs.flatMap((s) => [s.y1, s.y2]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

// slot widths
check("slot E 1/8", slotWidthIn(0.0625), 0.125);
check("slot B 3/16", slotWidthIn(0.125), 0.1875);
check("slot C 1/4", slotWidthIn(0.1875), 0.25);
check("slot BC 3/8", slotWidthIn(0.3125), 0.375);
check("slot none -> 1/8", slotWidthIn(0), 0.125);

// RSC, C flute, glued
const rsc = slottedDieline("rsc", dims, C, layout)!;
const rscBlank = computeStyleBlank("rsc", dims, C, layout);
check("rsc made", !!rsc, true);
check("rsc panels", rsc.panels_in.join(","), "12.1875,10.1875,12.1875,10.1875");
check("rsc joint", rsc.joint_in, 1.375);
check("rsc body", rsc.body_in, 8.1875);
check("rsc flap", rsc.flap_in, 5.09375);
check("rsc drawn length = priced raw length", near(rsc.drawn.length_in, rscBlank.raw_length_in), true);
check("rsc drawn width = priced raw width", near(rsc.drawn.width_in, rscBlank.raw_width_in), true);
check("rsc drawn 46.125 x 18.375", `${rsc.drawn.length_in} x ${rsc.drawn.width_in}`, "46.125 x 18.375");
check("rsc blank = priced blank", `${rsc.blank.length_in}x${rsc.blank.width_in}`, `${rscBlank.length_in}x${rscBlank.width_in}`);
check("rsc outline closed", closed(rsc.cut), true);
const e = extent(rsc.cut);
check("rsc outline from 0,0", `${e.minX},${e.minY}`, "0,0");
check("rsc outline to drawn size", `${e.maxX},${e.maxY}`, "46.125,18.375");
check("rsc scores: 8 flap + 4 panel", rsc.score.length, 12);
check("rsc cut segments", rsc.cut.length, 38);
check("rsc rule cut > perimeter", rsc.rule.cut_in > 2 * (46.125 + 18.375), true);
check("rsc rule score", rsc.rule.score_in, Math.round((2 * (44.75 - 4 * 0.25) + 4 * 8.1875) * 100) / 100);
// slots are 1/4 wide and reach the flap scores
const slotSides = rsc.cut.filter((s) => s.x1 === s.x2 && ((s.y1 === 0 && s.y2 === 5.09375) || (s.y2 === 0 && s.y1 === 5.09375)));
check("rsc bottom slot sides + flap ends", slotSides.length, 8);
check("rsc first slot centered on score", slotSides.some((s) => near(s.x1, 1.375 + 12.1875 - 0.125)), true);

// HSC
const hsc = slottedDieline("hsc", dims, C, layout)!;
const hscBlank = computeStyleBlank("hsc", dims, C, layout);
check("hsc drawn width = priced raw width", near(hsc.drawn.width_in, hscBlank.raw_width_in), true);
check("hsc drawn width", hsc.drawn.width_in, 13.28125);
check("hsc outline closed", closed(hsc.cut), true);
check("hsc scores: 4 flap + 4 panel", hsc.score.length, 8);
check("hsc top edge straight", hsc.cut.some((s) => s.y1 === 13.28125 && s.y2 === 13.28125 && near(Math.abs(s.x2 - s.x1), 44.75)), true);

// FOL
const fol = slottedDieline("fol", dims, C, layout)!;
const folBlank = computeStyleBlank("fol", dims, C, layout);
check("fol flap = W + f", fol.flap_in, 10.09375);
check("fol drawn width = priced raw width", near(fol.drawn.width_in, folBlank.raw_width_in), true);
check("fol outline closed", closed(fol.cut), true);

// taped joint: no tab, starts at x = 0
const taped = slottedDieline("rsc", dims, C, { ...layout, joint_type: "taped" })!;
check("taped joint 0", taped.joint_in, 0);
check("taped length 44.75", taped.drawn.length_in, 44.75);
check("taped scores: 8 flap + 3 panel", taped.score.length, 11);
check("taped outline closed", closed(taped.cut), true);
check("taped = priced raw length", near(taped.drawn.length_in, computeStyleBlank("rsc", dims, C, { ...layout, joint_type: "taped" }).raw_length_in), true);

// last panel adjustment, flap %, trim and rounding
const adj = slottedDieline("rsc", dims, { ...C, last_panel_adj_in: -0.0625 }, layout)!;
check("last panel adj on panel 4", adj.panels_in[3], 10.125);
const flap60 = slottedDieline("rsc", dims, C, { ...layout, flap_pct: 60 })!;
check("flap 60%", flap60.flap_in, 6.09375);
const trimmed = slottedDieline("rsc", dims, C, { ...layout, edge_trim_in: 0.5, round_to_in: 0.25 })!;
check("trim not drawn", trimmed.drawn.length_in, 46.125);
check("ordered blank: trim + round", `${trimmed.blank.length_in} x ${trimmed.blank.width_in}`, "46.75 x 19");

// other flutes match pricing
for (const fl of DEFAULT_FLUTES) {
  for (const st of ["rsc", "hsc", "fol"] as const) {
    const dl = slottedDieline(st, { L: 18.5, W: 6.25, D: 4 }, fl, layout)!;
    const b = computeStyleBlank(st, { L: 18.5, W: 6.25, D: 4 }, fl, layout);
    check(`${st} ${fl.flute} matches pricing`, near(dl.drawn.length_in, b.raw_length_in) && near(dl.drawn.width_in, b.raw_width_in) && closed(dl.cut), true);
  }
}

// bad input
check("zero depth -> null", slottedDieline("rsc", { L: 12, W: 10, D: 0 }, C, layout), null);
check("NaN -> null", slottedDieline("rsc", { L: NaN, W: 10, D: 8 }, C, layout), null);
check("tiny panel -> null", slottedDieline("rsc", { L: 0.1, W: 0.1, D: 2 }, flute("E"), layout), null);
check("isSlottedStyle rsc", isSlottedStyle("rsc"), true);
check("isSlottedStyle mailer", isSlottedStyle("mailer"), false);

// DXF
const dxf = dielineDxf(rsc, ["Q-1 line 1"]);
check("dxf R12", dxf.includes("AC1009"), true);
check("dxf inches", dxf.includes("$INSUNITS\n70\n1"), true);
check("dxf CUT layer", dxf.includes("\n2\nCUT\n"), true);
check("dxf CREASE layer", dxf.includes("\n2\nCREASE\n"), true);
check("dxf lines = cut + score", (dxf.match(/\n0\nLINE\n/g) || []).length, rsc.cut.length + rsc.score.length);
check("dxf crease lines on CREASE", (dxf.match(/\nLINE\n8\nCREASE\n/g) || []).length, rsc.score.length);
check("dxf note text", dxf.includes("Q-1 line 1"), true);
check("dxf callout", dxf.includes(`RSC 12" x 10" x 8" inside, C flute`), true);
check("dxf ascii only", /^[\x09\x0A\x0D\x20-\x7E]*$/.test(dxf), true);
check("dxf ends EOF", dxf.trimEnd().endsWith("EOF"), true);
check("dxf strips non-ascii", dielineDxf(rsc, ["12×10 – ok"]).includes("12x10  ok"), true);
check("filename", dielineFilename("Q-A-261015-28461", 2, rsc), "Q-A-261015-28461__Line-2__RSC-12x10x8.dxf");
check("filename decimals", dielineFilename("Q 1", 1, { style: "hsc", inside: { L: 12.5, W: 10.25, D: 8 } }), "Q-1__Line-1__HSC-12.5x10.25x8.dxf");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
if (failed) process.exit(1);
