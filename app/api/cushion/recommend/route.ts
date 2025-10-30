// app/api/cushion/recommend/route.ts
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Point = { psi: number; g: number };
type Series = { defl: number; points: Point[] };
type FoamCurve = { key: string; name: string; density_lb_ft3: number; series: Series[] };

const THICKNESS_REF_IN = 2.0;
const DROP_REF_IN = 24.0;

/** Embedded fallback curves (used if data/cushion_curves.json is missing) */
const FALLBACK_CURVES: FoamCurve[] = [
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

// replace the existing loadCurves() with this:
async function loadCurves(): Promise<FoamCurve[]> {
  const { readFile } = await import("fs/promises");
  const { join } = await import("path");
  try {
    // 1) prefer /tmp upload
    const tmp = join("/tmp", "cushion_curves.json");
    const txtTmp = await readFile(tmp, "utf8").catch(() => null as any);
    if (txtTmp) {
      const arr = JSON.parse(txtTmp);
      if (Array.isArray(arr)) return arr as FoamCurve[];
    }
  } catch {}
  try {
    // 2) then /data in repo
    const data = join(process.cwd(), "data", "cushion_curves.json");
    const txt = await (await import("fs/promises")).readFile(data, "utf8");
    const arr = JSON.parse(txt);
    if (Array.isArray(arr)) return arr as FoamCurve[];
  } catch {}
  // 3) fallback to embedded
  return FALLBACK_CURVES;
}


function interp(points: Point[], psi: number): number {
  if (!points.length) return Number.POSITIVE_INFINITY;
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

/** Thickness + drop scaling: g_scaled = g_ref * sqrt(drop/drop_ref) * sqrt(t_ref / t) */
function gScaled(gRef: number, thickness_in: number, drop_in: number) {
  const t = Math.max(0.25, thickness_in || THICKNESS_REF_IN);
  const dropFactor = Math.sqrt((drop_in || DROP_REF_IN) / DROP_REF_IN);
  const tFactor = Math.sqrt(THICKNESS_REF_IN / t);
  return gRef * dropFactor * tFactor;
}

/** Solve minimum thickness to meet a fragility limit at given gRef & drop. */
function minThicknessFor(gRef: number, fragG: number, drop_in: number) {
  const dropFactor = Math.sqrt((drop_in || DROP_REF_IN) / DROP_REF_IN);
  const need = (gRef * dropFactor) / Math.max(1e-6, fragG);
  // fragG >= gRef * dropFactor * sqrt(t_ref/t)  =>  t >= t_ref * (gRef*dropFactor/fragG)^2
  const tReq = THICKNESS_REF_IN * (need * need);
  const snapped = Math.max(0.25, Math.round(tReq * 8) / 8); // snap to 1/8"
  return { t_required_in: snapped, exact_in: tReq };
}

type Input = {
  weight_lbf?: number;
  area_in2?: number;
  thickness_in?: number;
  fragility_g?: number;
  drop_in?: number;
  overlay_count?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Input;

    const weight = Math.max(0.01, Number(body.weight_lbf) || 0);
    const area   = Math.max(0.01, Number(body.area_in2)   || 0);
    const t_in   = Math.max(0.25, Number(body.thickness_in) || THICKNESS_REF_IN);
    const fragG  = Math.max(10, Number(body.fragility_g) || 50);
    const drop   = Math.max(6, Number(body.drop_in) || DROP_REF_IN);
    const overlayCount = Math.min(4, Math.max(1, Math.floor(Number(body.overlay_count) || 3)));

    const psi = weight / area;
    const curves = await loadCurves();

    type Cand = { foam: FoamCurve; defl: number; g_ref: number; g_pred: number };
    const cands: Cand[] = [];

    for (const foam of curves) {
      for (const s of foam.series) {
        const gRef = interp(s.points, psi);
        const gPred = gScaled(gRef, t_in, drop);
        cands.push({ foam, defl: s.defl, g_ref: gRef, g_pred: gPred });
      }
    }

    cands.sort((a, b) => a.g_pred - b.g_pred);
    const winner = cands.find(c => c.g_pred <= fragG) ?? cands[0];

    // Overlay nearest deflections for the winner foam
    const winnerFoam = winner.foam;
    const deflsSorted = [...winnerFoam.series]
      .sort((a, b) => Math.abs(a.defl - winner.defl) - Math.abs(b.defl - winner.defl))
      .slice(0, overlayCount);

    const overlaySeries = deflsSorted.map(s => ({
      deflection_pct: Math.round(s.defl * 100),
      points: s.points.map(p => ({ psi: p.psi, g: gScaled(p.g, t_in, drop) })),
    }));

    // Per-foam minimum thickness
    const perFoam = curves.map(foam => {
      let best = { t_required_in: Infinity, deflection_pct: 0, g_ref_at_psi: Infinity };
      for (const s of foam.series) {
        const gRef = interp(s.points, psi);
        const m = minThicknessFor(gRef, fragG, drop);
        if (m.t_required_in < best.t_required_in) {
          best = { t_required_in: m.t_required_in, deflection_pct: Math.round(s.defl * 100), g_ref_at_psi: gRef };
        }
      }
      return {
        foam_key: foam.key,
        foam_name: foam.name,
        density_lb_ft3: foam.density_lb_ft3,
        deflection_pct: best.deflection_pct,
        min_thickness_in: Number(best.t_required_in.toFixed(3)),
        g_ref_at_psi: Number(best.g_ref_at_psi.toFixed(1)),
      };
    }).sort((a, b) => a.min_thickness_in - b.min_thickness_in);

    const overall = perFoam[0];

    return NextResponse.json({
      ok: true,
      input: { weight_lbf: weight, area_in2: area, thickness_in: t_in, psi, fragility_g: fragG, drop_in: drop },
      winner: {
        foam_key: winner.foam.key,
        foam_name: winner.foam.name,
        density_lb_ft3: winner.foam.density_lb_ft3,
        deflection_pct: Math.round(winner.defl * 100),
        g_pred: Number(winner.g_pred.toFixed(1)),
        meets_fragility: winner.g_pred <= fragG,
      },
      top3: cands.slice(0, 3).map(c => ({
        foam_key: c.foam.key,
        foam_name: c.foam.name,
        density_lb_ft3: c.foam.density_lb_ft3,
        deflection_pct: Math.round(c.defl * 100),
        g_pred: Number(c.g_pred.toFixed(1)),
        meets_fragility: c.g_pred <= fragG,
      })),
      chart: { overlays: overlaySeries, fragility_g: fragG },
      thickness_recommendation: { overall_min: overall, per_foam: perFoam },
      note: "Prototype scaling; swap data in data/cushion_curves.json for production curves.",
    }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
