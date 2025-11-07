// app/api/ai/suggest-materials/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Pool } from "pg";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let _pool: Pool | null = null;
function pool() {
  if (_pool) return _pool;
  const { Pool } = require("pg");
  const cs =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PG_CONNECTION_STRING;
  if (!cs) throw new Error("Missing DB env");
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 3 });
  return _pool!;
}

type ColMap = {
  id: string | null;
  name: string | null;
  color: string | null;
  vendor: string | null;
  notes: string | null;
  density: string | null;
  price_ci: string | null;
  price_bf: string | null;
  kerf: string | null;
  min_charge: string | null;
};

async function getColMap(client: any): Promise<ColMap> {
  const rs = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND table_name = 'materials'`
  );
  const cols = new Set<string>(rs.rows.map((r:any)=>String(r.column_name).toLowerCase()));
  const pick = (...names: string[]) => names.find(n => cols.has(n.toLowerCase())) || null;

  return {
    id:         pick("id","material_id"),
    name:       pick("name","material_name","title"),
    color:      pick("color","colour"),
    vendor:     pick("vendor","supplier","mfr"),
    notes:      pick("notes","description","desc","details"),
    density:    pick("density_lbft3","density_pcf","density","pcf"),
    price_ci:   pick("price_per_ci","price_ci","price_per_cu_in"),
    price_bf:   pick("price_per_bf","price_bf"),
    kerf:       pick("kerf_pct","kerf","waste_pct"),
    min_charge: pick("min_charge","min_charge_usd","minimum_charge"),
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(()=>({}));
    const filter = body?.filter ?? {};
    const searchWords: string[] = Array.isArray(body?.searchWords) ? body.searchWords : [];

    const client = await pool().connect();
    try {
      const map = await getColMap(client);

      // SELECT list with safe aliases
      const sel = [
        map.id         ? `${map.id} AS id` : `NULL::text AS id`,
        map.name       ? `${map.name} AS name` : `NULL::text AS name`,
        map.color      ? `${map.color} AS color` : `NULL::text AS color`,
        map.vendor     ? `${map.vendor} AS vendor` : `NULL::text AS vendor`,
        map.notes      ? `${map.notes} AS notes` : `NULL::text AS notes`,
        map.density    ? `COALESCE(${map.density},0)::float AS density_pcf` : `0::float AS density_pcf`,
        map.kerf       ? `COALESCE(${map.kerf},0)::float AS kerf_pct` : `0::float AS kerf_pct`,
        map.price_ci   ? `COALESCE(${map.price_ci},0)::float AS price_per_ci` : `0::float AS price_per_ci`,
        map.price_bf   ? `COALESCE(${map.price_bf},0)::float AS price_per_bf` : `0::float AS price_per_bf`,
        map.min_charge ? `COALESCE(${map.min_charge},0)::float AS min_charge` : `0::float AS min_charge`,
      ].join(", ");

      const searchable = [map.name, map.vendor, map.notes].filter(Boolean) as string[];
      const wh: string[] = [];
      const params: any[] = [];
      let p = 1;

      // Density range (loose)
      if (map.density && (filter?.densityMin != null || filter?.densityMax != null)) {
        if (filter?.densityMin != null) { wh.push(`${map.density} >= $${p++}`); params.push(Number(filter.densityMin)); }
        if (filter?.densityMax != null) { wh.push(`${map.density} <= $${p++}`); params.push(Number(filter.densityMax)); }
      }

      // Family hint as substring in name
      if (map.name && filter?.family) {
        wh.push(`LOWER(${map.name}) LIKE $${p++}`);
        params.push(`%${String(filter.family).toLowerCase()}%`);
      }

      // Color exact/loose
      if (map.color && filter?.color) {
        wh.push(`LOWER(${map.color}) = $${p++}`);
        params.push(String(filter.color).toLowerCase());
      }

      // Free-text keywords across searchable fields
      if (searchable.length && searchWords?.length) {
        for (const w of searchWords.slice(0, 6)) {
          const like = `(${searchable.map(c=>`LOWER(${c}) LIKE $${p}`).join(" OR ")})`;
          wh.push(like);
          params.push(`%${String(w).toLowerCase()}%`);
          p++;
        }
      }

      // Build query
      const base = `SELECT ${sel} FROM materials`;
      const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";
      const orderBy = `
        ORDER BY
          (CASE WHEN ${map.price_ci ? `${map.price_ci} IS NULL` : "true"} THEN 1 ELSE 0 END),
          (CASE WHEN ${map.price_bf ? `${map.price_bf} IS NULL` : "true"} THEN 1 ELSE 0 END),
          ${map.name ?? "1"} NULLS LAST
      `;
      const limit = `LIMIT 8`;

      // First attempt with filters
      let sql = `${base} ${where} ${orderBy} ${limit}`;
      let r = await client.query(sql, params);

      // If too tight (no rows), fall back to a broad list
      if (!r.rowCount) {
        r = await client.query(`${base} ${orderBy} ${limit}`);
      }

      return NextResponse.json({ ok: true, count: r.rowCount, items: r.rows }, { status: 200 });
    } finally {
      client.release();
    }
  } catch (e: any) {
    return NextResponse.json({ ok:false, error: e?.message || "suggest-materials error" }, { status:500 });
  }
}
