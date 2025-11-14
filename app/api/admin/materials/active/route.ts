// app/api/admin/materials/active/route.ts
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const rows = await q<{
      id: number;
      name: string;
      category: string | null;
      subcategory: string | null;
      density_lb_ft3: number | null;
      kerf_pct: number | null;
      min_charge: number | null;
      active: boolean;
    }>(`
      SELECT
        id,
        name,
        category,
        subcategory,
        density_lb_ft3,
        kerf_waste_pct AS kerf_pct,       -- real column, aliased
        min_charge_usd AS min_charge,     -- real column, aliased
        active
      FROM materials
      WHERE active = true
      ORDER BY name ASC
      LIMIT 50
    `);

    return NextResponse.json(
      { ok: true, materials: rows },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("[admin/materials/active] error", e);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
