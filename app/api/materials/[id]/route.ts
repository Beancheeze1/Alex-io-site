// app/api/materials/[id]/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _pool: Pool | null = null;
function pool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing env: DATABASE_URL");
    _pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  }
  return _pool!;
}

function N(x: any) { const n = Number(x); return isFinite(n) ? n : 0; }
function toPricePerCuIn(body: any) {
  const p_cuin  = N(body.price_per_cuin);
  const p_cuft  = N(body.price_per_cuft);
  const p_bf    = N(body.price_per_bf);
  return p_cuin || (p_cuft ? p_cuft / 1728 : 0) || (p_bf ? p_bf / 144 : 0);
}

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
    }

    const { rows } = await pool().query(
      `
      SELECT
        id,
        name,
        material_family,
        density_lb_ft3
      FROM public.materials
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!rows.length) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        material: rows[0],
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(_req: Request, ctx: { params: { id: string } }) {
  try {
    const id = Number(ctx.params.id);
    const body = await _req.json();

    const fields: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (typeof body.name === "string") { fields.push(`name = $${i++}`); vals.push(String(body.name).trim()); }
    if (body.price_per_cuin != null || body.price_per_cuft != null || body.price_per_bf != null) {
      fields.push(`price_per_cuin = $${i++}`); vals.push(toPricePerCuIn(body));
    }
    if (body.kerf_waste_pct != null) { fields.push(`kerf_waste_pct = $${i++}`); vals.push(N(body.kerf_waste_pct)); }
    if (body.min_charge_usd != null) { fields.push(`min_charge_usd = $${i++}`); vals.push(N(body.min_charge_usd)); }
    if (body.density_lb_ft3 != null) { fields.push(`density_lb_ft3 = $${i++}`); vals.push(N(body.density_lb_ft3)); }

    if (!fields.length) return NextResponse.json({ error: "no fields" }, { status: 400 });

    const sql = `
      UPDATE public.materials
      SET ${fields.join(", ")}
      WHERE id = $${i}
      RETURNING id, name, price_per_cuin, kerf_waste_pct, min_charge_usd, density_lb_ft3
    `;
    vals.push(id);
    const { rows } = await pool().query(sql, vals);
    if (!rows.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(rows[0], { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  try {
    const id = Number(ctx.params.id);
    const { rowCount } = await pool().query(`DELETE FROM public.materials WHERE id = $1`, [id]);
    if (!rowCount) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
