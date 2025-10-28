// app/api/products/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

// --- Singleton PG pool (no extra deps, Path-A minimal)
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
  const pool = getPool();
  try {
    const { rows } = await pool.query(
      `SELECT *
         FROM public.v_product_pricing
         ORDER BY sku;`
    );
    return NextResponse.json(rows, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/products error:", err);
    return NextResponse.json({ error: "Failed to load products" }, { status: 500 });
  }
}
