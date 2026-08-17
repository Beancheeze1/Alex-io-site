// app/lib/cushion/engine.ts
//
// Real cushion-curve recommendation engine.
//
// Two modes, chosen per-material by what data actually exists (never
// promised beyond what's real):
//   - "recommend": material has >1 digitized thickness. We can find the
//     thinnest thickness whose curve dips at/under the fragility target,
//     the safe static-loading range on that curve, and a resulting bearing
//     area -- a real design recommendation (min thickness + bearing area),
//     not just a pass/fail check.
//   - "verify_only": material has exactly one digitized thickness (still
//     true for most of the catalog). We can only tell you the G-level at
//     YOUR stated operating psi on that one curve -- not recommend a
//     thickness, because we have no other thickness data to compare against.
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

export type Provenance = "tested" | "proxy" | "unverified" | "modeled";
// Trust order used whenever more than one curve exists at the same
// thickness: real vendor data (tested, then proxy) beats an undocumented
// digitization (unverified), which beats a pure mathematical extrapolation
// (modeled) -- see the Burgess-method validation notes below for why
// "modeled" ranks last: measured error against real 5-thickness data ran
// 16-45% typical, up to 200%+ at range extremes.
const PROVENANCE_RANK: Record<Provenance, number> = {
  tested: 0,
  proxy: 1,
  unverified: 2,
  modeled: 3,
};

/**
 * Burgess (1990) "stress-energy" method for deriving a material's cushion
 * curves at OTHER thicknesses from ONE real tested curve.
 *
 * Source equations (Marcondes, Batt, Darby & Daum, "Determining the Minimum
 * Sample Size Using a Simplified Method for Determining Cushion Curves",
 * Journal of Applied Packaging Research 2(4), 2008, directly citing and
 * reproducing Burgess 1990, Packaging Technology and Science 3(4):189-194):
 *
 *   y = a * e^(b*x)         -- fitted per material
 *   y = G * s               -- "dynamic stress" (G = peak deceleration in g's, s = static psi)
 *   x = s * h / t            -- "dynamic energy" (h = drop height in, t = thickness in)
 *
 * Fit (a, b) via linear regression of ln(y) vs x using the material's own
 * tested (static_psi, G) points at its one known thickness/drop height.
 * Predict G at a new thickness (same drop height) by solving for y at the
 * new x and dividing back by s.
 *
 * VALIDATED (see cushion_curves rows with provenance='modeled' for the
 * embedded write-up): cross-checked by fitting from ONLY a 2in curve and
 * comparing predictions against real 5-thickness tested data (2.2 PCF and
 * 1.6 PCF PE, see materials 233 and 223). Result: far short of tested/proxy
 * reliability -- mean error 16-45% depending on material, up to 200%+ at
 * the extremes of the psi range. Ranked below "unverified" accordingly;
 * never silently promoted to look as trustworthy as real data.
 */
export function fitStressEnergyModel(
  points: { static_psi: number; g_level: number }[],
  thicknessIn: number,
  dropIn: number,
): { a: number; b: number; r2: number } | null {
  if (points.length < 2) return null; // can't fit a 2-parameter model from 1 point

  const xs: number[] = [];
  const lnYs: number[] = [];
  for (const p of points) {
    const x = (p.static_psi * dropIn) / thicknessIn;
    const y = p.g_level * p.static_psi;
    if (!(x > 0) || !(y > 0)) continue; // ln() undefined at/below 0
    xs.push(x);
    lnYs.push(Math.log(y));
  }
  if (xs.length < 2) return null;

  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanLnY = lnYs.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (lnYs[i] - meanLnY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null; // all x identical -- can't fit a slope
  const b = num / den;
  const lnA = meanLnY - b * meanX;
  const a = Math.exp(lnA);

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = lnA + b * xs[i];
    ssRes += (lnYs[i] - pred) ** 2;
    ssTot += (lnYs[i] - meanLnY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { a, b, r2 };
}

export function predictGFromStressEnergyModel(
  model: { a: number; b: number },
  staticPsi: number,
  dropIn: number,
  thicknessIn: number,
): number {
  const x = (staticPsi * dropIn) / thicknessIn;
  const y = model.a * Math.exp(model.b * x);
  return y / staticPsi;
}

export type CushionCurveRow = {
  id: number;
  material_id: number;
  static_psi: number;
  deflect_pct: number | null;
  g_level: number;
  thickness_in: number | null;
  drop_in: number | null;
  provenance: Provenance | null;
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
 * points on ONE curve (single thickness, single provenance). If
 * `operatingPsi` falls outside the tested psi range, the nearest endpoint is
 * used and `extrapolated: true` is returned instead of silently pretending
 * the value is a real interpolation.
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

/**
 * Find the psi interval where this single curve's interpolated G is at or
 * under `targetG`. Assumes a roughly U-shaped curve (true of every curve on
 * file today) -- returns the single contiguous qualifying interval, or null
 * if the curve never dips to targetG anywhere in the tested range.
 *
 * When the qualifying interval touches the first/last tested point, the
 * true boundary may extend further than we have data for -- that's flagged
 * via `loBoundedByData` / `hiBoundedByData` rather than guessed at.
 */
export function computeSafeRange(
  points: CushionCurveRow[],
  targetG: number,
): { low: number; high: number; loBoundedByData: boolean; hiBoundedByData: boolean } | null {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.static_psi - b.static_psi);
  const minG = Math.min(...sorted.map((p) => p.g_level));
  if (minG > targetG) return null;

  let low: number | null = null;
  let high: number | null = null;
  let loBoundedByData = false;
  let hiBoundedByData = false;

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const curOk = cur.g_level <= targetG;

    if (curOk && low === null) {
      if (i === 0) {
        low = cur.static_psi;
        loBoundedByData = true;
      } else {
        const prev = sorted[i - 1];
        if (prev.g_level > targetG) {
          const span = cur.static_psi - prev.static_psi;
          const frac = span > 0 ? (targetG - prev.g_level) / (cur.g_level - prev.g_level) : 0;
          low = prev.static_psi + frac * span;
        } else {
          low = cur.static_psi;
        }
      }
    }

    if (low !== null && high === null && !curOk && i > 0) {
      const prev = sorted[i - 1];
      const span = cur.static_psi - prev.static_psi;
      const frac = span > 0 ? (targetG - prev.g_level) / (cur.g_level - prev.g_level) : 0;
      high = prev.static_psi + frac * span;
      break;
    }
  }

  if (low === null) return null;
  if (high === null) {
    high = sorted[sorted.length - 1].static_psi;
    hiBoundedByData = true;
  }

  return { low, high, loBoundedByData, hiBoundedByData };
}

/**
 * The core "does this actually work for MY load" search. Given a material's
 * thickness curves and the caller's REAL operating psi (weight / bearing
 * area), searches ALL of them -- not just whichever thickness a design-range
 * search (computeSafeRange) happened to pick first -- and returns the
 * thinnest thickness that actually meets targetG AT THAT OPERATING POINT.
 *
 * This exists because a thickness can have a safe psi RANGE somewhere on its
 * curve (good for SOME footprint) without that range covering the caller's
 * ACTUAL stated footprint -- U-shaped curves mean both too-light and
 * too-heavy loading raise G. Picking "the thinnest thickness with any safe
 * range at all" and then reporting pass/fail at a possibly-unrelated psi is
 * exactly the bug this function fixes: it can silently rank a failing result
 * above a thickness that would have genuinely passed at this operating psi.
 *
 * Falls back to the thickness with the lowest G at the operating psi (closest
 * to passing) if none actually pass -- never fabricates a pass.
 */
export function findBestVerifyMatch(
  thicknessCurves: ThicknessCurve[],
  operatingPsi: number,
  targetG: number,
): { curve: ThicknessCurve; interp: NonNullable<ReturnType<typeof interpolateG>>; passes: boolean } | null {
  const evaluated: { curve: ThicknessCurve; interp: NonNullable<ReturnType<typeof interpolateG>> }[] = [];
  for (const tc of thicknessCurves) {
    const interp = interpolateG(tc.points, operatingPsi);
    if (interp) evaluated.push({ curve: tc, interp });
  }
  if (!evaluated.length) return null;

  const passing = evaluated.filter((e) => e.interp.g <= targetG);
  if (passing.length) {
    // Thinnest passing thickness -- least material for the same protection.
    passing.sort((a, b) => a.curve.thickness_in - b.curve.thickness_in);
    return { ...passing[0], passes: true };
  }

  // Nothing passes: report the closest miss (lowest G), not an arbitrary one.
  evaluated.sort((a, b) => a.interp.g - b.interp.g);
  return { ...evaluated[0], passes: false };
}

export type ThicknessCurve = {
  thickness_in: number;
  provenance: Provenance | null;
  drop_in: number | null;
  source: string | null;
  points: CushionCurveRow[]; // sorted by static_psi, single provenance only
};

/**
 * Group a material's raw curve rows by thickness. When more than one
 * provenance exists at the SAME thickness (e.g. this material's own tested
 * 2in curve plus a proxy 2in point from a different vendor's multi-thickness
 * sheet), only the best-ranked provenance (tested > proxy > unverified) is
 * used for that thickness -- two different vendors' curves are never
 * blended into one interpolation.
 */
export function groupByThickness(points: CushionCurveRow[]): ThicknessCurve[] {
  const byThickness = new Map<number, CushionCurveRow[]>();
  for (const p of points) {
    const t = p.thickness_in ?? -1;
    const list = byThickness.get(t) ?? [];
    list.push(p);
    byThickness.set(t, list);
  }

  const curves: ThicknessCurve[] = [];
  for (const [thickness, rows] of byThickness.entries()) {
    if (thickness < 0) continue; // no thickness recorded -- shouldn't happen post-migration

    let bestProvenance: Provenance = (rows[0].provenance ?? "unverified") as Provenance;
    for (const r of rows) {
      const p = (r.provenance ?? "unverified") as Provenance;
      if (PROVENANCE_RANK[p] < PROVENANCE_RANK[bestProvenance]) bestProvenance = p;
    }

    const filtered = rows.filter((r) => (r.provenance ?? "unverified") === bestProvenance);
    const sorted = [...filtered].sort((a, b) => a.static_psi - b.static_psi);

    curves.push({
      thickness_in: thickness,
      provenance: bestProvenance,
      drop_in: sorted[0]?.drop_in ?? null,
      source: sorted[0]?.source ?? null,
      points: sorted,
    });
  }

  return curves.sort((a, b) => a.thickness_in - b.thickness_in);
}

export type ThicknessSummary = {
  thickness_in: number;
  provenance: Provenance | null;
  point_count: number;
  min_g: number;
  min_tested_psi: number;
  max_tested_psi: number;
  meets_target: boolean;
};

export type Recommendation = {
  recommended_thickness_in: number;
  provenance: Provenance | null;
  safe_static_loading_range_psi: { low: number; high: number };
  recommended_bearing_area_in2: number; // weight / high end of range -- most material-efficient
  conservative_bearing_area_in2: number; // weight / low end of range -- most protective/most material
  low_bound_extends_beyond_tested_data: boolean;
  high_bound_extends_beyond_tested_data: boolean;
};

export type MaterialWithoutRequestedThickness = {
  material_id: number;
  name: string;
  material_family: string | null;
  available_thicknesses: number[];
};

export type MaterialExcludedByThicknessConstraint = {
  material_id: number;
  name: string;
  material_family: string | null;
  thinnest_available_in: number;
};

export type BestOptionBeyondConstraint = {
  material_id: number;
  name: string;
  thickness_in: number;
  g_at_operating_psi: number;
};

export type MaterialCandidate = {
  material_id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  price_per_bf: number | null;
  min_charge_usd: number | null;

  mode: "recommend" | "verify_only";
  thickness_options: ThicknessSummary[];

  // Echoes the caller's requested thickness (null when left blank -- recommend
  // mode). When set, this candidate's curve/verify numbers are for THAT exact
  // thickness, not a recommendation.
  requested_thickness_in: number | null;

  // "Verify" numbers: G at the caller's ACTUAL stated operating psi, on the
  // recommended thickness's curve (if mode === "recommend") or the material's
  // one available thickness (if mode === "verify_only").
  operating_psi: number;
  verify_thickness_in: number;
  g_at_operating_psi: number;
  extrapolated_beyond_tested_range: boolean;
  meets_fragility_target: boolean;
  margin_g: number; // target - g (positive = headroom, negative = over target)

  // Present only when mode === "recommend" AND some thickness qualifies.
  recommendation: Recommendation | null;

  curve: {
    point_count: number;
    provenance: Provenance | null;
    thickness_in: number | null;
    drop_in: number | null;
    source: string | null;
    nearest_tested_psi: number;
  };

  caveats: string[];
};

/**
 * Query every material that has cushion-curve coverage. Three request shapes:
 *
 *  - `requestedThicknessIn` omitted/null, `maxThicknessIn` omitted/null:
 *    RECOMMEND/VERIFY mode -- for EACH material, search ALL of its digitized
 *    thicknesses (via findBestVerifyMatch) for the thinnest one that
 *    actually meets fragilityGMax AT THE CALLER'S REAL OPERATING PSI, not
 *    just whichever thickness a design-range search happened to pick first.
 *    This is what makes "meets_fragility_target" and ranking trustworthy --
 *    a failing result can never outrank a passing one, and a passing option
 *    is never missed just because a different thickness of the same
 *    material was checked instead. `recommendation` (the safe psi RANGE +
 *    bearing-area block) is a SEPARATE, complementary design-oriented
 *    search over the same thickness, kept for "what footprint would this
 *    thickness support" context -- it never substitutes for the verify
 *    result used in ranking.
 *
 *  - `maxThicknessIn` given (no requestedThicknessIn): same search, but
 *    restricted to thicknesses at or under the caller's stated limit ("how
 *    much room do you have"). A material with NO digitized thickness at or
 *    under the limit is excluded entirely and listed in
 *    `materialsExcludedByThicknessConstraint`. If nothing within the limit
 *    passes anywhere in the result set, `bestOptionBeyondConstraint` reports
 *    the real thinnest thickness (unconstrained) that WOULD pass, so the
 *    caller can say what it would take rather than just "nothing works."
 *
 *  - `requestedThicknessIn` given: VERIFY-AT-THICKNESS mode, UNCHANGED from
 *    before -- for each material, look for a curve at EXACTLY that
 *    thickness and report G there. No recommendation, no thickness search;
 *    `maxThicknessIn` is ignored in this mode (the two are mutually
 *    exclusive: verifying one exact thickness vs. searching under a
 *    ceiling). A material with no curve at that exact thickness is NOT
 *    given a fabricated answer by interpolating across thicknesses -- it's
 *    listed in `materialsWithoutRequestedThickness` along with which
 *    thicknesses ARE actually on file for it.
 */
export async function recommendMaterials(input: {
  weightLb: number;
  contactAreaIn2: number;
  fragilityGMax: number;
  dropHeightIn: number;
  requestedThicknessIn?: number | null;
  maxThicknessIn?: number | null;
}): Promise<{
  staticPsi: number;
  candidates: MaterialCandidate[];
  materialsConsidered: number;
  materialsWithoutCurveData: number;
  materialsWithoutRequestedThickness: MaterialWithoutRequestedThickness[];
  materialsExcludedByThicknessConstraint: MaterialExcludedByThicknessConstraint[];
  anyMaterialMeetsTarget: boolean;
  bestOptionBeyondConstraint: BestOptionBeyondConstraint | null;
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
  const materialsWithoutRequestedThickness: MaterialWithoutRequestedThickness[] = [];
  const materialsExcludedByThicknessConstraint: MaterialExcludedByThicknessConstraint[] = [];
  const requestedThicknessIn =
    input.requestedThicknessIn != null && Number.isFinite(input.requestedThicknessIn)
      ? input.requestedThicknessIn
      : null;
  // Ignored when requestedThicknessIn is set -- verifying one exact
  // thickness and constraining to a maximum are mutually exclusive asks.
  const maxThicknessIn =
    requestedThicknessIn == null &&
    input.maxThicknessIn != null &&
    Number.isFinite(input.maxThicknessIn) &&
    input.maxThicknessIn > 0
      ? input.maxThicknessIn
      : null;

  // Tracks the real thinnest passing thickness across the WHOLE catalog,
  // ignoring maxThicknessIn -- used only to answer "nothing fits your
  // limit, but here's what would work" honestly, from data actually found
  // during this same pass (not a separate guess).
  let bestOptionBeyondConstraint: BestOptionBeyondConstraint | null = null;

  for (const mat of materials) {
    const rawPoints = curvesByMaterial.get(mat.id);
    if (!rawPoints || !rawPoints.length) {
      materialsWithoutCurveData++;
      continue;
    }

    const thicknessCurves = groupByThickness(rawPoints);
    if (!thicknessCurves.length) continue;

    const isMultiThickness = thicknessCurves.length > 1;
    const caveats: string[] = [];

    const thicknessOptions: ThicknessSummary[] = thicknessCurves.map((tc) => ({
      thickness_in: tc.thickness_in,
      provenance: tc.provenance,
      point_count: tc.points.length,
      min_g: Math.min(...tc.points.map((p) => p.g_level)),
      min_tested_psi: Math.min(...tc.points.map((p) => p.static_psi)),
      max_tested_psi: Math.max(...tc.points.map((p) => p.static_psi)),
      meets_target: Math.min(...tc.points.map((p) => p.g_level)) <= input.fragilityGMax,
    }));

    // Track the real global best (unconstrained) for the "here's what would
    // work instead" fallback, regardless of which mode we're in below.
    if (requestedThicknessIn == null) {
      const unconstrainedMatch = findBestVerifyMatch(thicknessCurves, staticPsi, input.fragilityGMax);
      if (
        unconstrainedMatch &&
        unconstrainedMatch.passes &&
        (bestOptionBeyondConstraint == null ||
          unconstrainedMatch.curve.thickness_in < bestOptionBeyondConstraint.thickness_in)
      ) {
        bestOptionBeyondConstraint = {
          material_id: mat.id,
          name: mat.name,
          thickness_in: unconstrainedMatch.curve.thickness_in,
          g_at_operating_psi: unconstrainedMatch.interp.g,
        };
      }
    }

    let recommendation: Recommendation | null = null;
    let verifyCurve: ThicknessCurve;
    let interp: NonNullable<ReturnType<typeof interpolateG>>;

    if (requestedThicknessIn != null) {
      // VERIFY-AT-THICKNESS: exact match only. No cross-thickness
      // interpolation/fabrication for materials that don't have this
      // exact thickness on file.
      const match = thicknessCurves.find(
        (tc) => Math.abs(tc.thickness_in - requestedThicknessIn) < 1e-6,
      );
      if (!match) {
        materialsWithoutRequestedThickness.push({
          material_id: mat.id,
          name: mat.name,
          material_family: mat.material_family,
          available_thicknesses: thicknessCurves.map((tc) => tc.thickness_in),
        });
        continue;
      }
      verifyCurve = match;
      const directInterp = interpolateG(verifyCurve.points, staticPsi);
      if (!directInterp) continue;
      interp = directInterp;
    } else {
      // RECOMMEND/VERIFY: restrict to thicknesses at/under the caller's
      // stated room, if any. A material with nothing in range can't offer
      // anything here at all.
      const eligibleCurves =
        maxThicknessIn != null
          ? thicknessCurves.filter((tc) => tc.thickness_in <= maxThicknessIn)
          : thicknessCurves;

      if (maxThicknessIn != null && eligibleCurves.length === 0) {
        materialsExcludedByThicknessConstraint.push({
          material_id: mat.id,
          name: mat.name,
          material_family: mat.material_family,
          thinnest_available_in: thicknessCurves[0].thickness_in,
        });
        continue;
      }

      // Search every eligible thickness for the thinnest one that really
      // passes AT THIS OPERATING PSI -- this drives both ranking (below) and
      // which curve gets described as "the recommendation."
      const verifyMatch = findBestVerifyMatch(eligibleCurves, staticPsi, input.fragilityGMax);
      if (!verifyMatch) continue;
      verifyCurve = verifyMatch.curve;
      interp = verifyMatch.interp;

      // Design-range block: the safe static-loading RANGE on the SAME curve
      // that was just verified to work at the caller's actual operating psi
      // -- never a different, thinner thickness's range. Reporting a range
      // from some other thickness while displaying pass/fail computed on
      // THIS thickness was the bug: every multi-thickness material's
      // "recommendation" silently locked to its thinnest curve (almost
      // always 2in) regardless of which thickness the real verify match
      // actually used, so 3/4/5in matches never surfaced as "the"
      // recommended thickness even when they were the thickness that
      // actually passed.
      if (isMultiThickness) {
        if (verifyMatch.passes) {
          const range = computeSafeRange(verifyCurve.points, input.fragilityGMax);
          if (range) {
            recommendation = {
              recommended_thickness_in: verifyCurve.thickness_in,
              provenance: verifyCurve.provenance,
              safe_static_loading_range_psi: { low: range.low, high: range.high },
              recommended_bearing_area_in2: input.weightLb / range.high,
              conservative_bearing_area_in2: input.weightLb / range.low,
              low_bound_extends_beyond_tested_data: range.loBoundedByData,
              high_bound_extends_beyond_tested_data: range.hiBoundedByData,
            };
            if (recommendation.low_bound_extends_beyond_tested_data) {
              caveats.push(
                `The safe loading range's low end (${recommendation.safe_static_loading_range_psi.low.toFixed(
                  3,
                )} psi) is the first tested point, not a curve boundary -- the true safe range may extend lower.`,
              );
            }
            if (recommendation.high_bound_extends_beyond_tested_data) {
              caveats.push(
                `The safe loading range's high end (${recommendation.safe_static_loading_range_psi.high.toFixed(
                  3,
                )} psi) is the last tested point, not a curve boundary -- the true safe range may extend higher.`,
              );
            }
          }
        } else {
          const maxAvailable = eligibleCurves[eligibleCurves.length - 1].thickness_in;
          caveats.push(
            maxThicknessIn != null
              ? `None of the thicknesses at or under your ${maxThicknessIn}in limit (up to ${maxAvailable}in) bring G at or under your ${input.fragilityGMax}G target at your stated footprint.`
              : `None of the tested thicknesses on file (up to ${maxAvailable}in) bring G at or under your ${input.fragilityGMax}G target at your stated footprint.`,
          );
        }
        if (maxThicknessIn != null && eligibleCurves.length < thicknessCurves.length) {
          caveats.push(
            `Only ${eligibleCurves
              .map((tc) => `${tc.thickness_in}in`)
              .join(", ")} fit${eligibleCurves.length === 1 ? "s" : ""} at or under your ${maxThicknessIn}in limit for this material (it also has thicker options on file that don't fit).`,
          );
        }
      }

      if (maxThicknessIn != null && !verifyMatch.passes) {
        caveats.push(
          `No thickness at or under your ${maxThicknessIn}in limit meets your ${input.fragilityGMax}G target for this material at your stated footprint.`,
        );
      }
    }

    if (interp.extrapolated) {
      const psis = verifyCurve.points.map((p) => p.static_psi);
      caveats.push(
        `Your operating load (${staticPsi.toFixed(3)} psi) is outside the tested range for the ${
          verifyCurve.thickness_in
        }in curve (${Math.min(...psis).toFixed(3)}-${Math.max(...psis).toFixed(
          3,
        )} psi). Showing the nearest tested point instead of a real interpolation.`,
      );
    }
    if (verifyCurve.drop_in != null && input.dropHeightIn !== verifyCurve.drop_in) {
      caveats.push(
        `Curve data on file is tested at a ${verifyCurve.drop_in}in drop only. Your selected drop height is ${input.dropHeightIn}in -- G-level shown is not adjusted for that difference.`,
      );
    }
    if (!isMultiThickness) {
      caveats.push(
        `Only ${verifyCurve.thickness_in}in-thick curve data is on file for this material -- no thinner/thicker alternative to compare, so we can only verify your stated footprint, not recommend a thickness.`,
      );
    }
    if (verifyCurve.provenance === "proxy") {
      caveats.push(
        "This curve is a proxy: adapted from a different vendor's product at a similar density, not this material's own tested data.",
      );
    } else if (verifyCurve.provenance === "unverified") {
      caveats.push(
        "No source document is on file for this curve -- values are unverified.",
      );
    } else if (verifyCurve.provenance === "modeled") {
      caveats.push(
        "This curve is mathematically modeled (Burgess stress-energy method) from this material's own tested curve at a different thickness, not measured at this thickness. Validated accuracy against real multi-thickness data: 16-45% typical error, up to 200%+ at range extremes -- treat with more caution than tested or proxy data, and verify with real-world testing before relying on it.",
      );
    }

    candidates.push({
      material_id: mat.id,
      name: mat.name,
      material_family: mat.material_family,
      density_lb_ft3: mat.density_lb_ft3 == null ? null : Number(mat.density_lb_ft3),
      price_per_bf: mat.price_per_bf == null ? null : Number(mat.price_per_bf),
      min_charge_usd: mat.min_charge_usd == null ? null : Number(mat.min_charge_usd),

      mode: isMultiThickness ? "recommend" : "verify_only",
      thickness_options: thicknessOptions,
      requested_thickness_in: requestedThicknessIn,

      operating_psi: staticPsi,
      verify_thickness_in: verifyCurve.thickness_in,
      g_at_operating_psi: interp.g,
      extrapolated_beyond_tested_range: interp.extrapolated,
      meets_fragility_target: interp.g <= input.fragilityGMax,
      margin_g: input.fragilityGMax - interp.g,

      recommendation,

      curve: {
        point_count: verifyCurve.points.length,
        provenance: verifyCurve.provenance,
        thickness_in: verifyCurve.thickness_in,
        drop_in: verifyCurve.drop_in,
        source: verifyCurve.source,
        nearest_tested_psi: interp.extrapolated
          ? (staticPsi <= verifyCurve.points[0].static_psi ? interp.loPoint : interp.hiPoint).static_psi
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
      return a.margin_g - b.margin_g;
    }
    return b.margin_g - a.margin_g;
  });

  const anyMaterialMeetsTarget = candidates.some((c) => c.meets_fragility_target);

  return {
    staticPsi,
    candidates,
    materialsConsidered: materials.length,
    materialsWithoutCurveData,
    materialsWithoutRequestedThickness,
    materialsExcludedByThicknessConstraint,
    anyMaterialMeetsTarget,
    // Only meaningful (and only non-null) when a constraint was actually
    // given and nothing within it passed -- see the tracking loop above.
    bestOptionBeyondConstraint:
      maxThicknessIn != null && !anyMaterialMeetsTarget ? bestOptionBeyondConstraint : null,
  };
}
