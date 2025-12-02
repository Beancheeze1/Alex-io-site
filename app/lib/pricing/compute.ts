// app/lib/pricing/compute.ts
//
// Centralized pricing breakdown calculator (non-destructive).
// Pure functions only — no DB writes, no side effects.
// Safe under Path A and does not modify any existing logic.
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

// Previous hard-coded defaults.
// Now treated as fallbacks if runtime settings are missing.
const DEFAULT_MACHINE_RATE_IN3_PER_MIN = 3000; // in³ per minute
const DEFAULT_MACHINE_COST_PER_MIN = 0.65; // USD
const DEFAULT_MARKUP_FACTOR = 1.45; // 45% markup baseline

type RuntimePricingSettings = {
  machine_rate_in3_per_min?: number;
  machine_cost_per_min?: number;
  default_markup_factor?: number;
};

/**
 * Read runtime pricing knobs from the same global container
 * used by /api/admin/settings, with safe fallbacks.
 */
function getRuntimePricingSettings(): {
  machineRateIn3PerMin: number;
  machineCostPerMin: number;
  markupFactor: number;
} {
  const g = globalThis as any;
  const s = (g.__ALEXIO_PRICING_SETTINGS__ ??
    {}) as RuntimePricingSettings;

  const toPosNumber = (
    v: unknown,
    fallback: number,
  ): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const machineRateIn3PerMin = toPosNumber(
    s.machine_rate_in3_per_min,
    DEFAULT_MACHINE_RATE_IN3_PER_MIN,
  );

  const machineCostPerMin = toPosNumber(
    s.machine_cost_per_min,
    DEFAULT_MACHINE_COST_PER_MIN,
  );

  const markupFactor = toPosNumber(
    s.default_markup_factor,
    DEFAULT_MARKUP_FACTOR,
  );

  return {
    machineRateIn3PerMin,
    machineCostPerMin,
    markupFactor,
  };
}

export function computePricingBreakdown(args: {
  length_in: number;
  width_in: number;
  height_in: number;
  density_lbft3: number;
  cost_per_lb: number;
  qty: number;
  markupFactor?: number;
}): PricingBreakdown {
  const L = Number(args.length_in);
  const W = Number(args.width_in);
  const H = Number(args.height_in);
  const qty = Number(args.qty);
  const density = Number(args.density_lbft3);
  const costPerLb = Number(args.cost_per_lb);

  const runtime = getRuntimePricingSettings();

  // Use explicit arg markupFactor if provided, otherwise runtime default.
  const markup = Number(
    args.markupFactor ?? runtime.markupFactor,
  );

  const volumeIn3 = L * W * H;
  const densityLbIn3 = density / 1728; // convert ft³ to in³
  const materialWeightLb = volumeIn3 * densityLbIn3;
  const materialCost = materialWeightLb * costPerLb;

  const machineMinutes =
    volumeIn3 / runtime.machineRateIn3PerMin;
  const machineCost =
    machineMinutes * runtime.machineCostPerMin;

  const rawCost = materialCost + machineCost;
  const sellPrice = rawCost * markup;

  const unitPrice = sellPrice;
  const extendedPrice = unitPrice * qty;

  // Ladder: 1, 10, 25, 50, 100, 150, 250
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
