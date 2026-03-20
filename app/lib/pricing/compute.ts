//
// Centralized pricing breakdown calculator (non-destructive).
// Pure functions only — no DB writes, no side effects.
//
// This produces a breakdown object consumed by:
//  - /api/quote/print (to attach pricing_breakdown)
//  - QuotePrintClient (for customer-facing pricing card)
//  - quoteTemplate.ts (for email pricing details)
//  - AdminQuoteClient (more detailed view)
//
// Formulas are simple v1 and can be upgraded later.
//
// ------------------------------------------------------------

export type PricingBreakdown = {
  volumeIn3: number;
  materialWeightLb: number;
  materialCost: number;
  machineMinutes: number;
  machineCost: number;
  rawCost: number;
  markupFactor: number;
  sellPrice: number;
  unitPrice: number;
  extendedPrice: number;
  qty: number;

  // Suggested price breaks
  breaks: {
    qty: number;
    unit: number;
    total: number;
  }[];
};

/* ---------- Shared pricing settings (mirrors /api/admin/settings) ---------- */

const SETTINGS_KEY = "__ALEXIO_PRICING_SETTINGS__";

type PricingSettings = {
  ratePerCI_default: number;
  ratePerBF_default: number;
  kerf_pct_default: number;
  min_charge_default: number;
  skive_upcharge_each: number;
  cushion_family_order?: string[];
  machining_in3_per_min?: number;
  machine_cost_per_min?: number;
  markup_factor_default?: number;
};

function getPricingSettings(): PricingSettings {
  const g = globalThis as any;
  if (!g[SETTINGS_KEY]) {
    g[SETTINGS_KEY] = {
      ratePerCI_default: 0.06,
      ratePerBF_default: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      skive_upcharge_each: 4.5,
      cushion_family_order: ["EPE", "PU", "PE", "EVA"],
      machining_in3_per_min: 3000,
      machine_cost_per_min: 0.65,
      markup_factor_default: 1.45,
    } as PricingSettings;
  }
  return g[SETTINGS_KEY] as PricingSettings;
}

/* ---------- Fallbacks if settings are missing ---------- */

const FALLBACK_MACHINE_RATE_IN3_PER_MIN = 3000; // in³ per minute
const FALLBACK_MACHINE_COST_PER_MIN = 0.65; // USD per minute
const FALLBACK_MARKUP = 1.45; // 45% markup baseline

export function computePricingBreakdown(args: {
  length_in: number;
  width_in: number;
  height_in: number;
  density_lbft3: number;
  cost_per_lb: number;
  qty: number;
  markupFactor?: number;
}): PricingBreakdown {
  const settings = getPricingSettings();

  const machineRate =
    typeof settings.machining_in3_per_min === "number" &&
    settings.machining_in3_per_min > 0
      ? settings.machining_in3_per_min
      : FALLBACK_MACHINE_RATE_IN3_PER_MIN;

  const machineCostPerMin =
    typeof settings.machine_cost_per_min === "number" &&
    settings.machine_cost_per_min > 0
      ? settings.machine_cost_per_min
      : FALLBACK_MACHINE_COST_PER_MIN;

  const defaultMarkup =
    typeof settings.markup_factor_default === "number" &&
    settings.markup_factor_default > 0
      ? settings.markup_factor_default
      : FALLBACK_MARKUP;

  const L = Number(args.length_in);
  const W = Number(args.width_in);
  const H = Number(args.height_in);
  const qty = Number(args.qty);
  const density = Number(args.density_lbft3);
  const costPerLb = Number(args.cost_per_lb);
  const markup = Number(args.markupFactor ?? defaultMarkup);

  const volumeIn3 = L * W * H;
  const densityLbIn3 = density / 1728; // convert ft³ to in³
  const materialWeightLb = volumeIn3 * densityLbIn3;
  const materialCost = materialWeightLb * costPerLb;

  const machineMinutes = volumeIn3 / machineRate;
  const machineCost = machineMinutes * machineCostPerMin;

  const rawCost = materialCost + machineCost;
  const sellPrice = rawCost * markup;

  const unitPrice = sellPrice;
  const extendedPrice = unitPrice * qty;

  // New ladder: 1, 10, 25, 50, 100, 150, 250
  const breakQtys = [1, 10, 25, 50, 100, 150, 250];

  const breaks = breakQtys.map((bq) => {
    const bTotal = unitPrice * bq;
    return {
      qty: bq,
      unit: unitPrice,
      total: bTotal,
    };
  });

  return {
    volumeIn3,
    materialWeightLb,
    materialCost,
    machineMinutes,
    machineCost,
    rawCost,
    markupFactor: markup,
    sellPrice,
    unitPrice,
    extendedPrice,
    qty,
    breaks,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// computePricing — async DB-backed pricing (same logic as /api/quotes/calc).
// Used by send-quote/route.ts to avoid internal HTTP fetch SSL issues.
// ─────────────────────────────────────────────────────────────────────────────

import { one } from "@/lib/db";
import { getPricingSettings as getPricingSettingsAsync } from "@/app/lib/pricing/settings";

type MaterialRowAsync = {
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

function cavVolCi(s: string): number {
  const raw = s.trim().toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (!raw) return 0;
  const rm = raw.match(/^([øo0]?)(\d*\.?\d+)x(\d*\.?\d+)$/i);
  if (rm && rm[1]) {
    const r = Number(rm[2]) / 2, d = Number(rm[3]);
    return Number.isFinite(r) && Number.isFinite(d) ? Math.PI * r * r * d : 0;
  }
  const p = raw.split("x").map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? p[0] * p[1] * p[2] : 0;
}
function sn(v: any, fb: number) { const n = Number(v); return Number.isFinite(n) ? n : fb; }
function r2(v: number) { return Math.round(v * 100) / 100; }
function r4(v: number) { return Math.round(v * 10000) / 10000; }

export type CalcResult = {
  piece_ci: number; order_ci: number; order_ci_with_waste: number;
  price_per_ci: number; price_per_bf: number; min_charge: number;
  total: number; used_min_charge: boolean; kerf_pct: number;
  is_skived: boolean; material_name: string; [key: string]: any;
};

export async function computePricing(params: {
  L: number; W: number; H: number; qty: number; material_id: number;
  cavities?: string[]; force_skived?: boolean; tenant_id?: number | string | null;
}): Promise<CalcResult> {
  const { L, W, H, qty, material_id } = params;
  const cavs = Array.isArray(params.cavities) ? params.cavities : [];
  const forceSkived = params.force_skived === true;

  const mat = await one<MaterialRowAsync>(
    `SELECT id, name, price_per_bf, kerf_waste_pct, min_charge_usd,
            price_per_cuin, cost_per_ci_usd, skiving_upcharge_pct,
            cutting_setup_fee_usd, thickness_in
     FROM materials WHERE id = $1`,
    [material_id],
  );
  if (!mat) throw new Error(`material_not_found:${material_id}`);

  const settings = await getPricingSettingsAsync(params.tenant_id ?? "default");

  let cav_ci = 0;
  for (const c of cavs) cav_ci += cavVolCi(c);
  const piece_ci = Math.max(L * W * H - cav_ci, 0);
  const order_ci = piece_ci * qty;
  const kerf_pct = mat.kerf_waste_pct != null ? sn(mat.kerf_waste_pct, 0) : sn(settings.kerf_pct_default, 10);
  const order_ci_with_waste = order_ci * (1 + kerf_pct / 100);

  const pci = (mat.price_per_cuin as number | null)
    ?? (mat.price_per_bf != null ? Number(mat.price_per_bf) / 144 : null)
    ?? (mat.cost_per_ci_usd != null ? Number(mat.cost_per_ci_usd) * 1.35 : null)
    ?? (settings.machining_in3_per_min > 0 ? settings.machine_cost_per_min / settings.machining_in3_per_min : null)
    ?? (settings.ratePerCI_default || (settings.ratePerBF_default ? settings.ratePerBF_default / 144 : 0.02));

  const price_per_bf = (mat.price_per_bf as number | null) ?? r2(pci * 144);
  const skive_pct = mat.skiving_upcharge_pct != null ? Number(mat.skiving_upcharge_pct) : 0;
  const skive_each = mat.skiving_upcharge_pct == null ? sn(settings.skive_upcharge_each, 0) : 0;
  const is_skived = forceSkived || Math.abs(H - Math.round(H)) > 0.01;
  const setup_fee = mat.cutting_setup_fee_usd != null ? Number(mat.cutting_setup_fee_usd) : 0;

  let raw = order_ci_with_waste * pci;
  if (is_skived && skive_pct > 0) raw *= 1 + skive_pct / 100;
  else if (is_skived && skive_each > 0) raw += skive_each * qty;
  raw += setup_fee;

  const markup = (typeof settings.markup_factor_default === "number" && settings.markup_factor_default > 0)
    ? settings.markup_factor_default : 1;
  raw *= markup;

  const min_charge = sn(mat.min_charge_usd ?? settings.min_charge_default, 0);
  let total = raw;
  let used_min_charge = false;
  if (min_charge > 0 && total < min_charge) { total = min_charge; used_min_charge = true; }

  return {
    piece_ci: r4(piece_ci), order_ci: r4(order_ci), order_ci_with_waste: r4(order_ci_with_waste),
    price_per_ci: r4(pci), price_per_bf: r2(price_per_bf), min_charge: r2(min_charge),
    total: r2(total), used_min_charge, kerf_pct, is_skived, material_name: mat.name,
  };
}