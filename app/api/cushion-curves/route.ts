// app/api/cushion-curves/route.ts
//
// Summary view of cushion curve coverage by material.
// URL: /api/cushion-curves
//
// Read-only, admin-only style helper:
//  - One row per active material
//  - point_count and has_curve per material
//  - High-level stats for the admin dashboard
//
// Does NOT change foam advisor logic or any existing routes.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SummaryRow = {
  material_id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  point_count: number;
};

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(
  code: string,
  extra: Record<string, any> = {},
  status = 500,
) {
  return NextResponse.json(
    { ok: false, error: code, ...extra },
    { status },
  );
}

export async function GET(_req: NextRequest) {
  try {
    const rows = await q<SummaryRow>(
      `
      SELECT
        m.id               AS material_id,
        m.material_name    AS material_name,
        m.material_family  AS material_family,
        m.density_lb_ft3   AS density_lb_ft3,
        COUNT(c.*)         AS point_count
      FROM materials m
      LEFT JOIN cushion_curves c
        ON c.material_id = m.id
      WHERE m.is_active = TRUE
      GROUP BY
        m.id,
        m.material_name,
        m.material_family,
        m.density_lb_ft3
      ORDER BY
        m.material_family NULLS LAST,
        m.material_name;
      `,
      [],
    );

    const materials = rows.map((r) => {
      const pc = Number(r.point_count || 0);
      return {
        material_id: r.material_id,
        material_name: r.material_name,
        material_family: r.material_family,
        density_lb_ft3: r.density_lb_ft3,
        point_count: pc,
        has_curve: pc > 0,
      };
    });

    const withCurves = materials.filter((m) => m.has_curve);
    const withoutCurves = materials.filter((m) => !m.has_curve);

    const familySet = new Set<string>();
    for (const m of withCurves) {
      if (m.material_family) {
        familySet.add(m.material_family);
      }
    }

    return ok({
      materials,
      stats: {
        materials_with_curves: withCurves.length,
        materials_missing_curves: withoutCurves.length,
        distinct_families_with_curves: familySet.size,
      },
    });
  } catch (err: any) {
    console.error("cushion-curves summary GET error:", err);
    return bad("cushion_curves_summary_exception", {
      message: String(err?.message || err),
    });
  }
}
