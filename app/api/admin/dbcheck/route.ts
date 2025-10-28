// app/api/_admin/dbcheck/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function getPool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export async function GET() {
  try {
    const pool = getPool();
    const r1 = await pool.query("SELECT 1 AS ok");
    const r2 = await pool.query("SELECT to_regclass('public.v_product_pricing') AS view_exists");
    return NextResponse.json({ ok: r1.rows[0].ok, view: r2.rows[0].view_exists }, { status: 200 });
  } catch (err: any) {
    console.error("/api/_admin/dbcheck:", err);
    return NextResponse.json({ error: (err?.message || "").toString() }, { status: 500 });
  }
}
