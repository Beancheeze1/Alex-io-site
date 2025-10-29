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

// Already have POST in this file from before; add GET:
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const productId = Number(params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: "bad product id" }, { status: 400 });
  }
  try {
    const { rows } = await getPool().query(
      `SELECT id, label, count, cav_length_in, cav_width_in, cav_depth_in, created_at
         FROM public.product_cavities
        WHERE product_id = $1
        ORDER BY id`,
      [productId]
    );
    return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
