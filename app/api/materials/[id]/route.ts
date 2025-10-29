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
    const fields = ["name","density_lb_ft3","price_per_bf","kerf_waste_pct","min_charge_usd","active"] as const;

    const updates: string[] = [];
    const values: any[] = [];

    // accept price_per_cuin → convert to price_per_bf
    if (b.price_per_cuin != null && b.price_per_bf == null) {
      updates.push(`price_per_bf = $${values.length + 1}`);
      values.push(Number(b.price_per_cuin) * 1728);
    }

    for (const f of fields) {
      if (b[f] !== undefined) {
        updates.push(`${f} = $${values.length + 1}`);
        values.push(b[f]);
      }
    }
    if (!updates.length) return NextResponse.json({ error: "no updates" }, { status: 400 });

    values.push(id);
    const { rows } = await getPool().query(
      `UPDATE public.materials SET ${updates.join(", ")}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING id, name, density_lb_ft3, price_per_bf,
                 (price_per_bf/1728.0)::numeric(12,6) AS price_per_cuin,
                 kerf_waste_pct, min_charge_usd, active;`, values
    );
    return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const { rowCount } = await getPool().query(`DELETE FROM public.materials WHERE id = $1;`, [id]);
    return rowCount ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
