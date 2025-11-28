import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const rows = await q<{
      id: number;
      material_name: string;
      material_family: string | null;
      density_lb_ft3: number | null;
    }>(`
      select
        id,
        name as material_name,          -- FIXED: your DB has 'name', not 'material_name'
        material_family,
        density_lb_ft3
      from materials
      order by material_family, material_name;
    `);

    return NextResponse.json(
      {
        ok: true,
        materials: rows,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("GET /api/materials failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "Unable to load materials list.",
      },
      { status: 500 },
    );
  }
}
