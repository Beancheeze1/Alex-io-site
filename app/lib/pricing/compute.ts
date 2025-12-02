// app/lib/pricing/compute.ts
//
// Centralized pricing breakdown calculator (non-destructive).
// Pure functions only — no DB writes, no side effects.
// Safe under Path A and does not modify any existing logic shape.
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

import { getPricingSettings } from "../../lib/pricing/settings";

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

// Fallbacks used if settings are missing or invalid
const FALLBACK_MACHINE_RATE_IN3_PER_MIN = 3000; // in³ per minute
const FALLBACK_MACHINE_COST_PER_MIN = 0.65;     // USD
const FALLBACK_MARKUP = 1.45;                   // 45% markup baseline

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

  // Pull live knobs from admin settings (with safe fallbacks)
  const settings = getPricingSettings();

  const machineRateIn3PerMin =
    Number(settings.machining_in3_per_min) > 0
      ? Number(settings.machining_in3_per_min)
      : FALLBACK_MACHINE_RATE_IN3_PER_MIN;

  const machineCostPerMin =
    Number(settings.machine_cost_per_min) > 0
      ? Number(settings.machine_cost_per_min)
      : FALLBACK_MACHINE_COST_PER_MIN;

  const markup =
    args.markupFactor != null && Number(args.markupFactor) > 0
      ? Number(args.markupFactor)
      : Number(settings.markup_factor_default) > 0
      ? Number(settings.markup_factor_default)
      : FALLBACK_MARKUP;

  const volumeIn3 = L * W * H;
  const densityLbIn3 = density / 1728; // convert ft³ to in³
  const materialWeightLb = volumeIn3 * densityLbIn3;
  const materialCost = materialWeightLb * costPerLb;

  const machineMinutes = volumeIn3 / machineRateIn3PerMin;
  const machineCost = machineMinutes * machineCostPerMin;

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
