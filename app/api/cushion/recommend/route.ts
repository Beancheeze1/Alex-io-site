// app/api/cushion/recommend/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ Starter sample curves (for prototyping only)
 * - Units: 24" drop, thickness reference = 2.0 in
 * - Series are per-foam, per-deflection (fraction, e.g. 0.25 = 25%)
 * - Each series: [{ psi, g }, ...] where psi = static stress (lb/in^2), g = transmitted G
 * - Shapes are approximate/illustrative — swap with vendor data when ready.
 */
type Point = { psi: number; g: number };
type Series = { defl: number; points: Point[] };
type FoamCurve = { key: string; name: string; density_lb_ft3: number; series: Series[] };

const THICKNESS_REF_IN = 2.0;
const DROP_REF_IN = 24.0;

/** A few common families with gentle U-shaped curves around an optimum static stress. */
const CURVES: FoamCurve[] = [
  {
    key: "pe17",
    name: "PE 1.7 lb",
    density_lb_ft3: 1.7,
    series: [
      { defl: 0.20, points: [ {psi:0.20,g:150},{psi:0.40,g:105},{psi:0.70,g:85},{psi:1.00,g:95},{psi:1.30,g:120} ] },
      { defl: 0.25, points: [ {psi:0.25,g:140},{psi:0.50,g:95 },{psi:0.80,g:70},{psi:1.10,g:78},{psi:1.40,g:105} ] },
      { defl: 0.30, points: [ {psi:0.30,g:145},{psi:0.55,g:100},{psi:0.85,g:73},{psi:1.20,g:80},{psi:1.55,g:110} ] },
      { defl: 0.35, points: [ {psi:0.35,g:155},{psi:0.60,g:110},{psi:0.90,g:80},{psi:1.30,g:88},{psi:1.70,g:120} ] },
    ],
  },
  {
    key: "pe22",
    name: "PE 2.2 lb",
    density_lb_ft3: 2.2,
    series: [
      { defl: 0.20, points: [ {psi:0.35,g:150},{psi:0.60,g:105},{psi:0.95,g:85},{psi:1.30,g:95},{psi:1.70,g:125} ] },
      { defl: 0.25, points: [ {psi:0.40,g:140},{psi:0.70,g:95 },{psi:1.05,g:70},{psi:1.45,g:78},{psi:1.90,g:108} ] },
      { defl: 0.30, points: [ {psi:0.45,g:145},{psi:0.80,g:100},{psi:1.20,g:72},{psi:1.65,g:80},{psi:2.10,g:112} ] },
      { defl: 0.35, points: [ {psi:0.50,g:155},{psi:0.90,g:110},{psi:1.35,g:80},{psi:1.85,g:88},{psi:2.45,g:122} ] },
    ],
  },
  {
    key: "pu13",
    name: "PU 1.3 lb (ester)",
    density_lb_ft3: 1.3,
    series: [
      { defl: 0.20, points: [ {psi:0.12,g:150},{psi:0.25,g:110},{psi:0.40,g:88},{psi:0.60,g:102} ] },
      { defl: 0.25, points: [ {psi:0.15,g:140},{psi:0.28,g:100},{psi:0.45,g:80},{psi:0.65,g:96} ] },
      { defl: 0.30, points: [ {psi:0.18,g:142},{psi:0.32,g:102},{psi:0.52,g:83},{psi:0.75,g:98} ] },
    ],
  },
];

/** Linear interpolation over piecewise segments. Extrapolates flat at ends. */
function interp(points: Point[], psi: number): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (psi <= points[0].psi) return points[0].g;
  if (psi >= points[points.length - 1].psi) return points[points.length - 1].g;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (psi >= a.psi && psi <= b.psi) {
      const t = (psi - a.psi) / (b.psi - a.psi || 1e-9);
      return a.g + t * (b.g - a.g);
    }
  }
  return points[points.length - 1].g;
}

/**
 * Scale G for thickness and drop heuristics.
 * Very rough but useful for early quoting:
 *  - Thickness: G ~ (t_ref / t)^0.5  (thicker foam → lower G)
 *  - Drop height: G ~ sqrt(drop / drop_ref)
 */
function applyScaling(gAtRef: number, thickness_in: number, drop_in: number): number {
  const t = Math.max(0.25, thickness_in || THICKNESS_REF_IN);
  const thicknessFactor = Math.sqrt(THICKNESS_REF_IN / t);
  const dropFactor = Math.sqrt((drop_in || DROP_REF_IN) / DROP_REF_IN);
  return gAtRef * thicknessFactor * dropFactor;
}

type Input = {
  weight_lbf?: number;
  area_in2?: number;
  thickness_in?: number;
  fragility_g?: number;
  drop_in?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Input;

    const weight = Math.max(0.01, Number(body.weight_lbf) || 0);
    const area   = Math.max(0.01, Number(body.area_in2)   || 0);
    const t_in   = Math.max(0.25, Number(body.thickness_in) || THICKNESS_REF_IN);
    const fragG  = Math.max(10, Number(body.fragility_g) || 50);
    const drop   = Math.max(6, Number(body.drop_in) || DROP_REF_IN);

    const psi = weight / area; // static stress

    // Evaluate every foam/deflection; pick best that meets fragility.
    type Cand = {
      foam: FoamCurve;
      defl: number;
      g_pred: number;
      g_raw: number;
      psi: number;
    };

    const cands: Cand[] = [];
    for (const foam of CURVES) {
      for (const s of foam.series) {
        const g24 = interp(s.points, psi);     // predicted G at 24" & 2"
        const gScaled = applyScaling(g24, t_in, drop);
        cands.push({ foam, defl: s.defl, g_pred: gScaled, g_raw: g24, psi });
      }
    }

    // Sort by predicted G ascending (we want the lowest that meets requirement).
    cands.sort((a, b) => a.g_pred - b.g_pred);

    // Pick first that meets fragility; if none, pick lowest G (warn).
    const winner = cands.find(c => c.g_pred <= fragG) ?? cands[0];

    // Build a chart series for the chosen foam at its best deflection.
    const seriesForChart = (() => {
      const s = winner.foam.series.find(x => x.defl === winner.defl)!;
      const pts = s.points.map(p => ({ psi: p.psi, g: applyScaling(p.g, t_in, drop) }));
      return {
        deflection_pct: Math.round(winner.defl * 100),
        points: pts,
      };
    })();

    // Return top-3 plus chart data
    const top3 = cands.slice(0, 3).map(c => ({
      foam_key: c.foam.key,
      foam_name: c.foam.name,
      density_lb_ft3: c.foam.density_lb_ft3,
      deflection_pct: Math.round(c.defl * 100),
      psi: c.psi,
      g_pred: Number(c.g_pred.toFixed(1)),
      g_raw_ref: Number(c.g_raw.toFixed(1)),
      meets_fragility: c.g_pred <= fragG,
    }));

    return NextResponse.json({
      ok: true,
      input: {
        weight_lbf: weight,
        area_in2: area,
        thickness_in: t_in,
        psi,
        fragility_g: fragG,
        drop_in: drop,
      },
      winner: {
        foam_key: winner.foam.key,
        foam_name: winner.foam.name,
        density_lb_ft3: winner.foam.density_lb_ft3,
        deflection_pct: Math.round(winner.defl * 100),
        g_pred: Number(winner.g_pred.toFixed(1)),
        meets_fragility: winner.g_pred <= fragG,
      },
      top3,
      chart: {
        series: seriesForChart,
        fragility_g: fragG,
      },
      note: "Prototype math using heuristic scaling; replace with vendor curves for production.",
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
