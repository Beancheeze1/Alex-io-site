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
      max: 5,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export async function GET() {
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT * FROM public.v_product_pricing ORDER BY sku;`
    );
    return NextResponse.json(rows, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/products error:", err);
    return NextResponse.json({ error: (err?.message || "").toString() }, { status: 500 });
  }
}
