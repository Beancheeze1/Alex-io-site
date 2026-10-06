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
// Imports only ./corrugated-blank so it runs anywhere (server, browser, tsx).

import {
  computeRscBlank,
  type BlankResult,
  type CorrugatedRates,
  type FluteSpec,
  type JointType,
} from "./corrugated-blank";

export type Coverage = "spot" | "flood";

export type PrintSpec = {
  colors: Coverage[]; // one entry per color; [] = unprinted
  sides: 1 | 2;
};

export type BoxSettings = CorrugatedRates & {
  joint_type: JointType;
  flap_pct: number;
  round_to_in: number;
  edge_trim_in: number;
};

export type PriceRscInput = {
  dims: { L: number; W: number; D: number }; // inside, inches
  quantities: number[];
  print: PrintSpec;
  grade: { name: string; cost_per_msf: number | null };
  flute: FluteSpec;
  settings: BoxSettings;
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
};

export type BoxPriceOk = {
  ok: true;
  blank: BlankResult;
  colors: number;
  sides: 1 | 2;
  plates_cost_usd: number; // before markup
  plates_line_usd: number; // marked up, one time
  quantities: QtyPrice[]; // ascending, de-duplicated
  warnings: string[]; // rates at $0 that probably shouldn't be
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
  const { L, W, D } = inp.dims;
  const dimChecks: [string, number][] = [
    ["length", L],
    ["width", W],
    ["depth", D],
  ];
  for (const [name, v] of dimChecks) {
    if (!Number.isFinite(v) || v <= 0 || v > MAX_DIM_IN) {
      return fail("invalid_dims", `Inside ${name} must be more than 0 and at most ${MAX_DIM_IN} in.`);
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

  const colors = Array.isArray(inp.print?.colors) ? inp.print.colors : [];
  if (colors.length > MAX_COLORS || colors.some((c) => c !== "spot" && c !== "flood")) {
    return fail("invalid_print", `Printing must be 0 to ${MAX_COLORS} colors, each spot or flood.`);
  }
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
  const blank = computeRscBlank(inp.dims, inp.flute, {
    joint_type: s.joint_type,
    flap_pct: s.flap_pct,
    round_to_in: s.round_to_in,
    edge_trim_in: s.edge_trim_in,
    waste_pct: s.waste_pct,
  });

  const spot = colors.filter((c) => c === "spot").length;
  const flood = colors.length - spot;
  const runPerMPerSide = spot * s.print_run_spot_per_m + flood * s.print_run_flood_per_m;
  const platesCost = (spot * s.plate_spot_usd + flood * s.plate_flood_usd) * sides;
  const printSetup = s.print_setup_per_color_usd * colors.length * sides;
  const mk = 1 + s.markup_pct / 100;
  const platesLineRaw = platesCost * mk;

  const quantities: QtyPrice[] = qtys.map((qty) => {
    const board = ((blank.sqft_each_with_waste * qty) / 1000) * cost;
    const converting = (qty / 1000) * s.converting_per_m;
    const run = (qty / 1000) * runPerMPerSide * sides;
    const setup = s.order_setup_usd + printSetup;
    const costUsd = board + converting + run + setup;

    let boxTotal = costUsd * mk;
    let minApplied = false;
    if (s.min_order_usd > 0 && boxTotal + platesLineRaw < s.min_order_usd) {
      boxTotal = s.min_order_usd - platesLineRaw;
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
    };
  });

  const warnings: string[] = [];
  if (s.converting_per_m === 0) warnings.push("Converting cost is $0.");
  if (s.markup_pct === 0) warnings.push("Markup is 0%.");
  if (colors.length > 0 && s.print_setup_per_color_usd === 0) warnings.push("Print setup is $0.");
  if (spot > 0 && s.print_run_spot_per_m === 0) warnings.push("Spot print run rate is $0.");
  if (flood > 0 && s.print_run_flood_per_m === 0) warnings.push("Flood print run rate is $0.");
  if (spot > 0 && s.plate_spot_usd === 0) warnings.push("Spot plate cost is $0.");
  if (flood > 0 && s.plate_flood_usd === 0) warnings.push("Flood plate cost is $0.");

  return {
    ok: true,
    blank,
    colors: colors.length,
    sides,
    plates_cost_usd: r2(platesCost),
    plates_line_usd: r2(platesLineRaw),
    quantities,
    warnings,
  };
}

// ---------- Step 3B: per-color printing for any box ----------

/** Cleans a stored / posted print spec. Not an object with a colors array → null. */
export function parsePrintSpec(raw: unknown): PrintSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { colors?: unknown; sides?: unknown };
  if (!Array.isArray(r.colors)) return null;
  const colors = r.colors
    .filter((c): c is Coverage => c === "spot" || c === "flood")
    .slice(0, MAX_COLORS);
  const sides: 1 | 2 = Number(r.sides) === 2 ? 2 : 1;
  return { colors, sides };
}

/** "2-color print (1 spot, 1 flood), two sides" — or "No print". */
export function describePrintSpec(p: PrintSpec | null): string {
  if (!p || p.colors.length === 0) return "No print";
  const spot = p.colors.filter((c) => c === "spot").length;
  const flood = p.colors.length - spot;
  const parts: string[] = [];
  if (spot) parts.push(`${spot} spot`);
  if (flood) parts.push(`${flood} flood`);
  return `${p.colors.length}-color print (${parts.join(", ")}), ${p.sides === 2 ? "two sides" : "one side"}`;
}

export type PrintAdderResult = {
  print_total_usd: number; // (print run + print setup) x (1 + markup), for the qty
  unit_adder_usd: number; // print_total / qty, 4 decimals
  plates_line_usd: number; // one-time plates x (1 + markup)
  warnings: string[];
};

/**
 * Print cost for a box that isn't engine-priced (stock catalog box, custom
 * mailer, nearest-stock fallback), from the shop's per-color rates:
 *   run    = qty / 1000 x sum(run $/M per color, spot or flood) x sides
 *   setup  = print setup per color x colors x sides
 *   plates = sum(plate $ per color, spot or flood) x sides   (own line)
 * Run + setup are marked up and spread over the qty; order setup, board,
 * converting and the minimum order don't apply (the box keeps its own price).
 */
export function pricePrintAdder(quantity: number, print: PrintSpec, s: BoxSettings): PrintAdderResult {
  const colors = (print?.colors ?? []).filter((c) => c === "spot" || c === "flood").slice(0, MAX_COLORS);
  if (colors.length === 0) {
    return { print_total_usd: 0, unit_adder_usd: 0, plates_line_usd: 0, warnings: [] };
  }
  const qty = Math.max(1, Math.round(quantity || 1));
  const sides: 1 | 2 = print.sides === 2 ? 2 : 1;
  const spot = colors.filter((c) => c === "spot").length;
  const flood = colors.length - spot;
  const mk = 1 + s.markup_pct / 100;

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
  };
}
