import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool;
}

export async function GET() {
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, density_lb_ft3, price_per_bf,
              (price_per_bf/1728.0)::numeric(12,6) AS price_per_cuin,
              kerf_waste_pct, min_charge_usd, active
         FROM public.materials
         ORDER BY id;`
    );
    return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const name = String(b.name || "").trim();
    const density = Number(b.density_lb_ft3);
    // allow either price_per_bf OR price_per_cuin
    let pbf = b.price_per_bf != null ? Number(b.price_per_bf) : NaN;
    const pcu = b.price_per_cuin != null ? Number(b.price_per_cuin) : NaN;
    if (!isFinite(pbf) && isFinite(pcu)) pbf = pcu * 1728;

    const waste = Number(b.kerf_waste_pct ?? 10);
    const minc = Number(b.min_charge_usd ?? 0);
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!(density > 0)) return NextResponse.json({ error: "density_lb_ft3 must be > 0" }, { status: 400 });
    if (!(pbf > 0)) return NextResponse.json({ error: "Provide price_per_bf or price_per_cuin (> 0)" }, { status: 400 });

    const q = `INSERT INTO public.materials (name, density_lb_ft3, price_per_bf, kerf_waste_pct, min_charge_usd)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (name) DO UPDATE SET density_lb_ft3 = EXCLUDED.density_lb_ft3,
                                               price_per_bf    = EXCLUDED.price_per_bf,
                                               kerf_waste_pct  = EXCLUDED.kerf_waste_pct,
                                               min_charge_usd  = EXCLUDED.min_charge_usd,
                                               updated_at = now()
               RETURNING id, name, density_lb_ft3, price_per_bf,
                         (price_per_bf/1728.0)::numeric(12,6) AS price_per_cuin,
                         kerf_waste_pct, min_charge_usd, active;`;
    const { rows } = await getPool().query(q, [name, density, pbf, waste, minc]);
    return NextResponse.json(rows[0], { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
