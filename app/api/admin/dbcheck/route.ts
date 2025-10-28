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
    const ping = await pool.query("SELECT 1 AS ok, current_user, version()");
    const view = await pool.query("SELECT to_regclass('public.v_product_pricing') AS v");
    return NextResponse.json(
      {
        ok: ping.rows[0]?.ok ?? 0,
        user: ping.rows[0]?.current_user,
        view: view.rows[0]?.v, // should be "v_product_pricing"
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("/api/admin/dbcheck:", err);
    return NextResponse.json({ error: (err?.message || "").toString() }, { status: 500 });
  }
}
