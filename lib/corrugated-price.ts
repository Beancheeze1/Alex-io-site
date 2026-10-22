// lib/corrugated-price.ts
//
// Custom-size RSC box pricing engine (pure: no DB). Spec: "Custom Corrugated
// Box Pricing - Spec v1", section "Price calculation".
//
//   1 Board      = sq ft per box (with waste) x qty / 1000 x grade $/MSF
//   2 Converting = qty / 1000 x converting $/M
//   3 Print run  = qty / 1000 x sum(run $/M per color, spot or flood) x sides
//   4 Setup      = order setup + print setup x colors x sides
//   5 Plates     = sum(plate $ per color, spot or flood) x sides  (own line)
//   Box total    = (1+2+3+4) x (1 + markup%);  Plates line = 5 x (1 + markup%)
//   Minimum      = if box total + plates line < minimum, box total is raised
//   Unit         = box total / qty, 4 decimals; extended = unit x qty, cents
//
// Step 15, short runs (run method "digital"): digitally printed and CAD cut,
// no plates and no press. Per quantity:
//   Converting = CAD table hours x $/hour (Step 39A; was qty x CAD cut $/box),
//                hours = qty x CAD path per box (cuts + scores, in) / speed (in/min) / 60
//   Print run  = qty x blank sq ft (no waste) x digital $/sq ft x sides
//   Setup      = CAD setup + (printed ? digital setup : 0)
//   Plates     = 0
// The method is "plates" or "digital"; with no choice (auto) a quantity under
// the shop's short-run cutoff is digital, once the shop has a CAD table rate and speed.
//
// Step 26, board bought as sheets (settings.board_method "sheet"): step 1
// becomes, per quantity,
//   sheets = ceil(qty / blanks per sheet x (1 + waste%))   (waste = spoilage)
//   MSF    = sheets x sheet sq ft / 1000, at least the corrugator minimum
//   Board  = MSF x grade $/MSF
// The sheet (size, blanks per sheet) comes from computeSheet. Everything
// else is unchanged; "blank" (the default) is the Step 2 formula.
//
// Step 27, other styles (lib/box-styles.ts): the blank comes from
// computeStyleBlank. Converting per style: RSC / HSC / FOL = converting $/M,
// mailer / tray = die-cut $/M, pads = pad $/M, partitions = partition $/M
// (per 1,000 sets). Die-cut styles run on the press carry a one-time cutting
// die = (die base + rule inches x $/in) x (1 + markup%), its own line like
// plates (and counted toward the minimum order). Digital short runs are CAD
// cut: no die; CAD cut is per piece (a partition set has several).
// Partitions are priced unprinted. Sheet costing works per piece type.
//
// Imports only ./corrugated-blank and ./box-styles so it runs anywhere.

import {
  computeSheet,
  computeStyleBlank,
  type BlankPiece,
  type StyleBlank,
  type BoardMethod,
  type SheetResult,
  type CorrugatedRates,
  type FluteSpec,
  type JointType,
} from "./corrugated-blank";
import { boxStyleInfo, type BoxStyle, type PartitionCells } from "./box-styles";

export type Coverage = "spot" | "flood";

export type PrintSpec = {
  colors: Coverage[]; // one entry per color; [] = unprinted
  /** Step 37N: 1 = printed on the outside, 2 = outside + inside (a second pass). */
  sides: 1 | 2;
  /** Step 37N: panels printed (1-4), recorded only; doesn't change the price. */
  panels?: 1 | 2 | 3 | 4;
};

/** Step 37N: "1 panel" / "2 panels" / "all 4 panels". */
export function panelsText(n: unknown): string | null {
  const p = Number(n);
  if (p === 4) return "all 4 panels";
  if (p === 1 || p === 2 || p === 3) return `${p} panel${p === 1 ? "" : "s"}`;
  return null;
}

export type BoxSettings = CorrugatedRates & {
  joint_type: JointType;
  flap_pct: number;
  round_to_in: number;
  edge_trim_in: number;
  /** Step 26: missing = "blank" (Step 2 board formula). */
  board_method?: BoardMethod;
};

/** Step 15: production (plates, press, die/converting) or short run (digital + CAD cut). */
export type RunMethod = "plates" | "digital";

export function parseRunMethod(raw: unknown): RunMethod | null {
  return raw === "plates" || raw === "digital" ? raw : null;
}

type ShortRunRates = { digital_under_qty: number; cad_cut_per_hr_usd: number; cad_speed_in_per_min: number };

/** Short runs are on when the shop has a cutoff, a CAD table rate and a CAD table speed (Step 39A). */
export function shortRunsOn(s: ShortRunRates): boolean {
  return Number(s.digital_under_qty) > 0 && Number(s.cad_cut_per_hr_usd) > 0 && Number(s.cad_speed_in_per_min) > 0;
}

/** Step 39A: CAD table hours for a quantity (path in inches per box / set). */
export function cadHours(qty: number, pathIn: number, speedInPerMin: number): number {
  const speed = Number(speedInPerMin);
  if (!(speed > 0) || !(pathIn > 0) || !(qty > 0)) return 0;
  return (qty * pathIn) / speed / 60;
}

/** The method used at a quantity: the staff choice, else auto by the shop's cutoff. */
export function resolveRunMethod(choice: RunMethod | null | undefined, qty: number, s: ShortRunRates): RunMethod {
  if (choice === "plates" || choice === "digital") return choice;
  return shortRunsOn(s) && qty < Number(s.digital_under_qty) ? "digital" : "plates";
}

export type PriceRscInput = {
  dims: { L: number; W: number; D: number }; // inside, inches
  quantities: number[];
  print: PrintSpec;
  grade: { name: string; cost_per_msf: number | null };
  flute: FluteSpec;
  settings: BoxSettings;
  method?: RunMethod | null; // Step 15: null / missing = auto by quantity
  style?: BoxStyle; // Step 27: missing = "rsc"
  cells?: PartitionCells | null; // Step 27: partitions only
};

export type QtyPrice = {
  quantity: number;
  board_usd: number; // costs before markup
  converting_usd: number;
  print_run_usd: number;
  setup_usd: number;
  cost_usd: number;
  box_total_usd: number; // after markup and minimum
  min_applied: boolean;
  unit_price_usd: number; // 4 decimals
  extended_usd: number; // unit x qty, cents
  method: RunMethod; // Step 15
  plates_line_usd: number; // Step 15: plates at this quantity (0 for digital)
  sheets?: number; // Step 26 (sheet method): sheets bought, spoilage included
  msf?: number; // Step 26 (sheet method): MSF charged (at least the minimum)
  min_msf_applied?: boolean; // Step 26: the corrugator minimum was charged
  die_line_usd: number; // Step 27: cutting die at this quantity (0 unless die-cut on the press)
  cad_minutes?: number; // Step 39A: CAD table minutes for the quantity (short runs only)
};

export type BoxPriceOk = {
  ok: true;
  style: BoxStyle; // Step 27
  blank: StyleBlank;
  colors: number;
  sides: 1 | 2;
  plates_cost_usd: number; // before markup, when run with plates
  plates_line_usd: number; // marked up, one time, when run with plates (see each quantity)
  quantities: QtyPrice[]; // ascending, de-duplicated
  warnings: string[]; // rates at $0 that probably shouldn't be
  board_method: BoardMethod; // Step 26
  sheet: SheetResult | null; // Step 26: the sheet bought (sheet method only; first piece)
  piece_sheets: SheetResult[]; // Step 27: one per piece type (partitions have two)
  die_cost_usd: number; // Step 27: cutting die before markup (die-cut styles)
  die_line_usd: number; // Step 27: marked up, one time, when run on the press
};

export type BoxPriceErr = { ok: false; error: string; message: string };

export type BoxPriceResult = BoxPriceOk | BoxPriceErr;

export const MAX_QUANTITIES = 4;
export const MAX_COLORS = 4;
export const MAX_QTY = 10_000_000;
export const MAX_DIM_IN = 1000;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

function fail(error: string, message: string): BoxPriceErr {
  return { ok: false, error, message };
}

export function priceRscBox(inp: PriceRscInput): BoxPriceResult {
  const style: BoxStyle = inp.style ?? "rsc";
  const info = boxStyleInfo(style);
  const L = inp.dims.L;
  const W = inp.dims.W;
  const D = info.usesDepth ? inp.dims.D : 0;
  const dimChecks: [string, number][] = [
    ["length", L],
    ["width", W],
    ...(info.usesDepth ? ([[info.depthLabel.toLowerCase(), D]] as [string, number][]) : []),
  ];
  for (const [name, v] of dimChecks) {
    if (!Number.isFinite(v) || v <= 0 || v > MAX_DIM_IN) {
      return fail("invalid_dims", `Inside ${name} must be more than 0 and at most ${MAX_DIM_IN} in.`);
    }
  }
  if (info.cells) {
    const c = inp.cells;
    if (!c || !Number.isInteger(c.across) || !Number.isInteger(c.down) || c.across < 1 || c.down < 1 || c.across * c.down < 2) {
      return fail("invalid_cells", "A partition set needs cells across and down (at least 2 cells).");
    }
  }

  const raw = Array.isArray(inp.quantities) ? inp.quantities : [];
  const qtys = Array.from(new Set(raw)).sort((a, b) => a - b);
  if (qtys.length < 1 || qtys.length > MAX_QUANTITIES) {
    return fail("invalid_quantities", `Enter 1 to ${MAX_QUANTITIES} quantities.`);
  }
  for (const q of qtys) {
    if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) {
      return fail("invalid_quantities", `Quantities must be whole numbers from 1 to ${MAX_QTY.toLocaleString("en-US")}.`);
    }
  }

  const askedColors = Array.isArray(inp.print?.colors) ? inp.print.colors : [];
  if (askedColors.length > MAX_COLORS || askedColors.some((c) => c !== "spot" && c !== "flood")) {
    return fail("invalid_print", `Printing must be 0 to ${MAX_COLORS} colors, each spot or flood.`);
  }
  // Step 27: partitions are priced unprinted.
  const colors = info.printable ? askedColors : [];
  const sides: 1 | 2 = colors.length === 0 ? 1 : inp.print.sides;
  if (sides !== 1 && sides !== 2) return fail("invalid_print", "Printing sides must be 1 or 2.");

  const cost = inp.grade.cost_per_msf;
  if (cost === null || !Number.isFinite(cost) || cost <= 0) {
    return fail(
      "grade_no_cost",
      `Board grade "${inp.grade.name}" has no cost per MSF yet. Set it in Admin → Corrugated.`,
    );
  }

  const s = inp.settings;
  const blank = computeStyleBlank(
    style,
    { L, W, D },
    inp.flute,
    {
      joint_type: s.joint_type,
      flap_pct: s.flap_pct,
      round_to_in: s.round_to_in,
      edge_trim_in: s.edge_trim_in,
      waste_pct: s.waste_pct,
    },
    inp.cells ?? null,
  );

  // Step 26: board bought as sheets (Step 27: one sheet per piece type).
  const boardMethod: BoardMethod = s.board_method === "sheet" ? "sheet" : "blank";
  const pieceSheets: SheetResult[] =
    boardMethod === "sheet" ? blank.pieces.map((p: BlankPiece) => computeSheet(p, s)) : [];
  const sheet = pieceSheets[0] ?? null;
  const minMsf = Math.max(0, Number(s.sheet_min_msf) || 0);

  // Step 27: converting rate and cutting die by style.
  const convertingPerM =
    info.kind === "diecut"
      ? Number(s.diecut_per_m) || 0
      : info.kind === "flat"
        ? Number(s.pad_per_m) || 0
        : info.kind === "partition"
          ? Number(s.partition_per_m) || 0
          : s.converting_per_m;
  const dieCost = info.kind === "diecut" ? (Number(s.die_base_usd) || 0) + blank.rule_in * (Number(s.die_per_in_usd) || 0) : 0;

  const spot = colors.filter((c) => c === "spot").length;
  const flood = colors.length - spot;
  const runPerMPerSide = spot * s.print_run_spot_per_m + flood * s.print_run_flood_per_m;
  const platesCost = (spot * s.plate_spot_usd + flood * s.plate_flood_usd) * sides;
  const printSetup = s.print_setup_per_color_usd * colors.length * sides;
  const mk = 1 + s.markup_pct / 100;
  const platesLineRaw = platesCost * mk;
  const dieLineRaw = r2(dieCost * mk); // cents, so the line and the minimum add up exactly

  const printed = colors.length > 0;
  const quantities: QtyPrice[] = qtys.map((qty) => {
    const method = resolveRunMethod(inp.method, qty, s);
    let board = ((blank.sqft_each_with_waste * qty) / 1000) * cost;
    let sheetInfo: Pick<QtyPrice, "sheets" | "msf" | "min_msf_applied"> = {};
    if (pieceSheets.length > 0) {
      let sheets = 0;
      let msfBought = 0;
      blank.pieces.forEach((p, i) => {
        const sh = pieceSheets[i];
        const n = Math.ceil(((qty * p.count) / sh.up) * (1 + s.waste_pct / 100) - 1e-9);
        sheets += n;
        msfBought += (n * sh.sqft) / 1000;
      });
      const msf = Math.max(msfBought, minMsf);
      board = msf * cost;
      sheetInfo = { sheets, msf: r4(msf), min_msf_applied: msf > msfBought + 1e-12 };
    }
    let converting: number;
    let run: number;
    let setup: number;
    let platesLine: number;
    let dieLine: number;
    let cadHrs = 0;
    if (method === "digital") {
      // Step 15: short run, digitally printed and CAD cut. No plates, no press, no die.
      // Step 39A: CAD cut by time: path (cuts + scores) ÷ table speed × $/hour.
      cadHrs = cadHours(qty, blank.cad_path_in, s.cad_speed_in_per_min);
      converting = cadHrs * (Number(s.cad_cut_per_hr_usd) || 0);
      run = printed ? qty * blank.sqft_each * s.digital_per_sqft_usd * sides : 0;
      setup = s.cad_setup_usd + (printed ? s.digital_setup_usd : 0);
      platesLine = 0;
      dieLine = 0;
    } else {
      converting = (qty / 1000) * convertingPerM;
      run = (qty / 1000) * runPerMPerSide * sides;
      setup = s.order_setup_usd + printSetup;
      platesLine = platesLineRaw;
      dieLine = dieLineRaw;
    }
    const costUsd = board + converting + run + setup;

    let boxTotal = costUsd * mk;
    let minApplied = false;
    if (s.min_order_usd > 0 && boxTotal + platesLine + dieLine < s.min_order_usd) {
      boxTotal = s.min_order_usd - platesLine - dieLine;
      minApplied = true;
    }

    const unit = r4(boxTotal / qty);
    return {
      quantity: qty,
      board_usd: r2(board),
      converting_usd: r2(converting),
      print_run_usd: r2(run),
      setup_usd: r2(setup),
      cost_usd: r2(costUsd),
      box_total_usd: r2(boxTotal),
      min_applied: minApplied,
      unit_price_usd: unit,
      extended_usd: r2(unit * qty),
      method,
      plates_line_usd: r2(platesLine),
      ...sheetInfo,
      die_line_usd: r2(dieLine),
      ...(method === "digital" ? { cad_minutes: Math.round(cadHrs * 600) / 10 } : {}),
    };
  });

  const anyPlates = quantities.some((x) => x.method === "plates");
  const anyDigital = quantities.some((x) => x.method === "digital");
  const warnings: string[] = [];
  if (s.markup_pct === 0) warnings.push("Markup is 0%.");
  if (anyPlates) {
    if (convertingPerM === 0) {
      warnings.push(
        info.kind === "diecut"
          ? "Die-cut converting cost is $0."
          : info.kind === "flat"
            ? "Pad cutting cost is $0."
            : info.kind === "partition"
              ? "Partition cost is $0."
              : "Converting cost is $0.",
      );
    }
    if (info.kind === "diecut" && dieCost === 0) warnings.push("Cutting die cost is $0.");
    if (colors.length > 0 && s.print_setup_per_color_usd === 0) warnings.push("Print setup is $0.");
    if (spot > 0 && s.print_run_spot_per_m === 0) warnings.push("Spot print run rate is $0.");
    if (flood > 0 && s.print_run_flood_per_m === 0) warnings.push("Flood print run rate is $0.");
    if (spot > 0 && s.plate_spot_usd === 0) warnings.push("Spot plate cost is $0.");
    if (flood > 0 && s.plate_flood_usd === 0) warnings.push("Flood plate cost is $0.");
  }
  if (anyDigital) {
    if (!(Number(s.cad_cut_per_hr_usd) > 0)) warnings.push("CAD table rate is $0.");
    if (!(Number(s.cad_speed_in_per_min) > 0)) warnings.push("CAD table speed is 0.");
    if (printed && s.digital_per_sqft_usd === 0) warnings.push("Digital print rate is $0.");
  }
  if (!info.printable && askedColors.length > 0) warnings.push("Partitions are priced unprinted.");
  pieceSheets.forEach((sh, i) => {
    if (!sh.oversize) return;
    const p = blank.pieces[i];
    warnings.push(
      `The ${r4(p.length_in)} x ${r4(p.width_in)} in ${blank.pieces.length > 1 ? p.label.toLowerCase().replace(/s$/, "") : "blank"} doesn't fit the largest sheet (${s.sheet_max_length_in} x ${s.sheet_max_width_in} in).`,
    );
  });

  return {
    ok: true,
    style,
    blank,
    colors: colors.length,
    sides,
    plates_cost_usd: r2(platesCost),
    plates_line_usd: r2(platesLineRaw),
    quantities,
    warnings,
    board_method: boardMethod,
    sheet,
    piece_sheets: pieceSheets,
    die_cost_usd: r2(dieCost),
    die_line_usd: r2(dieLineRaw),
  };
}

// ---------- Step 3B: per-color printing for any box ----------

/** Cleans a stored / posted print spec. Not an object with a colors array → null. */
export function parsePrintSpec(raw: unknown): PrintSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { colors?: unknown; sides?: unknown; panels?: unknown };
  if (!Array.isArray(r.colors)) return null;
  const colors = r.colors
    .filter((c): c is Coverage => c === "spot" || c === "flood")
    .slice(0, MAX_COLORS);
  const sides: 1 | 2 = Number(r.sides) === 2 ? 2 : 1;
  const p = Number(r.panels);
  // Step 37N: panels kept only when printed and 1-4
  if (colors.length > 0 && (p === 1 || p === 2 || p === 3 || p === 4)) return { colors, sides, panels: p };
  return { colors, sides };
}

/** Step 37N: where it's printed: "outside" or "outside + inside" (sides 1 / 2). */
export function printFaceText(sides: unknown): string {
  return Number(sides) === 2 ? "outside + inside" : "outside";
}

/**
 * "2-color print (1 spot, 1 flood), outside + inside, 2 panels" — or "No
 * print". Step 15: with method "digital", "Digital print, outside" (full
 * color, no plates). Step 37N: "outside" / "outside + inside" instead of
 * "one side" / "two sides", and the panels when known.
 */
export function describePrintSpec(p: PrintSpec | null, method?: RunMethod | null): string {
  if (!p || p.colors.length === 0) return "No print";
  const tail = [printFaceText(p.sides), panelsText(p.panels)].filter(Boolean).join(", ");
  if (method === "digital") return `Digital print, ${tail}`;
  const spot = p.colors.filter((c) => c === "spot").length;
  const flood = p.colors.length - spot;
  const parts: string[] = [];
  if (spot) parts.push(`${spot} spot`);
  if (flood) parts.push(`${flood} flood`);
  return `${p.colors.length}-color print (${parts.join(", ")}), ${tail}`;
}

export type PrintAdderResult = {
  print_total_usd: number; // (print run + print setup) x (1 + markup), for the qty
  unit_adder_usd: number; // print_total / qty, 4 decimals
  plates_line_usd: number; // one-time plates x (1 + markup)
  warnings: string[];
  method: RunMethod; // Step 15
};

/**
 * Print cost for a box that isn't engine-priced (stock catalog box, custom
 * mailer, nearest-stock fallback), from the shop's per-color rates:
 *   run    = qty / 1000 x sum(run $/M per color, spot or flood) x sides
 *   setup  = print setup per color x colors x sides
 *   plates = sum(plate $ per color, spot or flood) x sides   (own line)
 * Run + setup are marked up and spread over the qty; order setup, board,
 * converting and the minimum order don't apply (the box keeps its own price).
 *
 * Step 15: method "digital" (staff choice, or auto under the short-run
 * cutoff): run = qty x blank sq ft x digital $/sq ft x sides, setup = digital
 * setup, no plates. opts.sqftEach is the box's blank area (no waste).
 */
export function pricePrintAdder(
  quantity: number,
  print: PrintSpec,
  s: BoxSettings,
  opts: { method?: RunMethod | null; sqftEach?: number | null } = {},
): PrintAdderResult {
  const colors = (print?.colors ?? []).filter((c) => c === "spot" || c === "flood").slice(0, MAX_COLORS);
  const qty = Math.max(1, Math.round(quantity || 1));
  const method = resolveRunMethod(opts.method, qty, s);
  if (colors.length === 0) {
    return { print_total_usd: 0, unit_adder_usd: 0, plates_line_usd: 0, warnings: [], method };
  }
  const sides: 1 | 2 = print.sides === 2 ? 2 : 1;
  const mk = 1 + s.markup_pct / 100;

  if (method === "digital") {
    const sqft = Math.max(0, Number(opts.sqftEach) || 0);
    const dRun = qty * sqft * s.digital_per_sqft_usd * sides;
    const dTotal = (dRun + s.digital_setup_usd) * mk;
    const dWarnings: string[] = [];
    if (s.digital_per_sqft_usd === 0) dWarnings.push("Digital print rate is $0.");
    if (sqft === 0) dWarnings.push("No blank size for digital print.");
    return {
      print_total_usd: r2(dTotal),
      unit_adder_usd: r4(dTotal / qty),
      plates_line_usd: 0,
      warnings: dWarnings,
      method,
    };
  }

  const spot = colors.filter((c) => c === "spot").length;
  const flood = colors.length - spot;

  const run = (qty / 1000) * (spot * s.print_run_spot_per_m + flood * s.print_run_flood_per_m) * sides;
  const setup = s.print_setup_per_color_usd * colors.length * sides;
  const total = (run + setup) * mk;
  const plates = (spot * s.plate_spot_usd + flood * s.plate_flood_usd) * sides * mk;

  const warnings: string[] = [];
  if (s.print_setup_per_color_usd === 0) warnings.push("Print setup is $0.");
  if (spot > 0 && s.print_run_spot_per_m === 0) warnings.push("Spot print run rate is $0.");
  if (flood > 0 && s.print_run_flood_per_m === 0) warnings.push("Flood print run rate is $0.");
  if (spot > 0 && s.plate_spot_usd === 0) warnings.push("Spot plate cost is $0.");
  if (flood > 0 && s.plate_flood_usd === 0) warnings.push("Flood plate cost is $0.");

  return {
    print_total_usd: r2(total),
    unit_adder_usd: r4(total / qty),
    plates_line_usd: r2(plates),
    warnings,
    method,
  };
}
