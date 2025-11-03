// app/lib/quoteEngine.ts
// Minimal, deterministic estimator (no external LLM).
// Uses simple env-configurable pricing so it's safe in production.
// Later we can swap to your DB calc_foam_quote() with the same interface.

import type { Dims } from "@/app/lib/nlp";

type In = {
  dims: Dims; // inches
  qty: number;
  density: number; // lb/ft^3
  material: "PE" | "EPE" | "PU";
  productType: "insert" | "full";
};

export type Estimate = {
  summary: string;
  qty: number;
  material: In["material"];
  density: number;
  wastePct: number; // 0.10 = 10%
  unitPrice: number;
  total: number;
  minCharge: number;
  notes: string[];
};

function dollars(n: number) {
  return Math.max(0, Math.round(n * 100)) / 100;
}

export function buildEstimate(input: In): Estimate {
  const { l, w, h } = input.dims;
  const qty = Math.max(1, Math.floor(input.qty || 1));

  // Configurable knobs (fallbacks are safe defaults)
  const pricePerBfPE =
    Number(process.env.ALEXIO_PRICE_PE_BF_USD || 7.5); // $/board-foot
  const pricePerBfPU =
    Number(process.env.ALEXIO_PRICE_PU_BF_USD || 8.5); // $/board-foot
  const kerfWastePct =
    Number(process.env.ALEXIO_WASTE_PCT || 0.1); // 0.10 = 10%
  const minCharge = Number(process.env.ALEXIO_MIN_CHARGE_USD || 25);

  // Volume (in³) -> board feet: in³ / 144
  const volumeIn3 = l * w * h;
  const bf = volumeIn3 / 144;

  const mat = input.material;
  const pricePerBf = mat === "PU" ? pricePerBfPU : pricePerBfPE;

  // Simple density factor around 1.7 baseline (PE/EPE)
  // (PU will naturally price higher by per-BF config)
  const densityFactor = input.density > 0 ? input.density / 1.7 : 1;

  // Waste
  const wasteFactor = 1 + kerfWastePct;

  // Unit price and total
  const unitPriceRaw = bf * pricePerBf * densityFactor * wasteFactor;
  const unitPrice = dollars(unitPriceRaw);
  const totalRaw = Math.max(minCharge, unitPrice * qty);
  const total = dollars(totalRaw);

  const summary = `${l}×${w}×${h}" ${mat} ${input.productType}`;
  const notes: string[] = [];
  if (totalRaw === minCharge) notes.push("Min charge applied.");

  return {
    summary,
    qty,
    material: mat,
    density: input.density,
    wastePct: kerfWastePct,
    unitPrice,
    total,
    minCharge,
    notes,
  };
}
