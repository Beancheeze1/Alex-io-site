// scripts/test-corrugated-price.ts
//
// Tests for the custom RSC pricing engine, built from the spec's worked
// example (12 x 10 x 8 C-flute, 1-color spot, placeholder rates).
// Run: npm run test:corrugated   (= npx --yes tsx scripts/test-corrugated-price.ts)

import { DEFAULT_FLUTES, computeSheet, computeStyleBlank } from "../lib/corrugated-blank";
import { parseBoxStyle, parseCells, parseCustomBoxInput } from "../lib/box-styles";
import {
  describePrintSpec,
  parsePrintSpec,
  pricePrintAdder,
  priceRscBox,
  resolveRunMethod,
  shortRunsOn,
  cadHours,
  type BoxSettings,
  type PriceRscInput,
} from "../lib/corrugated-price";

const C = DEFAULT_FLUTES.find((f) => f.flute === "C")!;

const settings: BoxSettings = {
  waste_pct: 10,
  order_setup_usd: 75,
  converting_per_m: 60,
  plate_spot_usd: 150,
  plate_flood_usd: 200,
  print_setup_per_color_usd: 50,
  print_run_spot_per_m: 25,
  print_run_flood_per_m: 40,
  markup_pct: 30,
  min_order_usd: 250,
  // Step 15: short runs off here; tested below with their own settings.
  digital_under_qty: 0,
  cad_setup_usd: 0,
  cad_cut_per_hr_usd: 0,
  cad_speed_in_per_min: 0,
  digital_setup_usd: 0,
  digital_per_sqft_usd: 0,
  // Step 26: sheet settings (only used with board_method "sheet").
  sheet_trim_in: 0,
  sheet_round_to_in: 0,
  sheet_max_length_in: 0,
  sheet_max_width_in: 0,
  sheet_max_up: 6,
  sheet_min_msf: 0,
  // Step 27: other styles (0 here; set in the style tests).
  diecut_per_m: 0,
  die_base_usd: 0,
  die_per_in_usd: 0,
  pad_per_m: 0,
  partition_per_m: 0,
  joint_type: "glued",
  flap_pct: 50,
  round_to_in: 0.0625,
  edge_trim_in: 0,
};

const base: PriceRscInput = {
  dims: { L: 12, W: 10, D: 8 },
  quantities: [1000, 5000],
  print: { colors: ["spot"], sides: 1 },
  grade: { name: "32 ECT C", cost_per_msf: 85 },
  flute: C,
  settings,
};

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log("PASS", name);
  } else {
    failed++;
    console.log("FAIL", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

// 1. Spec worked example
const r1 = priceRscBox(base);
if (!r1.ok) {
  check("worked example prices", false, r1);
} else {
  const [q1, q5] = r1.quantities;
  check("blank 46.125 x 18.375", r1.blank.length_in === 46.125 && r1.blank.width_in === 18.375, r1.blank);
  check("board @1,000 = $550.32", near(q1.board_usd, 550.32), q1);
  check("box total @1,000 = $988.41", near(q1.box_total_usd, 988.41), q1);
  check("unit @1,000 = $0.9884", q1.unit_price_usd === 0.9884, q1);
  check("unit @5,000 = $0.8584", q5.unit_price_usd === 0.8584, q5);
  check("plates line = $195.00", r1.plates_line_usd === 195, r1.plates_line_usd);
  check("minimum not applied", !q1.min_applied && !q5.min_applied);
  check("no warnings with full rates", r1.warnings.length === 0, r1.warnings);
}

// 2. Minimum order, unprinted
const r2 = priceRscBox({ ...base, quantities: [10], print: { colors: [], sides: 1 } });
if (!r2.ok) {
  check("minimum case prices", false, r2);
} else {
  const q = r2.quantities[0];
  check("minimum applied: box total $250, unit $25", q.min_applied && q.box_total_usd === 250 && q.unit_price_usd === 25, q);
  check("unprinted: no plates", r2.plates_line_usd === 0, r2.plates_line_usd);
  check("unprinted: setup = order setup only", q.setup_usd === 75, q);
}

// 3. Two colors (spot + flood), two sides
const r3 = priceRscBox({ ...base, quantities: [1000], print: { colors: ["spot", "flood"], sides: 2 } });
if (!r3.ok) {
  check("2 colors / 2 sides prices", false, r3);
} else {
  const q = r3.quantities[0];
  check("2c/2s plates line = $910", r3.plates_line_usd === 910, r3.plates_line_usd);
  check("2c/2s print run = $130", q.print_run_usd === 130, q);
  check("2c/2s setup = $275", q.setup_usd === 275, q);
}

// 4. Errors
const e1 = priceRscBox({ ...base, grade: { name: "44 ECT C", cost_per_msf: null } });
check("grade without cost -> grade_no_cost", !e1.ok && e1.error === "grade_no_cost", e1);
const e2 = priceRscBox({ ...base, quantities: [0] });
check("qty 0 -> invalid_quantities", !e2.ok && e2.error === "invalid_quantities", e2);
const e3 = priceRscBox({ ...base, dims: { L: 12, W: 0, D: 8 } });
check("width 0 -> invalid_dims", !e3.ok && e3.error === "invalid_dims", e3);
const e4 = priceRscBox({ ...base, print: { colors: ["spot", "spot", "spot", "spot", "spot"], sides: 1 } });
check("5 colors -> invalid_print", !e4.ok && e4.error === "invalid_print", e4);

// 5. Quantities sorted and de-duplicated
const r5 = priceRscBox({ ...base, quantities: [5000, 1000, 1000] });
check(
  "quantities sorted + de-duplicated",
  r5.ok && r5.quantities.map((q) => q.quantity).join(",") === "1000,5000",
  r5.ok ? r5.quantities.map((q) => q.quantity) : r5,
);

// 6. Step 3B: print adder for stock / mailer / fallback boxes
const a1 = pricePrintAdder(1000, { colors: ["spot"], sides: 1 }, settings);
check(
  "adder 1 spot @1,000: total $97.50, unit $0.0975, plates $195",
  a1.print_total_usd === 97.5 && a1.unit_adder_usd === 0.0975 && a1.plates_line_usd === 195,
  a1,
);
const a2 = pricePrintAdder(1000, { colors: ["spot", "flood"], sides: 2 }, settings);
check(
  "adder 2c/2s @1,000: total $429, unit $0.429, plates $910",
  a2.print_total_usd === 429 && a2.unit_adder_usd === 0.429 && a2.plates_line_usd === 910,
  a2,
);
const a0 = pricePrintAdder(1000, { colors: [], sides: 1 }, settings);
check("adder with no print = 0", a0.print_total_usd === 0 && a0.unit_adder_usd === 0 && a0.plates_line_usd === 0, a0);
check(
  "parsePrintSpec cleans input",
  JSON.stringify(parsePrintSpec({ colors: ["spot", "bad", "flood"], sides: "2" })) ===
    JSON.stringify({ colors: ["spot", "flood"], sides: 2 }),
  parsePrintSpec({ colors: ["spot", "bad", "flood"], sides: "2" }),
);
check("parsePrintSpec rejects non-specs", parsePrintSpec("x") === null && parsePrintSpec({}) === null);
check(
  "describePrintSpec",
  describePrintSpec({ colors: ["spot", "flood"], sides: 2 }) === "2-color print (1 spot, 1 flood), outside + inside",
  describePrintSpec({ colors: ["spot", "flood"], sides: 2 }),
);

// 6. Step 15: short runs (digital print + CAD cut)
const sr: BoxSettings = {
  ...settings,
  digital_under_qty: 50,
  cad_setup_usd: 40,
  // Step 39A: CAD cut by time. $60/hr at 600 in/min = $1 per 600 in of path.
  cad_cut_per_hr_usd: 60,
  cad_speed_in_per_min: 600,
  digital_setup_usd: 25,
  digital_per_sqft_usd: 0.5,
  min_order_usd: 0,
};
check("auto: 49 is digital", resolveRunMethod(null, 49, sr) === "digital");
check("auto: 50 is plates", resolveRunMethod(null, 50, sr) === "plates");
check("auto: off without a CAD table rate", resolveRunMethod(null, 10, { ...sr, cad_cut_per_hr_usd: 0 }) === "plates");
check("auto: off without a CAD table speed", resolveRunMethod(null, 10, { ...sr, cad_speed_in_per_min: 0 }) === "plates");
check("shortRunsOn needs cutoff + rate + speed", shortRunsOn(sr) && !shortRunsOn({ ...sr, cad_speed_in_per_min: 0 }));
check("cadHours: 100 x 300 in at 600 in/min = 0.8333 h", near(cadHours(100, 300, 600), 0.8333, 0.0001));
check("cadHours: 0 speed = 0", cadHours(100, 300, 0) === 0);
check("auto: off with cutoff 0", resolveRunMethod(null, 10, { ...sr, digital_under_qty: 0 }) === "plates");
check("choice wins", resolveRunMethod("plates", 10, sr) === "plates" && resolveRunMethod("digital", 5000, sr) === "digital");

const d1 = priceRscBox({ ...base, settings: sr, quantities: [25, 1000], print: { colors: ["spot", "flood"], sides: 1 } });
if (!d1.ok) {
  check("short run prices", false, d1);
} else {
  const [q25, q1000] = d1.quantities;
  const sq = d1.blank.sqft_each;
  // 25 boxes: converting = 25 x 284.6 in / 600 in/min / 60 x $60/hr = $11.86;
  // print = 25 x sq ft x $0.50; setup = $40 + $25
  check("25 is digital", q25.method === "digital", q25);
  check("25: no plates", q25.plates_line_usd === 0, q25);
  check("25: CAD converting by time $11.86", q25.converting_usd === 11.86, q25);
  check("25: CAD minutes 11.9", q25.cad_minutes === 11.9, q25);
  check("1000 (plates) has no CAD minutes", d1.quantities[1].cad_minutes === undefined, d1.quantities[1]);
  check("25: digital print run", near(q25.print_run_usd, 25 * sq * 0.5), { got: q25.print_run_usd, want: 25 * sq * 0.5 });
  check("25: setup $65", q25.setup_usd === 65, q25);
  check("1000 is plates", q1000.method === "plates" && q1000.plates_line_usd === 455, q1000);
}
const d2 = priceRscBox({ ...base, settings: sr, quantities: [25], print: { colors: [], sides: 1 } });
check(
  "plain short run: CAD cut, no print",
  d2.ok && d2.quantities[0].method === "digital" && d2.quantities[0].print_run_usd === 0 && d2.quantities[0].setup_usd === 40,
  d2,
);
const d3 = priceRscBox({ ...base, settings: sr, quantities: [25], method: "plates" });
check("staff choice: plates at 25", d3.ok && d3.quantities[0].method === "plates" && d3.quantities[0].plates_line_usd === 195, d3);
const d4 = priceRscBox({ ...base, settings: { ...sr, cad_cut_per_hr_usd: 0, cad_speed_in_per_min: 0 }, quantities: [25], method: "digital" });
check(
  "forced digital with no CAD rate / speed warns",
  d4.ok && d4.warnings.includes("CAD table rate is $0.") && d4.warnings.includes("CAD table speed is 0.") && d4.quantities[0].converting_usd === 0,
  d4,
);

const da = pricePrintAdder(20, { colors: ["spot"], sides: 2 }, sr, { sqftEach: 4 });
// run = 20 x 4 x 0.50 x 2 = 80; setup 25; x 1.3 = 136.50
check("digital adder", da.method === "digital" && da.print_total_usd === 136.5 && da.plates_line_usd === 0, da);
const dp = pricePrintAdder(20, { colors: ["spot"], sides: 1 }, sr, { method: "plates" });
check("adder with plates choice", dp.method === "plates" && dp.plates_line_usd === 195, dp);
check(
  "describePrintSpec digital",
  describePrintSpec({ colors: ["spot", "flood"], sides: 2 }, "digital") === "Digital print, outside + inside",
);

// 7. Step 26: board bought as sheets
check("blank method by default", r1.ok && r1.board_method === "blank" && r1.sheet === null, r1.ok ? r1.board_method : r1);

const sheetSet = { sheet_trim_in: 0.5, sheet_round_to_in: 0.25, sheet_max_length_in: 60, sheet_max_width_in: 40, sheet_max_up: 6 };
const g6 = computeSheet({ length_in: 20, width_in: 10 }, sheetSet);
check("20 x 10 blank on a 60 x 40 sheet: 6 up (2 x 3), 40.5 x 30.5", g6.up === 6 && g6.across_length === 2 && g6.across_width === 3 && g6.length_in === 40.5 && g6.width_in === 30.5, g6);
const g4 = computeSheet({ length_in: 20, width_in: 10 }, { ...sheetSet, sheet_max_up: 4 });
check("most 4 per sheet: 2 x 2, 40.5 x 20.5", g4.up === 4 && g4.length_in === 40.5 && g4.width_in === 20.5, g4);
const g1 = computeSheet({ length_in: 20, width_in: 10 }, { ...sheetSet, sheet_max_length_in: 0 });
check("no largest sheet: one up", g1.up === 1 && g1.length_in === 20.5 && g1.width_in === 10.5 && !g1.oversize, g1);
const gr = computeSheet({ length_in: 20, width_in: 10 }, { ...sheetSet, sheet_trim_in: 0.3, sheet_max_length_in: 0 });
check("sheet size rounds up to the step", gr.length_in === 20.5 && gr.width_in === 10.5, gr);
const go = computeSheet({ length_in: 20, width_in: 10 }, { ...sheetSet, sheet_max_width_in: 10 });
check("blank bigger than the largest sheet: oversize, one up", go.oversize && go.up === 1, go);

const sh1 = { ...settings, board_method: "sheet" as const, sheet_trim_in: 0.5, sheet_round_to_in: 0.125, sheet_max_length_in: 0, sheet_max_width_in: 0 };
const s1 = priceRscBox({ ...base, settings: sh1, quantities: [1000] });
if (!s1.ok) {
  check("sheet pricing prices", false, s1);
} else {
  const q = s1.quantities[0];
  // sheet 46.625 x 18.875 = 6.111437 sq ft; 1,100 sheets (10% spoilage) = 6.722581 MSF x $85
  check("one up: sheet 46.625 x 18.875", s1.sheet?.length_in === 46.625 && s1.sheet?.width_in === 18.875 && s1.sheet?.up === 1, s1.sheet);
  check("1,000 boxes = 1,100 sheets", q.sheets === 1100, q);
  check("board = $571.42", near(q.board_usd, 571.42), q);
  check("converting unchanged ($60)", q.converting_usd === 60, q);
}
const s2 = priceRscBox({ ...base, settings: { ...sh1, sheet_round_to_in: 0, sheet_max_length_in: 100, sheet_max_width_in: 40 }, quantities: [1000] });
if (!s2.ok) {
  check("number-up prices", false, s2);
} else {
  const q = s2.quantities[0];
  // 2 x 2 up: 92.75 x 37.25 = 23.992622 sq ft; 275 sheets = 6.597971 MSF x $85
  check("4 up on a 100 x 40 sheet", s2.sheet?.up === 4 && s2.sheet?.length_in === 92.75 && s2.sheet?.width_in === 37.25, s2.sheet);
  check("1,000 boxes 4 up = 275 sheets, board $560.83", q.sheets === 275 && near(q.board_usd, 560.83), q);
}
const s3 = priceRscBox({ ...base, settings: { ...sh1, sheet_min_msf: 1 }, quantities: [10], print: { colors: [], sides: 1 } });
check(
  "corrugator minimum: 11 sheets charged as 1 MSF = $85",
  s3.ok && s3.quantities[0].sheets === 11 && s3.quantities[0].msf === 1 && s3.quantities[0].min_msf_applied === true && s3.quantities[0].board_usd === 85,
  s3.ok ? s3.quantities[0] : s3,
);
const s4 = priceRscBox({ ...base, settings: { ...sh1, sheet_max_length_in: 40, sheet_max_width_in: 40 }, quantities: [1000] });
check("blank too big for the largest sheet warns", s4.ok && s4.sheet?.oversize === true && s4.warnings.some((w) => w.includes("largest sheet")), s4.ok ? s4.warnings : s4);

// 8. Step 27: more styles
const lay = { joint_type: "glued" as const, flap_pct: 50, round_to_in: 0.0625, edge_trim_in: 0, waste_pct: 10 };
const bHsc = computeStyleBlank("hsc", { L: 12, W: 10, D: 8 }, C, lay);
check("HSC 12x10x8: 46.125 x 13.3125 (one set of flaps)", bHsc.length_in === 46.125 && bHsc.width_in === 13.3125, bHsc);
const bFol = computeStyleBlank("fol", { L: 12, W: 10, D: 8 }, C, lay);
check("FOL 12x10x8: 46.125 x 28.375 (full-width flaps)", bFol.length_in === 46.125 && bFol.width_in === 28.375, bFol);
const bRsc = computeStyleBlank("rsc", { L: 12, W: 10, D: 8 }, C, lay);
check("RSC through computeStyleBlank unchanged", bRsc.length_in === 46.125 && bRsc.width_in === 18.375 && bRsc.rule_in === 0, bRsc);
// Step 39A: CAD path. RSC = outline 129 + 6 slots x 5.09375 + 2 x 46.125 + 4 x 8.1875 = 284.5625
check("RSC 12x10x8 CAD path 284.6", bRsc.cad_path_in === 284.6, bRsc.cad_path_in);
check("HSC 12x10x8 CAD path 213.1", bHsc.cad_path_in === 213.1, bHsc.cad_path_in);
check("FOL 12x10x8 CAD path 334.6", bFol.cad_path_in === 334.6, bFol.cad_path_in);
const bPad = computeStyleBlank("pad", { L: 12, W: 10, D: 0 }, C, lay);
check("pad 12 x 10", bPad.length_in === 12 && bPad.width_in === 10 && near(bPad.sqft_each, 0.8333, 0.0001), bPad);
check("pad CAD path = outline 44", bPad.cad_path_in === 44, bPad.cad_path_in);
const bTray = computeStyleBlank("tray", { L: 12, W: 10, D: 8 }, C, lay);
check("tray 12x10x8: 28.375 x 26.375, rule 185.5", bTray.length_in === 28.375 && bTray.width_in === 26.375 && bTray.rule_in === 185.5, bTray);
const bMail = computeStyleBlank("mailer", { L: 12, W: 10, D: 3 }, C, lay);
check("mailer 12x10x3: 24.75 x 32.125, rule 237.75", bMail.length_in === 24.75 && bMail.width_in === 32.125 && bMail.rule_in === 237.75, bMail);
check("die-cut CAD path = die rule (tray 185.5, mailer 237.8)", bTray.cad_path_in === 185.5 && bMail.cad_path_in === 237.8, [bTray.cad_path_in, bMail.cad_path_in]);
const bPart = computeStyleBlank("partition", { L: 12, W: 10, D: 6 }, C, lay, { across: 3, down: 4 });
check(
  "partition 12x10x6, 3 x 4 cells: 3 long 12x6 + 2 short 10x6 = 2.3333 sq ft, 5 pieces",
  bPart.pieces.length === 2 && bPart.pieces[0].count === 3 && bPart.pieces[1].count === 2 && near(bPart.sqft_each, 2.3333, 0.0001) && bPart.pieces_per_box === 5,
  bPart,
);
// 3 long strips (36 + 2 slots x 3) + 2 short strips (32 + 3 slots x 3) = 126 + 82
check("partition 3 x 4 CAD path 208", bPart.cad_path_in === 208, bPart.cad_path_in);

const st = { ...settings, diecut_per_m: 100, die_base_usd: 150, die_per_in_usd: 0.5, pad_per_m: 40, partition_per_m: 200 };
const t1 = priceRscBox({ ...base, settings: st, style: "tray", quantities: [1000] });
if (!t1.ok) {
  check("tray prices", false, t1);
} else {
  const q = t1.quantities[0];
  // die = (150 + 185.5 x 0.50) x 1.30 = 315.58
  check("tray: die line $315.58, die-cut converting $100", t1.die_line_usd === 315.58 && q.die_line_usd === 315.58 && q.converting_usd === 100, { die: t1.die_line_usd, q });
  check("tray: no die warning with rates set", !t1.warnings.some((w) => w.includes("die")), t1.warnings);
}
const t0 = priceRscBox({ ...base, style: "tray", quantities: [1000] });
check("tray with $0 die rates warns", t0.ok && t0.warnings.includes("Cutting die cost is $0.") && t0.warnings.includes("Die-cut converting cost is $0."), t0.ok ? t0.warnings : t0);
const t2 = priceRscBox({ ...base, settings: { ...st, digital_under_qty: 50, cad_cut_per_hr_usd: 60, cad_speed_in_per_min: 600 }, style: "tray", quantities: [25] });
check("tray short run: CAD cut, no die", t2.ok && t2.quantities[0].method === "digital" && t2.quantities[0].die_line_usd === 0, t2.ok ? t2.quantities[0] : t2);
const t3 = priceRscBox({ ...base, settings: { ...st, min_order_usd: 1000 }, style: "tray", quantities: [10], print: { colors: [], sides: 1 } });
check(
  "minimum counts the die: box total = 1000 - 315.58",
  t3.ok && t3.quantities[0].min_applied && t3.quantities[0].box_total_usd === 684.42,
  t3.ok ? t3.quantities[0] : t3,
);
const p1 = priceRscBox({ ...base, settings: st, style: "partition", cells: { across: 3, down: 4 }, dims: { L: 12, W: 10, D: 6 }, quantities: [1000] });
if (!p1.ok) {
  check("partition prices", false, p1);
} else {
  const q = p1.quantities[0];
  check("partition: $200 per 1,000 sets, unprinted, warns", q.converting_usd === 200 && p1.colors === 0 && p1.plates_line_usd === 0 && p1.warnings.includes("Partitions are priced unprinted."), p1);
  // board = 2.3333 x 1.1 x 1000 / 1000 x 85 = 218.17
  check("partition board $218.17", near(q.board_usd, 218.17), q);
}
const p0 = priceRscBox({ ...base, style: "partition", cells: null, dims: { L: 12, W: 10, D: 6 } });
check("partition without cells -> invalid_cells", !p0.ok && p0.error === "invalid_cells", p0);
const p2 = priceRscBox({
  ...base,
  settings: { ...st, digital_under_qty: 50, cad_cut_per_hr_usd: 60, cad_speed_in_per_min: 600 },
  style: "partition",
  cells: { across: 3, down: 4 },
  dims: { L: 12, W: 10, D: 6 },
  quantities: [10],
});
// Step 39A: 10 sets x 208 in / 600 in/min / 60 x $60/hr = $3.47
check("partition short run: CAD cut by time (10 sets x 208 in = $3.47)", p2.ok && p2.quantities[0].converting_usd === 3.47, p2.ok ? p2.quantities[0] : p2);
const p3 = priceRscBox({
  ...base,
  settings: { ...st, board_method: "sheet" },
  style: "partition",
  cells: { across: 3, down: 4 },
  dims: { L: 12, W: 10, D: 6 },
  quantities: [100],
});
// one up: 330 long-strip sheets + 220 short-strip sheets
check("partition sheet costing: sheets per strip type (330 + 220)", p3.ok && p3.quantities[0].sheets === 550 && p3.piece_sheets.length === 2, p3.ok ? p3.quantities[0] : p3);
const pd = priceRscBox({ ...base, settings: st, style: "pad", dims: { L: 12, W: 10, D: 0 }, quantities: [1000] });
check("pad: no depth needed, pad cutting $40", pd.ok && pd.quantities[0].converting_usd === 40, pd.ok ? pd.quantities[0] : pd);
const hs = priceRscBox({ ...base, settings: st, style: "hsc", quantities: [1000] });
check("HSC uses RSC converting ($60), no die", hs.ok && hs.quantities[0].converting_usd === 60 && hs.die_line_usd === 0, hs.ok ? hs.quantities[0] : hs);
check("parseBoxStyle", parseBoxStyle("HSC") === "hsc" && parseBoxStyle("Mailer box") === "mailer" && parseBoxStyle("bogus") === null);
check("parseCells", parseCells(3, 4)?.across === 3 && parseCells(1, 1) === null && parseCells(0, 4) === null && parseCells(2.5, 2) === null);
const ci = parseCustomBoxInput({ L: 12, W: 10, style: "pad" });
check("pad input: depth not needed, stored as 0", ci.ok && ci.value.D === 0 && ci.value.style === "pad", ci);
const cp = parseCustomBoxInput({ L: 12, W: 10, D: 6, style: "partition" });
check("partition input without cells is refused", !cp.ok, cp);
const cr = parseCustomBoxInput({ L: 12, W: 10, D: 8 });
check("no style = RSC (old callers)", cr.ok && cr.value.style === "rsc", cr);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
