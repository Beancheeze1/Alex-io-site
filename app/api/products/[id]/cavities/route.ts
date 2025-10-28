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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const productId = Number(params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return NextResponse.json({ error: "bad product id" }, { status: 400 });
  }
  try {
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [b];
    const pool = getPool();

    const inserted: any[] = [];
    for (const raw of items) {
      const label = String(raw.label || "").trim();
      const count = Math.max(1, Number(raw.count ?? 1));
      const L = Number(raw.cav_length_in);
      const W = Number(raw.cav_width_in);
      const D = Number(raw.cav_depth_in);
      if (!label || ![L,W,D].every(v => v > 0)) {
        return NextResponse.json({ error: "label and positive cavity dims required" }, { status: 400 });
      }
      const { rows } = await pool.query(
        `INSERT INTO public.product_cavities
           (product_id, label, count, cav_length_in, cav_width_in, cav_depth_in)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *;`,
        [productId, label, count, L, W, D]
      );
      inserted.push(rows[0]);
    }
    return NextResponse.json({ inserted }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
