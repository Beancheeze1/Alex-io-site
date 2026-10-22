// lib/corrugated-blank.ts
//
// Pure corrugated helpers (no DB, safe in the browser). Shared by the
// Admin -> Corrugated page (blank preview), lib/corrugated.ts (validation +
// seeding) and, in Step 2, the box pricing engine.
// Spec: "Custom Corrugated Box Pricing - Spec v1".

import type { BoxStyle, PartitionCells } from "./box-styles";

export type JointType = "glued" | "stitched" | "taped";

export const JOINT_TYPES: JointType[] = ["glued", "stitched", "taped"];

/** Round-up increments a shop can pick for blank dimensions (inches). */
export const ROUND_TO_OPTIONS = [0.0625, 0.125, 0.25] as const;

/** Per-flute caliper and scoring allowances, all in inches. */
export type FluteSpec = {
  flute: string; // "E", "B", "C", "BC", ...
  caliper_in: number;
  panel_allow_in: number; // added to each of the 4 panels
  last_panel_adj_in: number; // +/- on the panel next to the joint
  depth_allow_in: number; // added to the depth (score to score)
  flap_allow_in: number; // added to each flap
  glue_joint_in: number; // joint tab width (ignored when taped)
};

export type LayoutSettings = {
  joint_type: JointType;
  flap_pct: number; // flap size as % of W per flap; 50 = standard RSC
  round_to_in: number; // round blank length and width up to this
  edge_trim_in: number; // added to blank length and width
  waste_pct: number; // % added to board area
};

// Defaults: Chuck's calipers and joints; panel = 1 caliper,
// depth = 1 caliper, flap = 1/2 caliper per flap.
export const DEFAULT_FLUTES: FluteSpec[] = [
  { flute: "E", caliper_in: 0.0625, panel_allow_in: 0.0625, last_panel_adj_in: 0, depth_allow_in: 0.0625, flap_allow_in: 0.03125, glue_joint_in: 1.25 },
  { flute: "B", caliper_in: 0.125, panel_allow_in: 0.125, last_panel_adj_in: 0, depth_allow_in: 0.125, flap_allow_in: 0.0625, glue_joint_in: 1.375 },
  { flute: "C", caliper_in: 0.1875, panel_allow_in: 0.1875, last_panel_adj_in: 0, depth_allow_in: 0.1875, flap_allow_in: 0.09375, glue_joint_in: 1.375 },
  { flute: "BC", caliper_in: 0.3125, panel_allow_in: 0.3125, last_panel_adj_in: 0, depth_allow_in: 0.3125, flap_allow_in: 0.15625, glue_joint_in: 1.5 },
];

export const DEFAULT_LAYOUT: Omit<LayoutSettings, "waste_pct"> = {
  joint_type: "glued",
  flap_pct: 50,
  round_to_in: 0.0625,
  edge_trim_in: 0,
};

export type DefaultGrade = { name: string; flute: string; ect_label: string; is_default: boolean };

export const DEFAULT_GRADES: DefaultGrade[] = [
  { name: "32 ECT E", flute: "E", ect_label: "32 ECT", is_default: false },
  { name: "32 ECT C", flute: "C", ect_label: "32 ECT", is_default: true },
  { name: "44 ECT C", flute: "C", ect_label: "44 ECT", is_default: false },
  { name: "32 ECT B", flute: "B", ect_label: "32 ECT", is_default: false },
  { name: "44 ECT BC", flute: "BC", ect_label: "44 ECT", is_default: false },
  { name: "51 ECT BC", flute: "BC", ect_label: "51 ECT", is_default: false },
];

/** Run and print rates, in the order the admin page shows them. */
export const RATE_FIELDS = [
  { key: "waste_pct", label: "Trim / waste", unit: "% of board", max: 100, note: "Blank pricing: added to square footage. Sheet pricing: extra sheets for spoilage" },
  { key: "order_setup_usd", label: "Order setup (make-ready)", unit: "$ per order", max: 1000000, note: "Spread across the quantity" },
  { key: "converting_per_m", label: "Converting cost", unit: "$ per 1,000 boxes", max: 1000000, note: "Slotting, folding, gluing" },
  { key: "plate_spot_usd", label: "Plate cost — spot", unit: "$ per color", max: 1000000, note: "One-time; shown as its own line" },
  { key: "plate_flood_usd", label: "Plate cost — flood", unit: "$ per color", max: 1000000, note: "One-time; shown as its own line" },
  { key: "print_setup_per_color_usd", label: "Print setup", unit: "$ per color", max: 1000000, note: "Make-ready per color" },
  { key: "print_run_spot_per_m", label: "Print run — spot", unit: "$ per 1,000 per color", max: 1000000, note: "Ink + press time" },
  { key: "print_run_flood_per_m", label: "Print run — flood", unit: "$ per 1,000 per color", max: 1000000, note: "Ink + press time" },
  { key: "markup_pct", label: "Markup", unit: "%", max: 1000, note: "Applied to total cost, plates included" },
  { key: "min_order_usd", label: "Minimum order", unit: "$", max: 1000000, note: "Floor on boxes + plates" },
  // Step 15: short runs, digitally printed and CAD cut (no plates, no press).
  { key: "digital_under_qty", label: "Short-run cutoff", unit: "boxes", max: 1000000, note: "Quantities under this are digitally printed and CAD cut. 0 = off. Starts once the CAD table rate and speed are set." },
  { key: "cad_setup_usd", label: "CAD table setup", unit: "$ per order", max: 1000000, note: "Short runs: replaces order setup" },
  // Step 39A: CAD cut by time (was a flat $ per box).
  { key: "cad_cut_per_hr_usd", label: "CAD table rate", unit: "$ per hour", max: 1000000, note: "Short runs: replaces converting. Time = cut + score path ÷ table speed" },
  { key: "cad_speed_in_per_min", label: "CAD table speed", unit: "in per minute", max: 100000, note: "Average speed over cuts and scores, moves included" },
  { key: "digital_setup_usd", label: "Digital print setup", unit: "$ per order", max: 1000000, note: "File prep; printed short runs only" },
  { key: "digital_per_sqft_usd", label: "Digital print", unit: "$ per sq ft per side", max: 1000000, note: "Blank area, full color; no plates" },
  // Step 26: board bought as sheets from a corrugator (used when board_method = "sheet").
  { key: "sheet_trim_in", label: "Corrugator trim", unit: "in per sheet", max: 12, note: "Added to the sheet's length and width" },
  { key: "sheet_round_to_in", label: "Sheet size step", unit: "in", max: 12, note: "Sheet length and width round up to this, e.g. 0.125. 0 = exact" },
  { key: "sheet_max_length_in", label: "Largest sheet: length", unit: "in", max: 1000, note: "Along the blank's length. 0 = one blank per sheet" },
  { key: "sheet_max_width_in", label: "Largest sheet: width", unit: "in", max: 1000, note: "Along the blank's width. 0 = one blank per sheet" },
  { key: "sheet_max_up", label: "Most blanks per sheet", unit: "blanks", max: 50, note: "1 = one blank per sheet" },
  { key: "sheet_min_msf", label: "Corrugator minimum", unit: "MSF per order", max: 1000000, note: "Smaller orders are charged as this much board. 0 = none" },
  // Step 27: other styles (HSC and FOL use the RSC converting cost).
  { key: "diecut_per_m", label: "Die-cut converting", unit: "$ per 1,000 boxes", max: 1000000, note: "Mailers and trays: press, stripping, folding/gluing" },
  { key: "die_base_usd", label: "Cutting die: base", unit: "$ per die", max: 1000000, note: "One-time; shown as its own line. Not charged on digital short runs" },
  { key: "die_per_in_usd", label: "Cutting die: rule", unit: "$ per inch of rule", max: 10000, note: "Rule length is estimated from the blank (cuts + scores)" },
  { key: "pad_per_m", label: "Pad cutting", unit: "$ per 1,000 pads", max: 1000000, note: "Pads / sheets" },
  { key: "partition_per_m", label: "Partition slotting + assembly", unit: "$ per 1,000 sets", max: 1000000, note: "Partition sets" },
  // Step 39D: displays and multi-part jobs (assembly + packing). All optional; 0 = not used.
  { key: "asm_per_display_usd", label: "Assembly per display", unit: "$ per display", max: 1000000, note: "A flat charge for each finished display" },
  { key: "asm_per_part_usd", label: "Assembly per part", unit: "$ per part", max: 1000000, note: "For each part that goes into a display" },
  { key: "labor_per_hr_usd", label: "Labor rate", unit: "$ per hour", max: 1000000, note: "Used with the labor minutes below" },
  { key: "labor_min_per_display", label: "Labor time per display", unit: "minutes", max: 100000, note: "Base handling / setup time for each display" },
  { key: "labor_min_per_part", label: "Labor time per part", unit: "minutes", max: 100000, note: "Folding, gluing and fitting each part" },
  { key: "kit_per_display_usd", label: "Kitting / packing", unit: "$ per display", max: 1000000, note: "Bagging, banding or packing each display to ship" },
] as const;

/** Step 39D: the rate fields shown under "Displays and multi-part jobs" on the admin page. */
export const DISPLAY_KEYS: ReadonlySet<string> = new Set([
  "asm_per_display_usd",
  "asm_per_part_usd",
  "labor_per_hr_usd",
  "labor_min_per_display",
  "labor_min_per_part",
  "kit_per_display_usd",
]);

/** Step 27: the rate fields shown under "Other box styles" on the admin page. */
export const STYLE_RATE_KEYS: ReadonlySet<string> = new Set([
  "diecut_per_m",
  "die_base_usd",
  "die_per_in_usd",
  "pad_per_m",
  "partition_per_m",
]);

/** Step 26: the rate fields shown under "Board bought as sheets" on the admin page. */
export const SHEET_KEYS: ReadonlySet<string> = new Set([
  "sheet_trim_in",
  "sheet_round_to_in",
  "sheet_max_length_in",
  "sheet_max_width_in",
  "sheet_max_up",
  "sheet_min_msf",
]);

/**
 * Step 26: how board is costed.
 *   "blank" = blank sq ft x (1 + waste %) x $/MSF (Steps 1-25, the default)
 *   "sheet" = sheets bought from the corrugator: sheet sq ft x sheets x $/MSF,
 *             several blanks per sheet when they fit, waste % = spoilage sheets,
 *             and the corrugator's minimum MSF per order.
 */
export type BoardMethod = "blank" | "sheet";

export function parseBoardMethod(raw: unknown): BoardMethod {
  return raw === "sheet" ? "sheet" : "blank";
}

/** Step 15: the rate fields shown under "Short runs" on the admin page. */
export const SHORT_RUN_KEYS: ReadonlySet<string> = new Set([
  "digital_under_qty",
  "cad_setup_usd",
  "cad_cut_per_hr_usd",
  "cad_speed_in_per_min",
  "digital_setup_usd",
  "digital_per_sqft_usd",
]);

export type RateKey = (typeof RATE_FIELDS)[number]["key"];
export type CorrugatedRates = Record<RateKey, number>;

export type BlankResult = {
  raw_length_in: number; // before rounding
  raw_width_in: number;
  length_in: number; // rounded up to the shop's increment
  width_in: number;
  sqft_each: number; // blank area, no waste
  sqft_each_with_waste: number; // also = MSF per 1,000 boxes
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function roundUp(x: number, inc: number): number {
  if (!(inc > 0)) return x;
  return Math.ceil(x / inc - 1e-9) * inc;
}

/**
 * RSC blank from inside dimensions (inches) and the shop's settings.
 *   length = 2L + 2W + 4a + p + j + t   (j = 0 when taped)
 *   width  = D + d + 2(sW + f) + t
 * then both rounded up to the shop's increment.
 */
export function computeRscBlank(
  dims: { L: number; W: number; D: number },
  flute: FluteSpec,
  layout: LayoutSettings,
): BlankResult {
  const { L, W, D } = dims;
  const j = layout.joint_type === "taped" ? 0 : flute.glue_joint_in;
  const s = layout.flap_pct / 100;
  const t = layout.edge_trim_in;

  const raw_length_in = 2 * L + 2 * W + 4 * flute.panel_allow_in + flute.last_panel_adj_in + j + t;
  const raw_width_in = D + flute.depth_allow_in + 2 * (s * W + flute.flap_allow_in) + t;

  const length_in = roundUp(raw_length_in, layout.round_to_in);
  const width_in = roundUp(raw_width_in, layout.round_to_in);

  const sqft_each = (length_in * width_in) / 144;
  const sqft_each_with_waste = sqft_each * (1 + layout.waste_pct / 100);

  return { raw_length_in, raw_width_in, length_in, width_in, sqft_each, sqft_each_with_waste };
}

export type BlankPiece = { label: string; length_in: number; width_in: number; count: number };

export type StyleBlank = BlankResult & {
  style: BoxStyle;
  pieces: BlankPiece[]; // one per box, except partitions (strips per set)
  pieces_per_box: number; // total pieces in one box / set
  rule_in: number; // cutting-die rule estimate (die-cut styles), 0 otherwise
  cad_path_in: number; // Step 39A: CAD table cut + score path for one box / set (every style)
};

/**
 * Step 27: the blank (or, for partitions, the strips) for any style, from
 * inside dims in inches. a = the flute's panel allowance, t = edge trim, s =
 * flap %. Every size is rounded up to the shop's increment.
 *   rsc        computeRscBlank
 *   hsc        as RSC, one set of flaps: width = D + d + (sW + f) + t
 *   fol        as RSC, full-width flaps: width = D + d + 2(W + f) + t
 *   pad        L + t by W + t (no depth)
 *   tray       (L + 2D + 2a + t) by (W + 2D + 2a + t); corners become the lock ears
 *   mailer     roll-end tuck front (FEFCO 0427 style):
 *                length = L + 4D + 4a + t      (double side walls)
 *                width  = 2W + 3D + tuck + 6a + t, tuck = min(D, 2)
 *   partition  (down - 1) strips L x D and (across - 1) strips W x D
 * Die rule (estimate, for the cutting-die charge):
 *   tray   = blank perimeter + 2(L + W) base scores + 4D corner slits
 *   mailer = blank perimeter + 5L + 4W + 8D (fold scores + dust-flap cuts)
 * CAD table path (Step 39A, short runs): mailer / tray = the die rule above;
 *   rsc / fol = outline + 6 flap slots + 2 flap scores + 4 panel scores;
 *   hsc = outline + 3 slots + 1 flap score + 4 panel scores; pad = outline;
 *   partition = each strip's outline + half-depth slots at each crossing.
 * These are estimating formulas: check the blank preview against a box you run.
 */
export function computeStyleBlank(
  style: BoxStyle,
  dims: { L: number; W: number; D: number },
  flute: FluteSpec,
  layout: LayoutSettings,
  cells?: PartitionCells | null,
): StyleBlank {
  const { L, W, D } = dims;
  const a = flute.panel_allow_in;
  const t = layout.edge_trim_in;
  const inc = layout.round_to_in;
  const waste = 1 + layout.waste_pct / 100;
  // Step 39A: cad = the CAD table path (cuts + scores) for one blank; null = same as the die rule.
  const one = (rawL: number, rawW: number, rule: number, label = "Blank", cad: number | null = null): StyleBlank => {
    const length_in = roundUp(rawL, inc);
    const width_in = roundUp(rawW, inc);
    const sqft_each = (length_in * width_in) / 144;
    return {
      style,
      raw_length_in: rawL,
      raw_width_in: rawW,
      length_in,
      width_in,
      sqft_each,
      sqft_each_with_waste: sqft_each * waste,
      pieces: [{ label, length_in, width_in, count: 1 }],
      pieces_per_box: 1,
      rule_in: rule,
      cad_path_in: r1(cad ?? rule),
    };
  };

  if (style === "rsc" || style === "hsc" || style === "fol") {
    const rsc = computeRscBlank(dims, flute, layout);
    // Step 39A: CAD path = blank outline + flap slots (one per panel line, per
    // flap side) + the flap score(s) along the blank + the panel scores
    // (3 panel lines + the joint) across the depth.
    const panelD = D + flute.depth_allow_in;
    const slotsAndScores = (bl: number, bw: number, flapSides: 1 | 2) => {
      const flap = Math.max(0, (bw - panelD) / flapSides);
      return 2 * (bl + bw) + 3 * flapSides * flap + flapSides * bl + 4 * panelD;
    };
    if (style === "rsc") {
      return {
        ...rsc,
        style,
        pieces: [{ label: "Blank", length_in: rsc.length_in, width_in: rsc.width_in, count: 1 }],
        pieces_per_box: 1,
        rule_in: 0,
        cad_path_in: r1(slotsAndScores(rsc.length_in, rsc.width_in, 2)),
      };
    }
    const s = layout.flap_pct / 100;
    const rawW =
      style === "hsc"
        ? D + flute.depth_allow_in + (s * W + flute.flap_allow_in) + t
        : D + flute.depth_allow_in + 2 * (W + flute.flap_allow_in) + t;
    const bl = roundUp(rsc.raw_length_in, inc);
    const bw = roundUp(rawW, inc);
    return one(rsc.raw_length_in, rawW, 0, "Blank", slotsAndScores(bl, bw, style === "hsc" ? 1 : 2));
  }
  if (style === "pad") return one(L + t, W + t, 0, "Pad", 2 * (roundUp(L + t, inc) + roundUp(W + t, inc)));
  // Step 39C: a die line needs its measured file (dielineStyleBlank); with
  // only a size, treat it as a flat blank with no rule.
  if (style === "dieline") return one(L + t, W + t, 0, "Blank", 2 * (roundUp(L + t, inc) + roundUp(W + t, inc)));
  if (style === "tray") {
    const bl = roundUp(L + 2 * D + 2 * a + t, inc);
    const bw = roundUp(W + 2 * D + 2 * a + t, inc);
    return one(L + 2 * D + 2 * a + t, W + 2 * D + 2 * a + t, 2 * (bl + bw) + 2 * (L + W) + 4 * D);
  }
  if (style === "mailer") {
    const tuck = Math.min(D, 2);
    const rawL = L + 4 * D + 4 * a + t;
    const rawW = 2 * W + 3 * D + tuck + 6 * a + t;
    const bl = roundUp(rawL, inc);
    const bw = roundUp(rawW, inc);
    return one(rawL, rawW, 2 * (bl + bw) + 5 * L + 4 * W + 8 * D);
  }

  // partition
  const c = cells ?? { across: 1, down: 1 };
  const pieces: BlankPiece[] = [];
  if (c.down > 1) pieces.push({ label: "Long strips", length_in: roundUp(L + t, inc), width_in: roundUp(D + t, inc), count: c.down - 1 });
  if (c.across > 1) pieces.push({ label: "Short strips", length_in: roundUp(W + t, inc), width_in: roundUp(D + t, inc), count: c.across - 1 });
  const sqft_each = pieces.reduce((sum, p) => sum + (p.length_in * p.width_in * p.count) / 144, 0);
  const first = pieces[0] ?? { length_in: 0, width_in: 0 };
  // Step 39A: CAD path per set = each strip's outline + its half-depth slots
  // (one per crossing strip).
  const cadPath = pieces.reduce((sum, p) => {
    const crossings = p.label === "Long strips" ? c.across - 1 : c.down - 1;
    return sum + p.count * (2 * (p.length_in + p.width_in) + Math.max(0, crossings) * (D / 2));
  }, 0);
  return {
    style,
    raw_length_in: L + t,
    raw_width_in: D + t,
    length_in: first.length_in,
    width_in: first.width_in,
    sqft_each,
    sqft_each_with_waste: sqft_each * waste,
    pieces,
    pieces_per_box: pieces.reduce((n, p) => n + p.count, 0),
    rule_in: 0,
    cad_path_in: r1(cadPath),
  };
}

/**
 * Step 39C: the blank for a die line measured from a file (lib/dieline-import):
 * the file's blank + edge trim, rounded up to the shop's increment. The die
 * rule and the CAD table path are the file's cut + crease + perf inches.
 */
export function dielineStyleBlank(
  d: { length_in: number; width_in: number; rule_in: number },
  layout: { round_to_in: number; edge_trim_in: number; waste_pct: number },
): StyleBlank {
  const t = Number(layout.edge_trim_in) || 0;
  const rawL = d.length_in + t;
  const rawW = d.width_in + t;
  const length_in = roundUp(rawL, layout.round_to_in);
  const width_in = roundUp(rawW, layout.round_to_in);
  const sqft_each = (length_in * width_in) / 144;
  return {
    style: "dieline",
    raw_length_in: rawL,
    raw_width_in: rawW,
    length_in,
    width_in,
    sqft_each,
    sqft_each_with_waste: sqft_each * (1 + (Number(layout.waste_pct) || 0) / 100),
    pieces: [{ label: "Blank", length_in, width_in, count: 1 }],
    pieces_per_box: 1,
    rule_in: d.rule_in,
    cad_path_in: r1(d.rule_in),
  };
}

export type SheetSettings = {
  sheet_trim_in: number;
  sheet_round_to_in: number;
  sheet_max_length_in: number;
  sheet_max_width_in: number;
  sheet_max_up: number;
};

export type SheetResult = {
  up: number; // blanks per sheet
  across_length: number; // blanks side by side along the blank's length
  across_width: number; // rows along the blank's width
  length_in: number; // sheet size, trimmed and rounded
  width_in: number;
  sqft: number; // per sheet
  sqft_per_box: number; // sheet sq ft / up
  oversize: boolean; // one blank (+ trim) is bigger than the largest sheet
};

/**
 * Step 26: the sheet a shop buys for a blank. Blanks are laid out in a grid,
 * all the same way round (flute direction never turns), as many as fit the
 * largest sheet, up to the shop's most-blanks-per-sheet. Ties go to the
 * smaller sheet. With no largest sheet set, one blank per sheet.
 *   sheet length = across_length x blank length + trim, rounded up
 *   sheet width  = across_width  x blank width  + trim, rounded up
 */
export function computeSheet(blank: { length_in: number; width_in: number }, s: SheetSettings): SheetResult {
  const bl = blank.length_in;
  const bw = blank.width_in;
  const trim = Math.max(0, Number(s.sheet_trim_in) || 0);
  const step = Math.max(0, Number(s.sheet_round_to_in) || 0);
  const maxL = Math.max(0, Number(s.sheet_max_length_in) || 0);
  const maxW = Math.max(0, Number(s.sheet_max_width_in) || 0);
  const maxUp = Math.max(1, Math.round(Number(s.sheet_max_up) || 1));
  const size = (a: number, b: number) => ({
    length_in: roundUp(a * bl + trim, step),
    width_in: roundUp(b * bw + trim, step),
  });

  let best = { a: 1, b: 1, ...size(1, 1) };
  let oversize = false;
  if (maxL > 0 && maxW > 0) {
    const one = size(1, 1);
    oversize = one.length_in > maxL + 1e-9 || one.width_in > maxW + 1e-9;
    if (!oversize) {
      for (let a = 1; a <= maxUp; a++) {
        for (let b = 1; a * b <= maxUp; b++) {
          const sz = size(a, b);
          if (sz.length_in > maxL + 1e-9 || sz.width_in > maxW + 1e-9) continue;
          const better =
            a * b > best.a * best.b ||
            (a * b === best.a * best.b && sz.length_in * sz.width_in < best.length_in * best.width_in - 1e-9);
          if (better) best = { a, b, ...sz };
        }
      }
    }
  }
  const up = best.a * best.b;
  const sqft = (best.length_in * best.width_in) / 144;
  return {
    up,
    across_length: best.a,
    across_width: best.b,
    length_in: best.length_in,
    width_in: best.width_in,
    sqft,
    sqft_per_box: sqft / up,
    oversize,
  };
}

/** "1 3/8", "1-3/8", "3/16", "-1/16", "0.1875", "2" -> inches. Invalid -> null. */
export function parseInches(raw: string): number | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/(["”]|in\.?)$/i, "")
    .trim();
  if (!s) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1).trim() : s;

  let v: number | null = null;
  let m: RegExpMatchArray | null = body.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const d = Number(m[3]);
    if (d > 0) v = Number(m[1]) + Number(m[2]) / d;
  } else if ((m = body.match(/^(\d+)\s*\/\s*(\d+)$/))) {
    const d = Number(m[2]);
    if (d > 0) v = Number(m[1]) / d;
  } else if (/^(\d+\.?\d*|\.\d+)$/.test(body)) {
    v = Number(body);
  }

  if (v === null || !Number.isFinite(v)) return null;
  return neg ? -v : v;
}

/** Inches -> "1 3/8" when it is an exact 1/32, else a decimal (max 4 places). */
export function formatInches(n: number): string {
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  const a = Math.abs(n);
  const t32 = Math.round(a * 32);
  if (Math.abs(a * 32 - t32) > 1e-6) return (neg ? "-" : "") + String(Number(a.toFixed(4)));
  const whole = Math.floor(t32 / 32);
  let num = t32 % 32;
  let den = 32;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const frac = num ? `${num}/${den}` : "";
  const out = whole && frac ? `${whole} ${frac}` : whole ? String(whole) : frac || "0";
  return (neg && out !== "0" ? "-" : "") + out;
}
