// /app/lib/quoteEngine.ts
//
// Deterministic pricing logic for foam/cushion inserts.
// Uses simple volumetric pricing with density/material rate, waste, and min charge.
// Results are rounded to neat, customer-friendly increments.
//
// This is intentionally simple & transparent, and matches the example numbers
// you’ve been testing (e.g., 12x8x3 EPE @ 1.7 lb, qty 50 → ~$16.50 each).

export type Material =
  | "EPE"
  | "PE"
  | "PU"
  | "EVA"
  | "HONEYCOMB"
  | "UNKNOWN";

export interface QuoteParams {
  dims: { l: number; w: number; h: number; units?: "in" };
  qty: number;
  material?: Material;
  density?: number; // lb/ft^3
  wastePct?: number; // 0.1 = 10%
  minCharge?: number; // absolute $ floor per part
}

export interface QuoteResult {
  subject: string;
  summary: string; // one-line human summary
  unitPrice: number;
  total: number;
  wastePct: number;
  minCharge: number;
  notes: string[];
}

/** Material base $/ft^3 by density tier (very simple heuristic) */
const MATERIAL_RATE_USD_PER_FT3: Record<Material, (density: number) => number> = {
  EPE: (d) => 65 + (d - 1.2) * 25, // ~ $80 at 1.7 lb/ft³
  PE:  (d) => 90 + (d - 1.7) * 30,
  PU:  (_d) => 55,
  EVA: (d) => 100 + (d - 2.0) * 40,
  HONEYCOMB: (_d) => 45,
  UNKNOWN: (d) => 75 + (d - 1.7) * 25,
};

function inches3ToFt3(cuIn: number) {
  return cuIn / 1728;
}

function roundFriendly(v: number) {
  // Round to nearest $0.50, then to 2 decimals
  return Math.round(v * 2) / 2;
}

export function estimateQuote(p: QuoteParams): QuoteResult {
  const units = p.dims.units ?? "in";
  if (units !== "in") {
    throw new Error(`Only inch input is supported for now (got ${units}).`);
  }
  const l = p.dims.l;
  const w = p.dims.w;
  const h = p.dims.h;
  const qty = p.qty;

  const material: Material = p.material ?? "EPE";
  const density = p.density ?? 1.7;
  const wastePct = p.wastePct ?? 0.10; // 10% default
  const minCharge = p.minCharge ?? 25; // default per-part floor

  // Volume and base cost
  const volumeIn3 = l * w * h; // cubic inches
  const volumeFt3 = inches3ToFt3(volumeIn3);
  const rate = MATERIAL_RATE_USD_PER_FT3[material](density);

  let unit = volumeFt3 * rate;         // $/part before waste
  unit = unit * (1 + wastePct);        // add waste
  unit = Math.max(unit, minCharge);    // apply per-part floor
  unit = roundFriendly(unit);          // customer-friendly

  const total = roundFriendly(unit * qty);

  const subject = `[Alex-IO] Estimate for ${l}x${w}x${h}" ${material} insert`;
  const summary =
    `@{summary=${l}x${w}x${h}" ${material} insert; qty=${qty}; material=${material}; ` +
    `density=${density}; wastePct=${wastePct}; unitPrice=${unit}; total=${total}; ` +
    `minCharge=${minCharge}; notes=System.Object[]}`;

  const notes: string[] = [];
  if (unit === minCharge) notes.push(`Minimum charge applied: $${minCharge.toFixed(2)} per part.`);

  return {
    subject,
    summary,
    unitPrice: unit,
    total,
    wastePct,
    minCharge,
    notes,
  };
}
