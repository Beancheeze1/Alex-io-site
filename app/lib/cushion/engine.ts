// app/lib/cushion/engine.ts
//
// Real cushion-curve recommendation engine.
//
// Replaces the old foam-advisor stub (fixed psi buckets -> hardcoded density
// band text) with logic that actually queries `cushion_curves`, interpolates
// the tested G-level at the caller's computed static stress, and ranks real
// catalog materials against a numeric fragility (G) target.
//
// Standard, publicly-defensible reference tables only (no vendor lab data
// baked in here) -- the vendor-sourced numbers stay in the `cushion_curves`
// table and are only ever read, never reproduced in this file.

import { q } from "@/lib/db";

export type FragilityTier = {
  key: string;
  label: string;
  gMin: number;
  gMax: number | null; // null = open-ended ("100G and up")
};

// Standard industry fragility G-force tiers (generic, publicly documented --
// not vendor-specific data).
export const FRAGILITY_TIERS: FragilityTier[] = [
  { key: "very_delicate", label: "Extremely / Very Delicate", gMin: 0, gMax: 25 },
  { key: "delicate", label: "Delicate", gMin: 25, gMax: 40 },
  { key: "fragile", label: "Fragile", gMin: 40, gMax: 60 },
  { key: "moderately_fragile", label: "Moderately Fragile", gMin: 60, gMax: 85 },
  { key: "rugged", label: "Rugged", gMin: 85, gMax: 100 },
  { key: "very_rugged", label: "Very Rugged", gMin: 100, gMax: null },
];

export function fragilityTierForG(gMax: number): FragilityTier {
  const tier = FRAGILITY_TIERS.find(
    (t) => gMax >= t.gMin && (t.gMax == null || gMax < t.gMax),
  );
  return tier ?? FRAGILITY_TIERS[FRAGILITY_TIERS.length - 1];
}

type DropHeightBand = { minLb: number; maxLb: number | null; dropIn: number };

// Standard ASTM D-3332-style drop-height-by-weight table (generic, publicly
// documented reference -- not vendor-specific data).
export const DROP_HEIGHT_TABLE: DropHeightBand[] = [
  { minLb: 0, maxLb: 25, dropIn: 42 },
  { minLb: 25, maxLb: 50, dropIn: 36 },
  { minLb: 50, maxLb: 100, dropIn: 30 },
  { minLb: 100, maxLb: 500, dropIn: 24 },
  { minLb: 500, maxLb: 1000, dropIn: 18 },
  { minLb: 1000, maxLb: null, dropIn: 12 },
];

export function suggestDropHeightIn(weightLb: number): number {
  const band =
    DROP_HEIGHT_TABLE.find(
      (b) => weightLb >= b.minLb && (b.maxLb == null || weightLb <= b.maxLb),
    ) ?? DROP_HEIGHT_TABLE[DROP_HEIGHT_TABLE.length - 1];
  return band.dropIn;
}

export type CushionCurveRow = {
  id: number;
  material_id: number;
  static_psi: number;
  deflect_pct: number | null;
  g_level: number;
  thickness_in: number | null;
  drop_in: number | null;
  provenance: "tested" | "proxy" | "unverified" | null;
  source: string | null;
};

export type MaterialRow = {
  id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  price_per_bf: number | null;
  min_charge_usd: number | null;
};

/**
 * Linear interpolation of G-level at `operatingPsi` from a set of tested
 * points on ONE curve. If `operatingPsi` falls outside the tested psi range,
 * the nearest endpoint is used and `extrapolated: true` is returned instead
 * of silently pretending the value is a real interpolation.
 */
export function interpolateG(
  points: CushionCurveRow[],
  operatingPsi: number,
): {
  g: number;
  extrapolated: boolean;
  loPoint: CushionCurveRow;
  hiPoint: CushionCurveRow;
} | null {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.static_psi - b.static_psi);

  if (operatingPsi <= sorted[0].static_psi) {
    return {
      g: sorted[0].g_level,
      extrapolated: operatingPsi < sorted[0].static_psi,
      loPoint: sorted[0],
      hiPoint: sorted[0],
    };
  }
  const last = sorted[sorted.length - 1];
  if (operatingPsi >= last.static_psi) {
    return {
      g: last.g_level,
      extrapolated: operatingPsi > last.static_psi,
      loPoint: last,
      hiPoint: last,
    };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (operatingPsi >= lo.static_psi && operatingPsi <= hi.static_psi) {
      const span = hi.static_psi - lo.static_psi;
      const frac = span > 0 ? (operatingPsi - lo.static_psi) / span : 0;
      const g = lo.g_level + frac * (hi.g_level - lo.g_level);
      return { g, extrapolated: false, loPoint: lo, hiPoint: hi };
    }
  }
  return null;
}

export type MaterialCandidate = {
  material_id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  price_per_bf: number | null;
  min_charge_usd: number | null;

  operating_psi: number;
  g_at_operating_psi: number;
  extrapolated_beyond_tested_range: boolean;
  meets_fragility_target: boolean;
  margin_g: number; // target - g (positive = headroom, negative = over target)

  curve: {
    point_count: number;
    provenance: "tested" | "proxy" | "unverified" | null;
    thickness_in: number | null;
    drop_in: number | null;
    source: string | null;
    nearest_tested_psi: number;
  };

  caveats: string[];
};

/**
 * Query every material that has cushion-curve coverage, interpolate G at the
 * caller's operating psi, and rank by real curve data against a numeric
 * fragility target -- no fixed text buckets, no hardcoded density bands.
 */
export async function recommendMaterials(input: {
  weightLb: number;
  contactAreaIn2: number;
  fragilityGMax: number;
  dropHeightIn: number;
}): Promise<{
  staticPsi: number;
  candidates: MaterialCandidate[];
  materialsConsidered: number;
  materialsWithoutCurveData: number;
}> {
  const staticPsi = input.weightLb / input.contactAreaIn2;

  const materials = await q<MaterialRow>(`
    SELECT id, name, material_family, density_lb_ft3, price_per_bf, min_charge_usd
    FROM materials
    WHERE is_active IS NOT FALSE
    ORDER BY material_family, name;
  `);

  const curveRows = await q<CushionCurveRow>(`
    SELECT id, material_id, static_psi, deflect_pct, g_level, thickness_in, drop_in, provenance, source
    FROM cushion_curves
    ORDER BY material_id, static_psi;
  `);

  const curvesByMaterial = new Map<number, CushionCurveRow[]>();
  for (const row of curveRows) {
    const list = curvesByMaterial.get(row.material_id) ?? [];
    list.push({
      ...row,
      static_psi: Number(row.static_psi),
      deflect_pct: row.deflect_pct == null ? null : Number(row.deflect_pct),
      g_level: Number(row.g_level),
      thickness_in: row.thickness_in == null ? null : Number(row.thickness_in),
      drop_in: row.drop_in == null ? null : Number(row.drop_in),
    });
    curvesByMaterial.set(row.material_id, list);
  }

  const candidates: MaterialCandidate[] = [];
  let materialsWithoutCurveData = 0;

  for (const mat of materials) {
    const points = curvesByMaterial.get(mat.id);
    if (!points || !points.length) {
      materialsWithoutCurveData++;
      continue;
    }

    const interp = interpolateG(points, staticPsi);
    if (!interp) continue;

    const caveats: string[] = [];
    if (interp.extrapolated) {
      caveats.push(
        `Your operating load (${staticPsi.toFixed(
          3,
        )} psi) is outside the tested range for this material (${Math.min(
          ...points.map((p) => p.static_psi),
        ).toFixed(3)}–${Math.max(...points.map((p) => p.static_psi)).toFixed(
          3,
        )} psi). Showing the nearest tested point instead of a real interpolation.`,
      );
    }

    const thicknessIn = points[0].thickness_in;
    const dropIn = points[0].drop_in;
    if (dropIn != null && input.dropHeightIn !== dropIn) {
      caveats.push(
        `Curve data on file for this material is tested at a ${dropIn}in drop only. Your selected drop height is ${input.dropHeightIn}in -- G-level shown is not adjusted for that difference.`,
      );
    }
    const distinctThicknesses = new Set(
      points.map((p) => p.thickness_in).filter((t) => t != null),
    );
    if (distinctThicknesses.size <= 1) {
      caveats.push(
        thicknessIn != null
          ? `Only ${thicknessIn}in-thick curve data is on file for this material -- no thinner/thicker alternative to compare for a bottoming-out check.`
          : `No foam thickness is recorded for this curve data.`,
      );
    }
    if (points[0].provenance === "proxy") {
      caveats.push(
        "This curve is a proxy: adapted from a different (nearby-density) material's tested curve, not digitized for this exact material.",
      );
    } else if (points[0].provenance === "unverified") {
      caveats.push(
        "No source document is on file for this curve -- values are unverified.",
      );
    }

    candidates.push({
      material_id: mat.id,
      name: mat.name,
      material_family: mat.material_family,
      density_lb_ft3: mat.density_lb_ft3 == null ? null : Number(mat.density_lb_ft3),
      price_per_bf: mat.price_per_bf == null ? null : Number(mat.price_per_bf),
      min_charge_usd: mat.min_charge_usd == null ? null : Number(mat.min_charge_usd),

      operating_psi: staticPsi,
      g_at_operating_psi: interp.g,
      extrapolated_beyond_tested_range: interp.extrapolated,
      meets_fragility_target: interp.g <= input.fragilityGMax,
      margin_g: input.fragilityGMax - interp.g,

      curve: {
        point_count: points.length,
        provenance: points[0].provenance,
        thickness_in: thicknessIn,
        drop_in: dropIn,
        source: points[0].source,
        nearest_tested_psi: interp.extrapolated
          ? (staticPsi <= points[0].static_psi ? interp.loPoint : interp.hiPoint).static_psi
          : staticPsi,
      },

      caveats,
    });
  }

  // Rank: materials that meet the fragility target first, most-efficient
  // (closest to target from below) first; materials that don't meet target
  // sorted by how close they come, worst last.
  candidates.sort((a, b) => {
    if (a.meets_fragility_target !== b.meets_fragility_target) {
      return a.meets_fragility_target ? -1 : 1;
    }
    if (a.meets_fragility_target) {
      // both pass: prefer smaller margin (less over-engineered) but not negative
      return a.margin_g - b.margin_g;
    }
    // both fail: prefer smaller shortfall (closest to passing)
    return b.margin_g - a.margin_g;
  });

  return {
    staticPsi,
    candidates,
    materialsConsidered: materials.length,
    materialsWithoutCurveData,
  };
}
