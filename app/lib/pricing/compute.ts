// app/lib/pricing/compute.ts
//
// Pure pricing computation — same logic as /api/quotes/calc but callable
// directly without HTTP. Used by send-quote and any other server-side code
// that needs pricing without the SSL/internal-fetch issues.

import { one, q } from "@/lib/db";
import { getPricingSettings } from "@/app/lib/pricing/settings";

type MaterialRow = {
  id: number;
  name: string;
  price_per_bf: number | null;
  kerf_waste_pct: number | null;
  min_charge_usd: number | null;
  price_per_cuin: number | null;
  cost_per_ci_usd: number | null;
  skiving_upcharge_pct: number | null;
  cutting_setup_fee_usd: number | null;
  thickness_in: number | null;
};

function cavityVolumeCi(s: string): number {
  const raw = s.trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (!raw) return 0;
  const roundMatch = raw.match(/^([øo0]?)(\d*\.?\d+)x(\d*\.?\d+)$/i);
  if (roundMatch && roundMatch[1]) {
    const dia = Number(roundMatch[2]);
    const depth = Number(roundMatch[3]);
    if (!Number.isFinite(dia) || !Number.isFinite(depth)) return 0;
    const radius = dia / 2;
    return Math.PI * radius * radius * depth;
  }
  const parts = raw.split("x").map((p) => Number(p));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts[0] * parts[1] * parts[2];
  }
  return 0;
}

function safeNum(v: any, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round2(v: number) { return Math.round(v * 100) / 100; }
function round4(v: number) { return Math.round(v * 10000) / 10000; }

export type CalcResult = {
  piece_ci: number;
  order_ci: number;
  order_ci_with_waste: number;
  price_per_ci: number;
  price_per_bf: number;
  min_charge: number;
  total: number;
  used_min_charge: boolean;
  kerf_pct: number;
  is_skived: boolean;
  material_name: string;
  material_family?: string | null;
  [key: string]: any;
};

export async function computePricing(params: {
  L: number;
  W: number;
  H: number;
  qty: number;
  material_id: number;
  cavities?: string[];
  force_skived?: boolean;
  tenant_id?: number | string | null;
}): Promise<CalcResult> {
  const { L, W, H, qty, material_id } = params;
  const cavitiesArr = Array.isArray(params.cavities) ? params.cavities : [];
  const force_skived = params.force_skived === true;

  const mat = await one<MaterialRow>(
    `SELECT id, name, price_per_bf, kerf_waste_pct, min_charge_usd,
            price_per_cuin, cost_per_ci_usd, skiving_upcharge_pct,
            cutting_setup_fee_usd, thickness_in
     FROM materials WHERE id = $1`,
    [material_id],
  );
  if (!mat) throw new Error(`material_not_found:${material_id}`);

  const settings = await getPricingSettings(params.tenant_id ?? "default");

  const piece_ci_raw = L * W * H;
  let cavities_ci = 0;
  for (const c of cavitiesArr) cavities_ci += cavityVolumeCi(c);
  const piece_ci = Math.max(piece_ci_raw - cavities_ci, 0);
  const order_ci = piece_ci * qty;

  const kerf_pct = mat.kerf_waste_pct != null
    ? safeNum(mat.kerf_waste_pct, 0)
    : safeNum(settings.kerf_pct_default, 10);
  const order_ci_with_waste = order_ci * (1 + kerf_pct / 100);

  const price_per_ci_direct = mat.price_per_cuin;
  const price_per_ci_from_bf = mat.price_per_bf != null ? Number(mat.price_per_bf) / 144 : null;
  const price_per_ci_from_cost = mat.cost_per_ci_usd != null ? Number(mat.cost_per_ci_usd) * 1.35 : null;
  const machineRate = safeNum(settings.machining_in3_per_min, 3000);
  const machineCostPerMin = safeNum(settings.machine_cost_per_min, 0.65);
  const price_per_ci_from_machine = machineRate > 0 ? machineCostPerMin / machineRate : null;
  const default_price_per_ci = settings.ratePerCI_default ||
    (settings.ratePerBF_default ? settings.ratePerBF_default / 144 : 0.02);

  const price_per_ci = (price_per_ci_direct as number | null) ??
    (price_per_ci_from_bf as number | null) ??
    (price_per_ci_from_cost as number | null) ??
    (price_per_ci_from_machine as number | null) ??
    default_price_per_ci;

  const price_per_bf = (mat.price_per_bf as number | null) ?? round2(price_per_ci * 144);

  const skive_pct = mat.skiving_upcharge_pct != null ? Number(mat.skiving_upcharge_pct) : 0;
  const skive_each_fallback = mat.skiving_upcharge_pct == null
    ? safeNum(settings.skive_upcharge_each, 0) : 0;
  const heightTriggersSkive = Math.abs(H - Math.round(H)) > 0.01;
  const is_skived = force_skived || heightTriggersSkive;

  const setup_fee = mat.cutting_setup_fee_usd != null ? Number(mat.cutting_setup_fee_usd) : 0;

  let raw_total = order_ci_with_waste * price_per_ci;
  if (is_skived && skive_pct > 0) {
    raw_total *= 1 + skive_pct / 100;
  } else if (is_skived && skive_each_fallback > 0) {
    raw_total += skive_each_fallback * qty;
  }
  raw_total += setup_fee;

  const markupFactor = typeof settings.markup_factor_default === "number" &&
    Number.isFinite(settings.markup_factor_default) &&
    settings.markup_factor_default > 0
    ? settings.markup_factor_default : 1;

  raw_total *= markupFactor;

  const min_charge_source = mat.min_charge_usd != null
    ? mat.min_charge_usd : settings.min_charge_default;
  const min_charge = safeNum(min_charge_source, 0);

  let total = raw_total;
  let used_min_charge = false;
  if (min_charge > 0 && total < min_charge) {
    total = min_charge;
    used_min_charge = true;
  }

  return {
    piece_ci: round4(piece_ci),
    order_ci: round4(order_ci),
    order_ci_with_waste: round4(order_ci_with_waste),
    price_per_ci: round4(price_per_ci),
    price_per_bf: round2(price_per_bf),
    min_charge: round2(min_charge),
    total: round2(total),
    used_min_charge,
    kerf_pct,
    is_skived,
    material_name: mat.name,
  };
}