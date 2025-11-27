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

const MACHINE_RATE_MULTIPLIER = 3000; // in³ per minute
const MACHINE_COST_PER_MIN = 0.65; // USD
const DEFAULT_MARKUP = 1.45; // 45% markup baseline

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
  const markup = Number(args.markupFactor ?? DEFAULT_MARKUP);

  const volumeIn3 = L * W * H;
  const densityLbIn3 = density / 1728; // convert ft³ to in³
  const materialWeightLb = volumeIn3 * densityLbIn3;
  const materialCost = materialWeightLb * costPerLb;

  const machineMinutes = volumeIn3 / MACHINE_RATE_MULTIPLIER;
  const machineCost = machineMinutes * MACHINE_COST_PER_MIN;

  const rawCost = materialCost + machineCost;
  const sellPrice = rawCost * markup;

  const unitPrice = sellPrice;
  const extendedPrice = unitPrice * qty;

  const breaks = [1, 10, 50, 100].map((bq) => {
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
