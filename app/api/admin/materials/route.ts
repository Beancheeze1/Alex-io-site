// app/api/admin/materials/route.ts
//
// Materials listing & inline pricing updates for the admin UI.
// URL: /api/admin/materials
//
// Path A safe:
//  - GET: SELECT-only from materials.
//  - PATCH: updates price_per_cuin and/or min_charge_usd for a single row.
//  - No changes to pricing or layout logic, only DB inputs.

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

function toNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const priceRaw = body?.price_per_cuin;
    const minRaw = body?.min_charge_usd;

    if (!Number.isFinite(id) || id <= 0) {
      return bad(
        "invalid_id",
        { message: "A valid material id is required." },
        400,
      );
    }

    const price_per_cuin = toNumberOrNull(priceRaw);
    const min_charge_usd = toNumberOrNull(minRaw);

    // Nothing to update?
    if (
      price_per_cuin === null &&
      priceRaw === undefined &&
      min_charge_usd === null &&
      minRaw === undefined
    ) {
      return bad(
        "nothing_to_update",
        { message: "No fields provided to update." },
        400,
      );
    }

    const sets: string[] = [];
    const params: any[] = [id];

    if (priceRaw !== undefined) {
      sets.push(`price_per_cuin = $${params.length + 1}`);
      params.push(price_per_cuin);
    }

    if (minRaw !== undefined) {
      sets.push(`min_charge_usd = $${params.length + 1}`);
      params.push(min_charge_usd);
    }

    const setClause = sets.join(", ");

    const updatedRows = await q<MaterialRow>(
      `
      UPDATE materials
      SET ${setClause}
      WHERE id = $1
      RETURNING
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
        is_active;
      `,
      params,
    );

    if (!updatedRows || updatedRows.length === 0) {
      return bad(
        "not_found",
        { message: `Material with id ${id} not found.` },
        404,
      );
    }

    const r = updatedRows[0];

    const material = {
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
    };

    return ok({ material });
  } catch (err: any) {
    console.error("admin materials PATCH error:", err);
    return bad("admin_materials_patch_exception", {
      message: String(err?.message || err),
    });
  }
}
