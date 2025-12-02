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
