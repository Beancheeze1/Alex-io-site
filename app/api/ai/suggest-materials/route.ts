// app/api/ai/suggest-materials/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let _pool: Pool | null = null;
function pool() {
  if (_pool) return _pool;
  const { Pool } = require("pg");
  const cs = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.PG_CONNECTION_STRING;
  if (!cs) throw new Error("Missing DB env");
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 3 });
  return _pool!;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filter = body?.filter ?? {};           // { family, color, densityMin, densityMax }
    const searchWords: string[] = Array.isArray(body?.searchWords) ? body.searchWords : [];

    const client = await pool().connect();
    try {
      const wh: string[] = [];
      const params: any[] = [];
      let p = 1;

      if (filter.family) { wh.push(`LOWER(materials.name) LIKE $${p++}`); params.push(`%${String(filter.family).toLowerCase()}%`); }
      if (filter.color)  { wh.push(`LOWER(COALESCE(materials.color, '')) LIKE $${p++}`); params.push(`%${String(filter.color).toLowerCase()}%`); }
      if (filter.densityMin != null) { wh.push(`COALESCE(materials.density_lbft3, materials.density_pcf) >= $${p++}`); params.push(Number(filter.densityMin)); }
      if (filter.densityMax != null) { wh.push(`COALESCE(materials.density_lbft3, materials.density_pcf) <= $${p++}`); params.push(Number(filter.densityMax)); }

      // free-text match (name/vendor/notes if present)
      for (const w of searchWords.slice(0, 6)) {
        wh.push(`(
          LOWER(materials.name) LIKE $${p} OR
          LOWER(COALESCE(materials.vendor,''))
             LIKE $${p} OR
          LOWER(COALESCE(materials.notes,''))
             LIKE $${p}
        )`);
        params.push(`%${String(w).toLowerCase()}%`);
        p++;
      }

      const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
      const sql = `
        SELECT id, name,
               COALESCE(density_lbft3, density_pcf)::float AS density_pcf,
               COALESCE(color,'') AS color,
               COALESCE(kerf_pct,0)::float AS kerf_pct,
               COALESCE(price_per_ci,0)::float AS price_per_ci,
               COALESCE(price_per_bf,0)::float AS price_per_bf,
               COALESCE(min_charge,0)::float AS min_charge
        FROM materials
        ${where}
        ORDER BY price_per_ci NULLS LAST, price_per_bf NULLS LAST, id
        LIMIT 8;
      `;
      const r = await client.query(sql, params);

      return NextResponse.json({ ok:true, count:r.rowCount, items:r.rows }, { status:200 });
    } finally {
      client.release();
    }
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e?.message || "suggest-materials error" }, { status:500 });
  }
}
