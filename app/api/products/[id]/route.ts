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

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const b = await req.json();

    const fields = ["sku","name","description","base_length_in","base_width_in","base_height_in","material_id","default_qty","active"] as const;
    const updates: string[] = []; const values: any[] = [];
    for (const f of fields) {
      if (b[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(b[f]); }
    }
    if (!updates.length) return NextResponse.json({ error: "no updates" }, { status: 400 });
    values.push(id);

    const { rows } = await getPool().query(
      `UPDATE public.products SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length} RETURNING *;`, values
    );
    return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
