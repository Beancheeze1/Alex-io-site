// app/api/cushion/curves/route.ts
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mid = url.searchParams.get("material_id");
    const q = `
      SELECT cc.*, m.name AS material_name
      FROM public.cushion_curves cc
      JOIN public.materials m ON m.id = cc.material_id
      ${mid ? "WHERE cc.material_id = $1" : ""}
      ORDER BY cc.material_id, cc.static_psi, cc.deflect_pct
    `;
    const { rows } = await pool().query(q, mid ? [Number(mid)] : []);
    return NextResponse.json(rows, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: "items[]" }, { status: 400 });

    const values: any[] = [];
    const chunks: string[] = [];
    items.forEach((it: any, i: number) => {
      const base = i*5;
      chunks.push(`($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5})`);
      values.push(
        Number(it.material_id),
        Number(it.static_psi),
        Number(it.deflect_pct),
        Number(it.g_level),
        it.source ?? null
      );
    });

    const q = `
      INSERT INTO public.cushion_curves (material_id, static_psi, deflect_pct, g_level, source)
      VALUES ${chunks.join(",")}
      ON CONFLICT (material_id, static_psi, deflect_pct)
      DO UPDATE SET g_level = EXCLUDED.g_level,
                    source  = COALESCE(EXCLUDED.source, public.cushion_curves.source),
                    updated_at = now()
      RETURNING *;
    `;
    const { rows } = await pool().query(q, values);
    return NextResponse.json({ upserted: rows.length }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
