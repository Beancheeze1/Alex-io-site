// app/api/admin/materials/route.ts
//
// Read-only materials listing for the admin UI.
// URL: /api/admin/materials
//
// Path A safe:
//  - SELECT-only from materials.
//  - No writes, no deletes, no changes to pricing or layout logic.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MaterialRow = {
  id: number;
  name: string;
  material_family: string | null;
  category: string | null;
  subcategory: string | null;
  sku: string | null;
  density_lb_ft3: string | number | null;
  cost_per_ci_usd: string | number | null;
  price_per_cuin: string | number | null;
  min_charge_usd: string | number | null;
  is_active: boolean | null;
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
    const rows = await q<MaterialRow>(
      `
      SELECT
        id,
        name,
        material_family,
        category,
        subcategory,
        sku,
        density_lb_ft3,
        cost_per_ci_usd,
        price_per_cuin,
        min_charge_usd,
        is_active
      FROM materials
      ORDER BY
        material_family NULLS LAST,
        name;
      `,
      [],
    );

    const materials = rows.map((r) => ({
      id: r.id,
      name: r.name,
      material_family: r.material_family,
      category: r.category,
      subcategory: r.subcategory,
      sku: r.sku,
      density_lb_ft3: r.density_lb_ft3,
      cost_per_ci_usd: r.cost_per_ci_usd,
      price_per_cuin: r.price_per_cuin,
      min_charge_usd: r.min_charge_usd,
      is_active: r.is_active ?? true,
    }));

    const total = materials.length;
    const active = materials.filter((m) => m.is_active).length;
    const inactive = total - active;

    const families = new Map<string, number>();
    for (const m of materials) {
      const fam = m.material_family || "Unspecified";
      families.set(fam, (families.get(fam) ?? 0) + 1);
    }

    const families_list = Array.from(families.entries()).map(
      ([family, count]) => ({ family, count }),
    );

    return ok({
      materials,
      stats: {
        total,
        active,
        inactive,
        families: families_list,
      },
    });
  } catch (err: any) {
    console.error("admin materials GET error:", err);
    return bad("admin_materials_exception", {
      message: String(err?.message || err),
    });
  }
}
