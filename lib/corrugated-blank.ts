// lib/corrugated-blank.ts
//
// Pure corrugated helpers (no DB, safe in the browser). Shared by the
// Admin -> Corrugated page (blank preview), lib/corrugated.ts (validation +
// seeding) and, in Step 2, the box pricing engine.
// Spec: "Custom Corrugated Box Pricing - Spec v1".

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
  { key: "waste_pct", label: "Trim / waste", unit: "% of board", max: 100, note: "Added to square footage" },
  { key: "order_setup_usd", label: "Order setup (make-ready)", unit: "$ per order", max: 1000000, note: "Spread across the quantity" },
  { key: "converting_per_m", label: "Converting cost", unit: "$ per 1,000 boxes", max: 1000000, note: "Slotting, folding, gluing" },
  { key: "plate_spot_usd", label: "Plate cost — spot", unit: "$ per color", max: 1000000, note: "One-time; shown as its own line" },
  { key: "plate_flood_usd", label: "Plate cost — flood", unit: "$ per color", max: 1000000, note: "One-time; shown as its own line" },
  { key: "print_setup_per_color_usd", label: "Print setup", unit: "$ per color", max: 1000000, note: "Make-ready per color" },
  { key: "print_run_spot_per_m", label: "Print run — spot", unit: "$ per 1,000 per color", max: 1000000, note: "Ink + press time" },
  { key: "print_run_flood_per_m", label: "Print run — flood", unit: "$ per 1,000 per color", max: 1000000, note: "Ink + press time" },
  { key: "markup_pct", label: "Markup", unit: "%", max: 1000, note: "Applied to total cost, plates included" },
  { key: "min_order_usd", label: "Minimum order", unit: "$", max: 1000000, note: "Floor on boxes + plates" },
] as const;

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
