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
      SELECT m.name AS material_name, cc.material_id, cc.static_psi, cc.deflect_pct, cc.g_level, COALESCE(cc.source,'') AS source
      FROM public.cushion_curves cc
      JOIN public.materials m ON m.id = cc.material_id
      ${mid ? "WHERE cc.material_id = $1" : ""}
      ORDER BY cc.material_id, cc.static_psi, cc.deflect_pct
    `;
    const { rows } = await pool().query(q, mid ? [Number(mid)] : []);
    const header = "material_name,material_id,static_psi,deflect_pct,g_level,source";
    const csv = [
      header,
      ...rows.map(r =>
        [
          JSON.stringify(r.material_name),      // quote-safe
          r.material_id,
          Number(r.static_psi),
          Number(r.deflect_pct),
          Number(r.g_level),
          JSON.stringify(r.source ?? "")
        ].join(",")
      ),
    ].join("\r\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="cushion_curves${mid ? "_mat"+mid : ""}.csv"`,
      },
    });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
