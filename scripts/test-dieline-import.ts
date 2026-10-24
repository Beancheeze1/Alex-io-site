// scripts/test-dieline-import.ts
//
// Step 39C: tests for reading a corrugated die line (lib/dieline-import.ts)
// and pricing it as a die-cut box from the file (style "dieline").
// Run: npm run test:dieline-import   (= npx --yes tsx scripts/test-dieline-import.ts)

import { readFileSync } from "fs";
import {
  analyzeDieline,
  autoRole,
  buyerDielineParts,
  cleanDielineAs,
  cleanDielineRoles,
  cleanDielineUnits,
  dielinePartDxf,
  dielinePartFilename,
  dielineLinesSvg,
  dielinePartLines,
  dielineSizeSuspect,
  parseDielineBlank,
  splitDieline,
} from "../lib/dieline-import";
import { dielineDxf, slottedDieline } from "../lib/box-dieline";
import { DEFAULT_FLUTES, dielineStyleBlank } from "../lib/corrugated-blank";
import { priceRscBox, type BoxSettings } from "../lib/corrugated-price";
import { boxStyleInfo, parseBoxStyle } from "../lib/box-styles";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}
const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol;

// ---- tiny DXF writer: LINE entities with layer / linetype / color, optional tables
type L = { x1: number; y1: number; x2: number; y2: number; layer?: string; ltype?: string; color?: number };
function dxf(lines: L[], opts: { insunits?: number; layers?: { name: string; color: number; ltype?: string }[]; ltypes?: { name: string; dashes: number[] }[] } = {}): string {
  const o: (string | number)[] = [];
  o.push(0, "SECTION", 2, "HEADER");
  if (opts.insunits != null) o.push(9, "$INSUNITS", 70, opts.insunits);
  o.push(0, "ENDSEC");
  if (opts.layers || opts.ltypes) {
    o.push(0, "SECTION", 2, "TABLES");
    if (opts.ltypes) {
      o.push(0, "TABLE", 2, "LTYPE");
      for (const t of opts.ltypes) {
        o.push(0, "LTYPE", 2, t.name, 70, 0, 3, t.name, 72, 65, 73, t.dashes.length, 40, t.dashes.reduce((a, b) => a + Math.abs(b), 0));
        for (const d of t.dashes) o.push(49, d);
      }
      o.push(0, "ENDTAB");
    }
    if (opts.layers) {
      o.push(0, "TABLE", 2, "LAYER");
      for (const l of opts.layers) o.push(0, "LAYER", 2, l.name, 70, 0, 62, l.color, 6, l.ltype ?? "CONTINUOUS");
      o.push(0, "ENDTAB");
    }
    o.push(0, "ENDSEC");
  }
  o.push(0, "SECTION", 2, "ENTITIES");
  for (const l of lines) {
    o.push(0, "LINE", 8, l.layer ?? "0");
    if (l.ltype) o.push(6, l.ltype);
    if (l.color != null) o.push(62, l.color);
    o.push(10, l.x1, 20, l.y1, 30, 0, 11, l.x2, 21, l.y2, 31, 0);
  }
  o.push(0, "ENDSEC", 0, "EOF");
  return o.join("\n");
}
const rect = (x: number, y: number, w: number, h: number, extra: Partial<L> = {}): L[] => [
  { x1: x, y1: y, x2: x + w, y2: y, ...extra },
  { x1: x + w, y1: y, x2: x + w, y2: y + h, ...extra },
  { x1: x + w, y1: y + h, x2: x, y2: y + h, ...extra },
  { x1: x, y1: y + h, x2: x, y2: y, ...extra },
];

// 1. auto roles
check("layer CREASE = crease", autoRole({ layer: "CREASE", dashed: false, color: 7 }).role === "crease");
check("layer SCORE = crease", autoRole({ layer: "Score lines", dashed: false, color: 7 }).role === "crease");
check("layer PERF = perf", autoRole({ layer: "PERF", dashed: false, color: 7 }).role === "perf");
check("layer CUT = cut", autoRole({ layer: "CUT", dashed: true, color: 1 }).role === "cut");
check("layer DIM = ignore", autoRole({ layer: "DIM", dashed: false, color: 7 }).role === "ignore");
check("layer 0 dashed = crease", autoRole({ layer: "0", dashed: true, color: 7 }).role === "crease");
check("layer 0 red = crease", autoRole({ layer: "0", dashed: false, color: 1 }).role === "crease");
check("layer 0 solid white = cut", autoRole({ layer: "0", dashed: false, color: 7 }).role === "cut");

// 2. round trip: our own RSC die line export (CUT + CREASE layers)
const C = DEFAULT_FLUTES.find((f) => f.flute === "C")!;
const layout = { joint_type: "glued" as const, flap_pct: 50, round_to_in: 0.0625, edge_trim_in: 0 };
const rsc = slottedDieline("rsc", { L: 12, W: 10, D: 8 }, C, layout)!;
const a1 = analyzeDieline(dielineDxf(rsc, ["test"]));
if (!a1.ok) check("RSC export reads", false, a1);
else {
  check("RSC export: 2 groups (CUT, CREASE)", a1.groups.length === 2 && a1.groups.some((g) => g.layer === "CUT" && g.role === "cut") && a1.groups.some((g) => g.layer === "CREASE" && g.role === "crease"), a1.groups);
  check("RSC export: cut inches match the exporter", near(a1.measure.cut_in, rsc.rule.cut_in), { got: a1.measure.cut_in, want: rsc.rule.cut_in });
  check("RSC export: crease inches match the exporter", near(a1.measure.crease_in, rsc.rule.score_in), { got: a1.measure.crease_in, want: rsc.rule.score_in });
  check("RSC export: blank = drawn size", near(a1.measure.length_in, rsc.drawn.length_in, 0.01) && near(a1.measure.width_in, rsc.drawn.width_in, 0.01), { got: a1.measure, want: rsc.drawn });
  check("RSC export: rule = cut + crease", near(a1.measure.rule_in, a1.measure.cut_in + a1.measure.crease_in, 0.11));
  check("RSC export: inches, no unit warning", a1.units === "in" && !a1.warnings.some((w) => w.includes("millimeters")), a1.warnings);
}

// 3. dashed linetype from the LTYPE table, red lines, ignored dimension layer
const t3 = dxf(
  [
    ...rect(0, 0, 20, 10), // outline, layer 0, solid
    { x1: 5, y1: 0, x2: 5, y2: 10, ltype: "DASHED" }, // 10 in crease (dashed)
    { x1: 15, y1: 0, x2: 15, y2: 10, color: 1 }, // 10 in crease (red)
    { x1: 0, y1: -2, x2: 20, y2: -2, layer: "DIMENSIONS" }, // ignored, outside the blank
  ],
  { insunits: 1, ltypes: [{ name: "DASHED", dashes: [0.5, -0.25] }], layers: [{ name: "DIMENSIONS", color: 3 }] },
);
const a3 = analyzeDieline(t3);
if (!a3.ok) check("mixed file reads", false, a3);
else {
  check("dashed + red = 20 in crease", a3.measure.crease_in === 20, a3.measure);
  check("outline = 60 in cut", a3.measure.cut_in === 60, a3.measure);
  check("dimension layer ignored: blank 20 x 10", a3.measure.length_in === 20 && a3.measure.width_in === 10, a3.measure);
  check("one piece", a3.measure.pieces === 1, a3.measure);
  check("ignored layers named in warnings", a3.warnings.some((w) => w.includes("DIMENSIONS")), a3.warnings);
}

// 4. staff override: mark the red group as perf
if (a3.ok) {
  const red = a3.groups.find((g) => g.color === 1)!;
  const a4 = analyzeDieline(t3, { roles: { [red.key]: "perf" } });
  check("override red -> perf", a4.ok && a4.measure.perf_in === 10 && a4.measure.crease_in === 10 && a4.measure.rule_in === 80, a4.ok ? a4.measure : a4);
  const all = Object.fromEntries(a3.groups.map((g) => [g.key, "ignore"]));
  const a5 = analyzeDieline(t3, { roles: all });
  check("all ignored -> no_rule", !a5.ok && a5.error === "no_rule", a5);
}

// 5. units: a unitless file is read as inches (Step 39P: no mm guess); pick mm to read it as mm
const t5 = dxf(rect(0, 0, 508, 254));
const a6 = analyzeDieline(t5);
check("unitless 508 x 254 read as inches (no mm guess)", a6.ok && a6.measure.length_in === 508 && a6.units === "in" && !a6.units_set && /doesn't say/.test(a6.units_label), a6.ok ? a6 : a6);
check("unitless huge blank warns to check the units", a6.ok && a6.warnings.some((w) => w.includes("Check the units")), a6.ok ? a6.warnings : a6);
const a6mm = analyzeDieline(t5, { units: "mm" });
check("picked mm: 508 x 254 = 20 x 10 in", a6mm.ok && near(a6mm.measure.length_in, 20, 0.01) && near(a6mm.measure.width_in, 10, 0.01) && a6mm.units === "mm", a6mm.ok ? a6mm.measure : a6mm);
const a7 = analyzeDieline(t5, { units: "in" });
check("forced inches keeps 508 x 254 and warns it's big", a7.ok && a7.measure.length_in === 508 && a7.warnings.some((w) => w.includes("Check the units")), a7.ok ? a7 : a7);
const a8 = analyzeDieline(dxf(rect(0, 0, 508, 254), { insunits: 4 }));
check("file says mm: 20 x 10 in, no guess warning", a8.ok && near(a8.measure.length_in, 20, 0.01) && !a8.warnings.some((w) => w.includes("guessed")), a8.ok ? a8 : a8);

// 6. two parts in one file
const a9 = analyzeDieline(dxf([...rect(0, 0, 10, 10), ...rect(12, 0, 10, 10)], { insunits: 1 }));
check("two outlines = 2 pieces, warned", a9.ok && a9.measure.pieces === 2 && a9.warnings.some((w) => w.includes("2 separate pieces")), a9.ok ? a9.measure : a9);

// 7. bad input
check("empty text -> no_lines", (() => { const r = analyzeDieline(""); return !r.ok && r.error === "no_lines"; })());

// 8. stored blank
const sb = parseDielineBlank({ length_in: 20, width_in: 10, cut_in: 60, crease_in: 20, perf_in: 0, rule_in: 80, filename: "x.dxf" });
check("parseDielineBlank keeps the numbers", !!sb && sb.rule_in === 80 && sb.filename === "x.dxf", sb);
check("parseDielineBlank refuses junk", parseDielineBlank({ length_in: 0 }) === null && parseDielineBlank("x") === null);

// 9. pricing a die line from a file (style "dieline")
check("style dieline parses and is die-cut, no depth", parseBoxStyle("dieline") === "dieline" && boxStyleInfo("dieline").kind === "diecut" && !boxStyleInfo("dieline").usesDepth);
const blank = dielineStyleBlank({ length_in: 20, width_in: 10, cut_in: 60, crease_in: 20, perf_in: 0, rule_in: 80 }, { round_to_in: 0.0625, edge_trim_in: 0.25, waste_pct: 10 });
check("dieline blank: + trim, sq ft, rule 80, CAD path 80", blank.length_in === 20.25 && blank.width_in === 10.25 && near(blank.sqft_each, (20.25 * 10.25) / 144, 0.0001) && blank.rule_in === 80 && blank.cad_path_in === 80, blank);

const settings: BoxSettings = {
  waste_pct: 10, order_setup_usd: 50, converting_per_m: 100, plate_spot_usd: 150, plate_flood_usd: 300,
  print_setup_per_color_usd: 25, print_run_spot_per_m: 20, print_run_flood_per_m: 40, markup_pct: 30, min_order_usd: 0,
  digital_under_qty: 50, cad_setup_usd: 40, cad_cut_per_hr_usd: 60, cad_speed_in_per_min: 600, digital_setup_usd: 25, digital_per_sqft_usd: 0.5,
  sheet_trim_in: 0, sheet_round_to_in: 0, sheet_max_length_in: 0, sheet_max_width_in: 0, sheet_max_up: 1, sheet_min_msf: 0,
  diecut_per_m: 120, die_base_usd: 150, die_per_in_usd: 0.5, pad_per_m: 0, partition_per_m: 0,
  joint_type: "glued", flap_pct: 50, round_to_in: 0.0625, edge_trim_in: 0, board_method: "blank",
} as BoxSettings;
const dl = { length_in: 20, width_in: 10, cut_in: 60, crease_in: 20, perf_in: 0, rule_in: 80 };
const p1 = priceRscBox({
  dims: { L: 20, W: 10, D: 0 }, quantities: [25, 1000], print: { colors: [], sides: 1 },
  grade: { name: "32 ECT C", cost_per_msf: 100 }, flute: C, settings, style: "dieline", dieline: dl,
});
if (!p1.ok) check("dieline prices", false, p1);
else {
  const [q25, q1000] = p1.quantities;
  // die = (150 + 80 x 0.50) x 1.30 = 247
  check("dieline: die from the file's rule = $247 (press runs)", p1.die_line_usd === 247 && q1000.die_line_usd === 247, { die: p1.die_line_usd });
  check("dieline: die-cut converting $120 per 1,000", q1000.converting_usd === 120, q1000);
  // board = 20 x 10 / 144 x 1.1 x 1000 / 1000 x 100 = 152.78
  check("dieline: board from the file's blank $152.78 at 1,000", near(q1000.board_usd, 152.78, 0.01), q1000);
  // short run: 25 x 80 in / 600 / 60 x $60 = $3.33, no die
  check("dieline short run: CAD time from the file's rule, no die", q25.method === "digital" && q25.converting_usd === 3.33 && q25.die_line_usd === 0, q25);
}
const p2 = priceRscBox({
  dims: { L: 20, W: 10, D: 0 }, quantities: [100], print: { colors: [], sides: 1 },
  grade: { name: "32 ECT C", cost_per_msf: 100 }, flute: C, settings, style: "dieline",
});
check("dieline without the measured blank is refused", !p2.ok && p2.error === "dieline_missing", p2);

// nesting by sheet: 20.25 x 10.25 blanks on a 60 x 40 sheet, up to 6 up = 2 x 3 = 6 up
const p3 = priceRscBox({
  dims: { L: 20, W: 10, D: 0 }, quantities: [600], print: { colors: [], sides: 1 },
  grade: { name: "32 ECT C", cost_per_msf: 100 }, flute: C,
  settings: { ...settings, board_method: "sheet", sheet_max_length_in: 60, sheet_max_width_in: 40, sheet_max_up: 6, sheet_trim_in: 0.5, sheet_round_to_in: 0.25, edge_trim_in: 0.25 } as BoxSettings,
  style: "dieline", dieline: dl,
});
check("dieline nests by sheet (6 up)", p3.ok && p3.sheet !== null && p3.sheet.up === 6, p3.ok ? p3.sheet : p3);

// 10. Step 39D: split a multi-part file (display parts side by side)
{
  // a 30 x 20 base with a 30" crease (red) across it, and a 10 x 8 shelf with a 10" crease, 5" apart
  const lines = [
    ...rect(0, 0, 30, 20),
    { x1: 0, y1: 10, x2: 30, y2: 10, color: 1 },
    ...rect(35, 0, 10, 8),
    { x1: 35, y1: 4, x2: 45, y2: 4, color: 1 },
  ];
  const sp = splitDieline(dxf(lines, { insunits: 1 }));
  check("split: 2 parts", sp.ok && sp.pieces.length === 2, sp);
  if (sp.ok) {
    const [p1, p2] = sp.pieces;
    check("split: part 1 = 30 x 20, cut 100, crease 30", p1.length_in === 30 && p1.width_in === 20 && p1.cut_in === 100 && p1.crease_in === 30, p1);
    check("split: part 2 = 10 x 8, cut 36, crease 10", p2.length_in === 10 && p2.width_in === 8 && p2.cut_in === 36 && p2.crease_in === 10, p2);
    check("split: no stray lines", sp.stray_in === 0, sp.stray_in);
    const whole = analyzeDieline(dxf(lines, { insunits: 1 }));
    check("split: parts' blanks are smaller than the one big rectangle", whole.ok && whole.measure.sqft > p1.sqft + p2.sqft, whole.ok ? whole.measure : whole);
  }
  check("split a one-part file -> one_piece", (() => { const r = splitDieline(dxf(rect(0, 0, 10, 10), { insunits: 1 })); return !r.ok && r.error === "one_piece"; })());
  const pb = parseDielineBlank({ length_in: 10, width_in: 8, cut_in: 36, crease_in: 10, perf_in: 0, rule_in: 46, per_display: 4, piece: 2, label: "Shelf" });
  check("stored part keeps per display 4, piece 2, label", !!pb && pb.per_display === 4 && pb.piece === 2 && pb.label === "Shelf", pb);
  check("stored part defaults per display to 1", parseDielineBlank({ length_in: 1, width_in: 1, cut_in: 4, crease_in: 0, perf_in: 0, rule_in: 4 })?.per_display === 1);
}
check("dieline style reads as a part", boxStyleInfo("dieline").label === "Die-cut part from your file");

// Step 39D2: the Split hint only when Split is off; huge blanks are suspect
{
  const two = dxf([...rect(0, 0, 10, 10), ...rect(12, 0, 10, 10)], { insunits: 1 });
  const off = analyzeDieline(two);
  const on = analyzeDieline(two, { split: true });
  check("split off: tells you to tick Split", off.ok && off.warnings.some((w) => /tick "Split"/.test(w)), off.ok && off.warnings);
  check("split on: no tick-Split hint", on.ok && !on.warnings.some((w) => /tick "Split"/.test(w)) && on.warnings.some((w) => /each is priced as its own part/.test(w)), on.ok && on.warnings);
  check("size suspect over 400 in", dielineSizeSuspect(508, 254) && !dielineSizeSuspect(128, 40) && !dielineSizeSuspect(400, 10));
}

// Step 39P: inches by default, red = cut files, the form's One part / Display choice
{
  const big = analyzeDieline(dxf(rect(0, 0, 200, 100)));
  check("39P: unitless 200 x 100 one part = inches with a pick-mm hint", big.ok && big.units === "in" && big.measure.length_in === 200 && big.warnings.some((w) => /pick mm/.test(w)), big.ok && big.warnings);
  const wide = analyzeDieline(dxf([...rect(0, 0, 40, 40), ...rect(160, 0, 40, 40)]), { split: true });
  check("39P: a wide multi-part layout gets no pick-mm hint", wide.ok && !wide.warnings.some((w) => /pick mm/.test(w)), wide.ok && wide.warnings);
  const set = analyzeDieline(dxf(rect(0, 0, 508, 254), { insunits: 4 }));
  check("39P: a file that says mm reports units_set", set.ok && set.units_set && set.units === "mm", set.ok && set);

  // red outlines with yellow creases inside (drawn "red = cut")
  const redCut = dxf([
    ...rect(0, 0, 20, 10, { color: 1 }),
    { x1: 5, y1: 0, x2: 5, y2: 10, color: 2 },
    { x1: 15, y1: 0, x2: 15, y2: 10, color: 2 },
    ...rect(30, 0, 8, 8, { color: 1 }),
    { x1: 30, y1: 4, x2: 38, y2: 4, color: 8 },
  ]);
  const rc = analyzeDieline(redCut, { split: true });
  const role = (r: typeof rc, color: number) => (r.ok ? r.groups.find((g) => g.color === color)?.role : null);
  check("39P: red outlines read as cut", rc.ok && role(rc, 1) === "cut" && role(rc, 2) === "crease" && role(rc, 8) === "crease", rc.ok && rc.groups);
  check("39P: red = cut found 2 parts and says why", rc.ok && rc.measure.pieces === 2 && rc.warnings.some((w) => /red was read as the cut/.test(w)), rc.ok && rc);
  check("39P: red = cut: auto_role is the flipped role (Edit lines keeps no override)", rc.ok && rc.groups.every((g) => g.role === g.auto_role));
  // ArtiosCAD style stays: black outline, red creases inside
  const artios = analyzeDieline(dxf([...rect(0, 0, 20, 10, { color: 7 }), { x1: 5, y1: 0, x2: 5, y2: 10, color: 1 }]));
  check("39P: black cut + red crease unchanged", artios.ok && role(artios, 7) === "cut" && role(artios, 1) === "crease" && !artios.warnings.some((w) => /red was read/.test(w)), artios.ok && artios.groups);
  // an all-red outline is the cut
  const allRed = analyzeDieline(dxf(rect(0, 0, 12, 12, { color: 1 })));
  check("39P: an all-red outline is the cut", allRed.ok && role(allRed, 1) === "cut" && allRed.measure.cut_in === 48, allRed.ok && allRed.groups);
  // a named layer still wins over the shape rule
  const named = analyzeDieline(dxf([...rect(0, 0, 20, 10, { color: 1, layer: "CREASE" }), { x1: 5, y1: 0, x2: 5, y2: 10, color: 2, layer: "CUT" }]));
  check("39P: layer names still win", named.ok && named.groups.find((g) => g.layer === "CREASE")?.role === "crease", named.ok && named.groups);

  // Chuck's display file: red cut, yellow + gray creases, no units, 7 parts about 181" across
  const disp = readFileSync(new URL("./fixtures/display-red-cut.dxf", import.meta.url), "utf8");
  const d = analyzeDieline(disp, { split: true });
  check("39P fixture: inches, not mm", d.ok && d.units === "in", d.ok && d.units_label);
  check("39P fixture: red = cut, 7 parts", d.ok && role(d, 1) === "cut" && d.measure.pieces === 7, d.ok && d.measure);
  const dp = buyerDielineParts(disp, "display test.dxf", [{ piece: 1, label: "Header", per_display: 1 }, { piece: 3, per_display: 2 }]);
  check("39P fixture: quoted as a display of 7 parts", dp.ok && dp.display && dp.parts.length === 7, dp);
  if (dp.ok) {
    check("39P fixture: part 1 24.375 x 53.75, named Header", dp.parts[0].length_in === 24.375 && dp.parts[0].width_in === 53.75 && dp.parts[0].label === "Header", dp.parts[0]);
    check("39P fixture: parts 3 and 4 are the same 29.458 x 38.05", dp.parts[2].length_in === 29.458 && dp.parts[3].length_in === 29.458 && dp.parts[2].width_in === 38.05, [dp.parts[2], dp.parts[3]]);
    check("39P fixture: part 3 x2 per display, part 2 named Part 2", dp.parts[2].per_display === 2 && dp.parts[1].label === "Part 2");
    check("39P fixture: no roles stored (all automatic)", dp.parts.every((p) => !p.roles));
  }

  // the form's choice
  const one = dxf(rect(0, 0, 20, 10), { insunits: 1 });
  const notDisp = buyerDielineParts(one, "a.dxf", [], { as: "display" });
  check("39P: Display picked on a one-outline file -> not_a_display", !notDisp.ok && notDisp.error === "not_a_display", notDisp);
  const asOne = buyerDielineParts(disp, "a.dxf", [], { as: "single" });
  check("39P: One part on a 7-part file = one blank, says so", asOne.ok && !asOne.display && asOne.parts.length === 1 && asOne.parts[0].length_in > 180 && asOne.warnings.some((w) => /7 outlines are priced as one blank/.test(w)), asOne);
  const mmPick = buyerDielineParts(dxf(rect(0, 0, 508, 254)), "a.dxf", [], { units: "mm" });
  check("39P: buyer mm pick reads 508 x 254 as 20 x 10", mmPick.ok && near(mmPick.parts[0].length_in, 20, 0.01) && mmPick.units === "mm", mmPick);
  const rolesPick = buyerDielineParts(dxf([...rect(0, 0, 20, 10), { x1: 5, y1: 0, x2: 5, y2: 10, color: 3 }], { insunits: 1 }), "a.dxf", [], {
    roles: { "0|CONTINUOUS|3": "crease" },
  });
  check("39P: staff roles are applied and kept on the part", rolesPick.ok && rolesPick.parts[0].crease_in === 10 && rolesPick.parts[0].roles?.["0|CONTINUOUS|3"] === "crease", rolesPick);
  check("39P: clean helpers", cleanDielineAs("display") === "display" && cleanDielineAs("x") === "auto" && cleanDielineUnits("mm") === "mm" && cleanDielineUnits(null) === "auto");
  check(
    "39P: cleanDielineRoles keeps known roles only",
    JSON.stringify(cleanDielineRoles('{"a|b|1":"cut","c|d|2":"glue"}')) === '{"a|b|1":"cut"}' && JSON.stringify(cleanDielineRoles("not json")) === "{}",
  );
}

// Step 39Q: each part's own cut file for the job ticket
{
  const disp = readFileSync(new URL("./fixtures/display-red-cut.dxf", import.meta.url), "utf8");
  const p1 = dielinePartLines(disp, { units: "in", piece: 1 });
  check("39Q: part 1 lines = its blank 24.375 x 53.75, moved to 0,0", p1.ok && p1.length_in === 24.375 && p1.width_in === 53.75 && Math.min(...p1.lines.map((l) => Math.min(l.x1, l.x2))) === 0, p1.ok && [p1.length_in, p1.width_in]);
  if (p1.ok) {
    const back = analyzeDieline(dielinePartDxf(p1, ["Q-TEST line 1: Header"]));
    check("39Q: part DXF reads back as one part, same blank, layers CUT + CREASE", back.ok && back.measure.pieces === 1 && back.measure.length_in === 24.375 && back.measure.width_in === 53.75 && back.units_set && back.groups.some((g) => g.layer === "CUT" && g.role === "cut") && back.groups.some((g) => g.layer === "CREASE" && g.role === "crease"), back.ok && back);
    check("39Q: part DXF rule = the part's rule (cut 167.6, crease 111.5)", back.ok && near(back.measure.cut_in, 167.6, 0.2) && near(back.measure.crease_in, 111.5, 0.2), back.ok && back.measure);
    check("39Q: notes go on NOTES (not counted)", back.ok && !back.groups.some((g) => g.layer === "NOTES"), back.ok && back.groups);
  }
  const p3 = dielinePartLines(disp, { units: "in", piece: 3 });
  check("39Q: part 3 = 29.458 x 38.05", p3.ok && p3.length_in === 29.458 && p3.width_in === 38.05, p3.ok && [p3.length_in, p3.width_in]);
  const whole = dielinePartLines(disp, { units: "in", piece: null });
  check("39Q: whole file = 181.5 x 53.75", whole.ok && whole.length_in === 181.5 && whole.width_in === 53.75, whole.ok && [whole.length_in, whole.width_in]);
  const noYellow = dielinePartLines(disp, { units: "in", piece: 1, roles: { "DESIGN|CONTINUOUS|2": "ignore" } });
  check("39Q: the part's stored roles are used (yellow ignored = fewer lines)", noYellow.ok && p1.ok && noYellow.lines.length < p1.lines.length && noYellow.lines.every((l) => l.role !== "perf"), noYellow.ok && noYellow.lines.length);
  check("39Q: missing piece -> piece_missing", (() => { const r = dielinePartLines(disp, { units: "in", piece: 9 }); return !r.ok && r.error === "piece_missing"; })());
  check("39Q: file name", dielinePartFilename("Q-A-261024-87248", "A", 3, "Header / top") === "Q-A-261024-87248__A__Line-3__Header-top.dxf" && dielinePartFilename("Q-1", null, 2, null) === "Q-1__Line-2__Part.dxf");
}

// Step 39W: each part's small drawing for the forms' parts table
{
  const disp = readFileSync(new URL("./fixtures/display-red-cut.dxf", import.meta.url), "utf8");
  const sp = splitDieline(disp, { units: "in", lines: true });
  check("39W: split with lines gives each part its own lines", sp.ok && sp.pieces.every((p) => (p.lines?.length ?? 0) > 0), sp.ok && sp.pieces.map((p) => p.lines?.length));
  if (sp.ok) {
    const svg = dielineLinesSvg(sp.pieces[0].lines ?? []);
    const vb = /viewBox="([^"]+)"/.exec(svg)?.[1].split(" ").map(Number) ?? [];
    const pad = 0.04 * 53.75;
    check("39W: part 1 drawing is its own 24.375 x 53.75 blank (+4% margin)", near(vb[2] - 2 * pad, 24.375, 0.01) && near(vb[3] - 2 * pad, 53.75, 0.01), vb);
    check("39W: cut solid, crease dashed blue, scales to its box", svg.includes('stroke="#111827"') && svg.includes('stroke="#2563eb"') && svg.includes("stroke-dasharray") && svg.includes('preserveAspectRatio="xMidYMid meet"'));
    check("39W: part 6 (cut only) has no crease path", !dielineLinesSvg(sp.pieces[5].lines ?? []).includes("#2563eb"));
    check("39W: only numbers and our own markup (no text from the file)", !/<text|script|DESIGN/i.test(svg));
    check("39W: lines of part 2 are not in part 1's drawing (own lines only)", (sp.pieces[0].lines?.length ?? 0) < 200 && (sp.pieces[0].lines?.length ?? 0) + (sp.pieces[1].lines?.length ?? 0) <= 441, [sp.pieces[0].lines?.length, sp.pieces[1].lines?.length]);
  }
  check("39W: no lines = empty", dielineLinesSvg([]) === "");
}

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
