// app/api/materials/route.ts
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

function N(x: any) { const n = Number(x); return isFinite(n) ? n : 0; }
function toPricePerCuIn(body: any) {
  const p_cuin = N(body.price_per_cuin);
  const p_cuft = N(body.price_per_cuft);
  const p_bf   = N(body.price_per_bf);
  return p_cuin || (p_cuft ? p_cuft / 1728 : 0) || (p_bf ? p_bf / 144 : 0);
}

// GET /api/materials
export async function GET() {
  try {
    const sql = `
      SELECT id, name,
             COALESCE(price_per_cuin, 0)  AS price_per_cuin,
             COALESCE(kerf_waste_pct, 0)  AS kerf_waste_pct,
             COALESCE(min_charge_usd, 0)  AS min_charge_usd,
             COALESCE(density_lb_ft3, 0)  AS density_lb_ft3
      FROM public.materials
      ORDER BY id
    `;
    const { rows } = await pool().query(sql);
    return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

// POST /api/materials  — UPSERT by name with created/updated flag
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const price_per_cuin = toPricePerCuIn(body);
    const kerf_waste_pct = N(body.kerf_waste_pct);
    const min_charge_usd = N(body.min_charge_usd);
    const density_lb_ft3 = N(body.density_lb_ft3);

    // Postgres trick: (xmax = 0) is true for freshly inserted rows, false for updated rows
    const sql = `
      INSERT INTO public.materials (name, price_per_cuin, kerf_waste_pct, min_charge_usd, density_lb_ft3)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (name) DO UPDATE
        SET price_per_cuin = EXCLUDED.price_per_cuin,
            kerf_waste_pct = EXCLUDED.kerf_waste_pct,
            min_charge_usd = EXCLUDED.min_charge_usd,
            density_lb_ft3 = EXCLUDED.density_lb_ft3
      RETURNING
        id, name, price_per_cuin, kerf_waste_pct, min_charge_usd, density_lb_ft3,
        (xmax = 0) AS inserted
    `;

    const { rows } = await pool().query(sql, [name, price_per_cuin, kerf_waste_pct, min_charge_usd, density_lb_ft3]);
    const r = rows[0];
    const upsert_action = r?.inserted ? "created" : "updated";
    const status = r?.inserted ? 201 : 200;

    return NextResponse.json(
      { ...r, upsert_action },
      { status }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
