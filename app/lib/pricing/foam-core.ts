// app/lib/pricing/foam-core.ts
//
// Step 22: the ONE foam price formula. Pure (no DB, no fetch), so the
// calc route (/api/quotes/calc), computePricing() (send-quote) and the
// foam test script (npm run test:foam) all run exactly the same math.
//
// total = max( markup × ( material + skive + setup ), minimum charge )
//
//   material  = order volume with waste × price per cu in
//               (round_to_bf: volume with waste rounded UP to the next
//               quarter board foot × price per board foot)
//   order volume = (L×W×H − cavities) × qty; waste = kerf % (material, else shop)
//   price per cu in, first that is > 0:
//     1. material price_per_cuin            (catalog, or the shop's own price)
//     2. material price_per_bf / 144
//     3. material cost_per_ci_usd           (marked up by the shop markup only)
//     4. unpriced: the shop's default rate (ratePerCI_default, else
//        ratePerBF_default / 144) and needs_review = true
//   skive (height not a whole inch, or forced): material % upcharge on the
//     material + skive line, else the shop's flat $ per piece
//   setup     = material cutting_setup_fee_usd (once per order)
//   markup    = shop markup_factor_default (1 if missing / invalid)
//   minimum   = material min_charge_usd, else shop min_charge_default (per order)

export type FoamMaterial = {
  name: string;
  price_per_cuin: number | string | null;
  price_per_bf: number | string | null;
  cost_per_ci_usd: number | string | null;
  kerf_waste_pct: number | string | null;
  min_charge_usd: number | string | null;
  skiving_upcharge_pct: number | string | null;
  cutting_setup_fee_usd: number | string | null;
};

export type FoamSettings = {
  ratePerCI_default?: number | null;
  ratePerBF_default?: number | null;
  kerf_pct_default?: number | null;
  min_charge_default?: number | null;
  skive_upcharge_each?: number | null;
  markup_factor_default?: number | null;
};

export type FoamInput = {
  L: number;
  W: number;
  H: number;
  qty: number;
  cavities?: string[] | null;
  // Step 23: cavity volume per piece already worked out from the saved layout
  // (app/lib/pricing/foam-geometry.ts). Added to any `cavities` strings.
  cavity_ci?: number | null;
  round_to_bf?: boolean;
  force_skived?: boolean;
};

export type PriceSource = "price_per_cuin" | "price_per_bf" | "cost" | "shop_default";

export type FoamPrice = {
  piece_ci: number;
  order_ci: number;
  order_ci_with_waste: number;
  price_per_ci: number;
  price_per_bf: number;
  price_source: PriceSource;
  min_charge: number;
  total: number;
  used_min_charge: boolean;
  kerf_pct: number;
  is_skived: boolean;
  skive_pct: number;
  skive_each_fallback: number;
  setup_fee: number;
  cavities_ci: number;
  piece_ci_raw: number;
  material_name: string;
  markup_factor: number;
  board_feet_rounded: number | null;
  needs_review: boolean;
  review_reason: string | null;
};

const FALLBACK_RATE_PER_CI = 0.06;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function positive(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}
export function round2(v: number) {
  return Math.round(v * 100) / 100;
}
export function round4(v: number) {
  return Math.round(v * 10000) / 10000;
}

/** Cavity strings like "2x3x0.5" (L×W×depth) or "Ø6x1" (diameter × depth) → cubic inches. */
export function cavityVolumeCi(s: string): number {
  const raw = String(s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (!raw) return 0;
  const round = raw.match(/^([øo0]?)(\d*\.?\d+)x(\d*\.?\d+)$/i);
  if (round && round[1]) {
    const dia = Number(round[2]);
    const depth = Number(round[3]);
    if (!Number.isFinite(dia) || !Number.isFinite(depth)) return 0;
    return Math.PI * (dia / 2) * (dia / 2) * depth;
  }
  const p = raw.split("x").map((x) => Number(x));
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? p[0] * p[1] * p[2] : 0;
}

export function priceFoam(mat: FoamMaterial, settings: FoamSettings, input: FoamInput): FoamPrice {
  const { L, W, H, qty } = input;
  const cavities = Array.isArray(input.cavities) ? input.cavities : [];

  // Volumes
  const piece_ci_raw = L * W * H;
  let cavities_ci = 0;
  for (const c of cavities) cavities_ci += cavityVolumeCi(String(c));
  const cavCiIn = Number(input.cavity_ci);
  if (Number.isFinite(cavCiIn) && cavCiIn > 0) cavities_ci += cavCiIn;
  const piece_ci = Math.max(piece_ci_raw - cavities_ci, 0);
  const order_ci = piece_ci * qty;

  // Waste (kerf): material first, then the shop default (0 when unset)
  const kerf_pct = num(mat.kerf_waste_pct) ?? num(settings.kerf_pct_default) ?? 0;
  const order_ci_with_waste = order_ci * (1 + kerf_pct / 100);

  // Price per cubic inch
  let price_source: PriceSource;
  let price_per_ci: number;
  const direct = positive(mat.price_per_cuin);
  const perBf = positive(mat.price_per_bf);
  const cost = positive(mat.cost_per_ci_usd);
  if (direct != null) {
    price_per_ci = direct;
    price_source = "price_per_cuin";
  } else if (perBf != null) {
    price_per_ci = perBf / 144;
    price_source = "price_per_bf";
  } else if (cost != null) {
    // Step 22: cost is marked up by the shop markup only (the hidden ×1.35 is gone).
    price_per_ci = cost;
    price_source = "cost";
  } else {
    const ci = positive(settings.ratePerCI_default);
    const bf = positive(settings.ratePerBF_default);
    price_per_ci = ci ?? (bf != null ? bf / 144 : FALLBACK_RATE_PER_CI);
    price_source = "shop_default";
  }
  // Step 23: per board foot always matches the rate actually charged (a
  // stale stored $/bf no longer leaks into round_to_bf when $/cu in is set).
  const price_per_bf = price_source === "price_per_bf" && perBf != null ? perBf : round2(price_per_ci * 144);

  // Skiving
  const skive_pct = num(mat.skiving_upcharge_pct) ?? 0;
  const skive_each_fallback = num(mat.skiving_upcharge_pct) == null ? num(settings.skive_upcharge_each) ?? 0 : 0;
  const is_skived = input.force_skived === true || Math.abs(H - Math.round(H)) > 0.01;

  const setup_fee = num(mat.cutting_setup_fee_usd) ?? 0;

  // Material line (optionally rounded up to quarter board feet)
  let board_feet_rounded: number | null = null;
  let raw: number;
  if (input.round_to_bf) {
    board_feet_rounded = Math.ceil((order_ci_with_waste / 144) * 4) / 4;
    raw = board_feet_rounded * price_per_bf;
  } else {
    raw = order_ci_with_waste * price_per_ci;
  }

  // Step 22: skive and setup are added in both modes (round_to_bf used to drop them).
  if (is_skived && skive_pct > 0) raw *= 1 + skive_pct / 100;
  else if (is_skived && skive_each_fallback > 0) raw += skive_each_fallback * qty;
  raw += setup_fee;

  const m = num(settings.markup_factor_default);
  const markup_factor = m != null && m > 0 ? m : 1;
  raw *= markup_factor;

  const min_charge = num(mat.min_charge_usd) ?? num(settings.min_charge_default) ?? 0;
  let total = raw;
  let used_min_charge = false;
  if (min_charge > 0 && total < min_charge) {
    total = min_charge;
    used_min_charge = true;
  }

  const needs_review = price_source === "shop_default";

  return {
    piece_ci: round4(piece_ci),
    order_ci: round4(order_ci),
    order_ci_with_waste: round4(order_ci_with_waste),
    price_per_ci: round4(price_per_ci),
    price_per_bf: round2(price_per_bf),
    price_source,
    min_charge: round2(min_charge),
    total: round2(total),
    used_min_charge,
    kerf_pct,
    is_skived,
    skive_pct,
    skive_each_fallback: round2(skive_each_fallback),
    setup_fee: round2(setup_fee),
    cavities_ci: round4(cavities_ci),
    piece_ci_raw: round4(piece_ci_raw),
    material_name: mat.name,
    markup_factor: round4(markup_factor),
    board_feet_rounded,
    needs_review,
    review_reason: needs_review
      ? "This material has no price, so it was priced at the shop's default rate. Set its price on Materials, then reprice."
      : null,
  };
}
