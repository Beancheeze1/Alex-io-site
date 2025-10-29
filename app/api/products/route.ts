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

export async function GET(req: Request) {
  const pool = getPool();
  try {
    const url = new URL(req.url);
    const sku = (url.searchParams.get("sku") || "").trim();

    if (sku) {
      // return a single product row (from pricing view) by SKU
      const { rows } = await pool.query(
        `SELECT * FROM public.v_product_pricing WHERE sku = $1 LIMIT 1;`,
        [sku]
      );
      return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const { rows } = await pool.query(
      `SELECT * FROM public.v_product_pricing ORDER BY sku;`
    );
    return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("GET /api/products error:", err);
    return NextResponse.json({ error: (err?.message || "").toString() }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}


export async function POST(req: Request) {
  const pool = getPool();
  try {
    const b = await req.json();
    const sku = String(b.sku || "").trim();
    const name = String(b.name || "").trim();
    const material_id = Number(b.material_id);
    const L = Number(b.base_length_in);
    const W = Number(b.base_width_in);
    const H = Number(b.base_height_in);
    if (!sku || !name) return NextResponse.json({ error: "sku and name required" }, { status: 400 });
    if (!Number.isInteger(material_id) || material_id <= 0) return NextResponse.json({ error: "material_id must be a positive integer" }, { status: 400 });
    if (![L,W,H].every(v => v > 0)) return NextResponse.json({ error: "base_length_in, base_width_in, base_height_in must be > 0" }, { status: 400 });

    const { rows } = await pool.query(
      `INSERT INTO public.products (sku, name, description, base_length_in, base_width_in, base_height_in, material_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name,
                                       description = EXCLUDED.description,
                                       base_length_in = EXCLUDED.base_length_in,
                                       base_width_in  = EXCLUDED.base_width_in,
                                       base_height_in = EXCLUDED.base_height_in,
                                       material_id    = EXCLUDED.material_id,
                                       updated_at = now()
       RETURNING *;`,
      [sku, name, b.description ?? null, L, W, H, material_id]
    );
    return NextResponse.json(rows[0], { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("POST /api/products error:", err);
    return NextResponse.json({ error: (err?.message || "").toString() }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
