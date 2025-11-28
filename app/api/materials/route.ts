// app/api/materials/route.ts
//
// Simple material list API for dropdowns.
// Returns: id, name, material_family, density_lb_ft3 for active materials.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

type MaterialRow = {
  id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean;
};

export async function GET(_req: NextRequest) {
  try {
    const rows = await q<MaterialRow>(
      `
      SELECT id, name, material_family, density_lb_ft3, is_active
      FROM materials
      WHERE is_active = TRUE
      ORDER BY material_family NULLS LAST, name
      `,
      [],
    );

    return NextResponse.json(
      {
        ok: true,
        materials: rows.map((r) => ({
          id: r.id,
          name: r.name,
          material_family: r.material_family,
          density_lb_ft3: r.density_lb_ft3,
        })),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error in GET /api/materials", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 },
    );
  }
}
