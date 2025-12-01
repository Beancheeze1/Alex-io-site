// app/api/admin/materials/route.ts
//
// Admin materials API (Path A safe).
// - GET: list materials + key pricing fields (read-only).
// - POST: update density / min-charge / price_per_cuin / is_active.
//   Does NOT change any pricing math in code; it only updates config
//   in the materials table.
//
// Table columns used (from your schema screenshot):
//   id, name, material_family, density_lb_ft3, min_charge_usd,
//   price_per_cuin, is_active, active

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MaterialRow = {
  id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: string | number | null;
  min_charge_usd: string | number | null;
  price_per_cuin: string | number | null;
  is_active: boolean | null;
  active: boolean | null;
};

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(
  code: string,
  extra: Record<string, any> = {},
  status = 400,
) {
  return NextResponse.json(
    { ok: false, error: code, ...extra },
    { status },
  );
}

// Helper to normalize a numeric DB value (string | number | null) into number | null
function normalizeNumeric(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    return value;
  }
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n;
}

/** GET /api/admin/materials */
export async function GET(_req: NextRequest) {
  try {
    const rows = await q<MaterialRow>(
      `
      SELECT
        id,
        name,
        material_family,
        density_lb_ft3,
        min_charge_usd,
        price_per_cuin,
        is_active,
        active
      FROM materials
      ORDER BY material_family NULLS LAST, name;
      `,
      [],
    );

    const materials = rows.map((m) => ({
      id: m.id,
      name: m.name,
      material_family: m.material_family,
      density_lb_ft3: normalizeNumeric(m.density_lb_ft3),
      min_charge_usd: normalizeNumeric(m.min_charge_usd),
      price_per_cuin: normalizeNumeric(m.price_per_cuin),
      // some rows might still use "active" instead of is_active — prefer is_active when set
      is_active: m.is_active ?? m.active ?? true,
    }));

    return ok({ materials });
  } catch (err: any) {
    console.error("admin materials GET error:", err);
    return bad("materials_get_exception", {
      message: String(err?.message || err),
      status: 500,
    });
  }
}

/** POST /api/admin/materials
 *
 * Body:
 * {
 *   "id": number,
 *   "density_lb_ft3"?: number | null,
 *   "min_charge_usd"?: number | null,
 *   "price_per_cuin"?: number | null,
 *   "is_active"?: boolean
 * }
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("invalid_json", { status: 400 });
  }

  const id = Number(body?.id);
  if (!id || Number.isNaN(id)) {
    return bad("missing_id", { message: "Numeric id is required." });
  }

  const updates: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  function pushField(field: string, value: any) {
    updates.push(`${field} = $${paramIndex}`);
    params.push(value);
    paramIndex += 1;
  }

  if ("density_lb_ft3" in body) {
    const v = body.density_lb_ft3;
    pushField(
      "density_lb_ft3",
      v === null || v === "" ? null : Number(v),
    );
  }

  if ("min_charge_usd" in body) {
    const v = body.min_charge_usd;
    pushField(
      "min_charge_usd",
      v === null || v === "" ? null : Number(v),
    );
  }

  if ("price_per_cuin" in body) {
    const v = body.price_per_cuin;
    pushField(
      "price_per_cuin",
      v === null || v === "" ? null : Number(v),
    );
  }

  if ("is_active" in body) {
    const v = Boolean(body.is_active);
    // keep both flags in sync
    pushField("is_active", v);
    pushField("active", v);
  }

  if (updates.length === 0) {
    return bad("no_updatable_fields", {
      message:
        "Provide at least one of: density_lb_ft3, min_charge_usd, price_per_cuin, is_active.",
    });
  }

  // WHERE id = $N
  params.push(id);
  const whereIndex = paramIndex;

  const sql = `
    UPDATE materials
    SET ${updates.join(", ")},
        updated_at = NOW()
    WHERE id = $${whereIndex}
    RETURNING
      id,
      name,
      material_family,
      density_lb_ft3,
      min_charge_usd,
      price_per_cuin,
      is_active,
      active;
  `;

  try {
    const rows = await q<MaterialRow>(sql, params);
    if (!rows.length) {
      return bad("material_not_found", {
        message: `No material found for id=${id}`,
        status: 404,
      });
    }

    const m = rows[0];

    return ok(
      {
        material: {
          id: m.id,
          name: m.name,
          material_family: m.material_family,
          density_lb_ft3: normalizeNumeric(m.density_lb_ft3),
          min_charge_usd: normalizeNumeric(m.min_charge_usd),
          price_per_cuin: normalizeNumeric(m.price_per_cuin),
          is_active: m.is_active ?? m.active ?? true,
        },
      },
      200,
    );
  } catch (err: any) {
    console.error("admin materials POST error:", err);
    return bad("materials_update_exception", {
      message: String(err?.message || err),
      status: 500,
    });
  }
}
