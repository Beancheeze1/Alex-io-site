// app/lib/ai/materialSelect.ts
import type { ExtractedSpec } from "@/app/lib/ai/extract";

type MatItem = {
  id?: string;
  name?: string;
  density_pcf?: number;
  color?: string;
  kerf_pct?: number;
  price_per_ci?: number;
  price_per_bf?: number;
  min_charge?: number;
  vendor?: string;
  notes?: string;
};

function norm(v?: string | null) {
  return (v || "").toLowerCase().trim();
}

export function pickTopMaterial(items: MatItem[], ex: ExtractedSpec | null) {
  if (!items?.length) return null;
  const targetDensity = ex?.density_pcf ?? null;
  const targetFamily = norm(ex?.foam_family || null);
  const targetColor  = norm(ex?.color || null);

  let best: { item: MatItem; score: number } | null = null;

  for (const it of items) {
    let score = 0;

    // density closeness (bigger weight)
    if (targetDensity != null && typeof it.density_pcf === "number") {
      const d = Math.abs(it.density_pcf - targetDensity);
      score += Math.max(0, 10 - d * 10); // within 0.2pcf ≈ score 8
    }

    // family words in name
    const name = norm(it.name);
    if (targetFamily && name.includes(targetFamily)) score += 3;

    // color
    if (targetColor && norm(it.color) === targetColor) score += 2;

    // cheaper price_per_ci preferred when tie
    const cheapBonus = (it.price_per_ci ?? 0) > 0 ? 1 / (1 + (it.price_per_ci ?? 0)) : 0;
    score += cheapBonus;

    if (!best || score > best.score) best = { item: it, score };
  }

  return best?.item ?? null;
}
