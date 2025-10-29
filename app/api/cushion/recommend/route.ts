// app/api/cushion/recommend/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function pool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool!;
}

type CurvePt = { deflect_pct:number, g_level:number };

function interp(points: CurvePt[], defl: number): number | null {
  // points must be sorted by deflect_pct
  if (!points.length) return null;
  if (defl <= points[0].deflect_pct) return points[0].g_level;
  if (defl >= points[points.length-1].deflect_pct) return points[points.length-1].g_level;
  for (let i=0;i<points.length-1;i++){
    const a = points[i], b = points[i+1];
    if (defl >= a.deflect_pct && defl <= b.deflect_pct) {
      const t = (defl - a.deflect_pct)/(b.deflect_pct - a.deflect_pct);
      return a.g_level + t*(b.g_level - a.g_level);
    }
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const weight = Number(b.weight_lbf);
    const area   = Number(b.area_in2);
    const thick  = Number(b.thickness_in);
    const fragG  = Number(b.fragility_g ?? 50);
    const dropIn = Number(b.drop_in ?? 24);

    if (!(weight>0 && area>0 && thick>0)) {
      return NextResponse.json({ error: "weight_lbf, area_in2, thickness_in must be > 0" }, { status: 400 });
    }
    const staticPsi = weight/area;

    // Pull materials + price
    const mats = await pool().query(`
      SELECT id, name, kerf_waste_pct, price_per_bf,
             (price_per_bf/1728.0)::numeric(12,6) AS price_per_cuin
      FROM public.materials
      WHERE active IS DISTINCT FROM false
      ORDER BY id
    `);

    // Pull curve points near this static load
    const window = 0.25; // psi search window
    const { rows: pts } = await pool().query(`
      SELECT material_id, static_psi, deflect_pct, g_level
      FROM public.cushion_curves
      WHERE static_psi BETWEEN $1 AND $2
      ORDER BY material_id, deflect_pct
    `, [staticPsi - window, staticPsi + window]);

    // Assemble by material
    const byMat = new Map<number, CurvePt[]>();
    for (const r of pts) {
      const arr = byMat.get(r.material_id) || [];
      arr.push({ deflect_pct: Number(r.deflect_pct), g_level: Number(r.g_level) });
      byMat.set(r.material_id, arr);
    }

    type Cand = {
      material_id:number; material_name:string;
      static_psi:number; deflect_pct:number; g:number;
      est_piece_usd:number;
    };
    const cands: Cand[] = [];

    for (const m of mats.rows) {
      const mid = Number(m.id);
      const curve = byMat.get(mid);
      if (!curve || curve.length<2) continue;

      // try a sweep over allowable deflections (10%..70%)
      let best: {defl:number; g:number} | null = null;
      for (let d = 10; d<=70; d+=1){
        const g = interp(curve, d);
        if (g==null) continue;
        if (g <= fragG) {
          if (!best || g < best.g) best = {defl:d, g};
        }
      }
      if (!best) continue;

      // rough cost: area*thickness * $/cuin (doesn't include kerf rounding)
      const netCuIn = area * thick;
      const pricePerCuIn = Number(m.price_per_cuin);
      const estPieceUsd = Math.max(netCuIn * pricePerCuIn, Number(m.min_charge_usd ?? 0) || 0);

      cands.push({
        material_id: mid,
        material_name: String(m.name),
        static_psi: staticPsi,
        deflect_pct: best.defl,
        g: Number(best.g.toFixed(0)),
        est_piece_usd: Number(estPieceUsd.toFixed(2))
      });
    }

    cands.sort((a,b)=> (a.g-b.g) || (a.est_piece_usd - b.est_piece_usd));

    return NextResponse.json({
      input: { weight_lbf: weight, area_in2: area, thickness_in: thick, fragility_g: fragG, drop_in: dropIn, static_psi: Number(staticPsi.toFixed(3)) },
      recommendations: cands.slice(0, 8) // top 8
    }, { status: 200, headers: { "Cache-Control": "no-store" } });

  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
