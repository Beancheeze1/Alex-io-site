// app/api/admin/materials/route.ts
//
// Materials for the admin UI (Step 20: per-shop prices).
// URL: /api/admin/materials
//
//  - GET: the shared catalog (public.materials) plus the signed-in admin's own
//    shop prices (public.tenant_material_prices), and is_owner.
//  - PATCH { id, scope: "shop", price_per_cuin, min_charge_usd, kerf_waste_pct }
//      saves the admin's own shop prices for one material. null = use the
//      catalog value; all null clears the shop's row.
//  - PATCH { id, scope: "catalog", price_per_cuin?, min_charge_usd? }
//      edits the shared catalog. Platform owner only (it's every shop's default).
//  - No changes to pricing math; only inputs.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireAdmin, isPlatformOwner } from "@/lib/admin-auth";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { listShopMaterialPrices, saveShopMaterialPrice, type ShopMaterialPrice } from "@/lib/material-prices";

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
  kerf_waste_pct: string | number | null;
  is_active: boolean | null;
};

const MATERIAL_COLS = `id, name, material_family, category, subcategory, sku, density_lb_ft3,
  cost_per_ci_usd, price_per_cuin, min_charge_usd, kerf_waste_pct, is_active`;

function ok(extra: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(code: string, extra: Record<string, unknown> = {}, status = 500) {
  return NextResponse.json({ ok: false, error: code, ...extra }, { status });
}

/** undefined = not sent; null = cleared; number = value. "bad" = not a non-negative number. */
function field(raw: unknown): number | null | undefined | "bad" {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return "bad";
  return n;
}

function shape(r: MaterialRow, shop: ShopMaterialPrice | undefined) {
  return {
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
    kerf_waste_pct: r.kerf_waste_pct,
    is_active: r.is_active ?? true,
    shop_price_per_cuin: shop?.price_per_cuin ?? null,
    shop_min_charge_usd: shop?.min_charge_usd ?? null,
    shop_kerf_waste_pct: shop?.kerf_waste_pct ?? null,
  };
}

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  try {
    const user = await getCurrentUserFromRequest(req);
    const tenantId = user?.tenant_id != null ? Number(user.tenant_id) : null;

    const rows = await q<MaterialRow>(
      `SELECT ${MATERIAL_COLS}
         FROM materials
        ORDER BY material_family NULLS LAST, name`,
      [],
    );
    const shop = tenantId != null && Number.isInteger(tenantId) ? await listShopMaterialPrices(tenantId) : new Map();

    const materials = rows.map((r) => shape(r, shop.get(Number(r.id))));

    const total = materials.length;
    const active = materials.filter((m) => m.is_active).length;
    const families = new Map<string, number>();
    for (const m of materials) {
      const fam = m.material_family || "Unspecified";
      families.set(fam, (families.get(fam) ?? 0) + 1);
    }

    return ok({
      materials,
      is_owner: isPlatformOwner(user),
      stats: {
        total,
        active,
        inactive: total - active,
        families: Array.from(families.entries()).map(([family, count]) => ({ family, count })),
      },
    });
  } catch (err) {
    console.error("admin materials GET error:", err);
    return bad("admin_materials_exception", { message: "Couldn't load materials." });
  }
}

export async function PATCH(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  try {
    const user = await getCurrentUserFromRequest(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return bad("invalid_id", { message: "A valid material id is required." }, 400);
    }
    const scope = body?.scope === "catalog" ? "catalog" : "shop";

    const price = field(body.price_per_cuin);
    const min = field(body.min_charge_usd);
    const kerf = field(body.kerf_waste_pct);
    if (price === "bad") return bad("invalid_price", { message: "Price per cu in must be 0 or more." }, 400);
    if (min === "bad") return bad("invalid_min_charge", { message: "Min charge must be 0 or more." }, 400);
    if (kerf === "bad" || (typeof kerf === "number" && kerf > 100)) {
      return bad("invalid_kerf", { message: "Waste % must be from 0 to 100." }, 400);
    }

    const mat = await q<MaterialRow>(`SELECT ${MATERIAL_COLS} FROM materials WHERE id = $1`, [id]);
    if (mat.length === 0) return bad("not_found", { message: `Material ${id} not found.` }, 404);

    if (scope === "catalog") {
      // The shared catalog is every shop's default: platform owner only.
      if (!isPlatformOwner(user)) {
        return bad("forbidden", { message: "Only the platform owner can change the shared catalog." }, 403);
      }
      const sets: string[] = [];
      const params: unknown[] = [id];
      if (price !== undefined) {
        sets.push(`price_per_cuin = $${params.length + 1}`);
        params.push(price);
      }
      if (min !== undefined) {
        sets.push(`min_charge_usd = $${params.length + 1}`);
        params.push(min);
      }
      if (sets.length === 0) return bad("nothing_to_update", { message: "No fields provided to update." }, 400);
      const updated = await q<MaterialRow>(
        `UPDATE materials SET ${sets.join(", ")} WHERE id = $1 RETURNING ${MATERIAL_COLS}`,
        params,
      );
      const shop = user?.tenant_id != null ? await listShopMaterialPrices(Number(user.tenant_id)) : new Map();
      return ok({ material: shape(updated[0], shop.get(id)) });
    }

    // scope "shop": the admin's own shop prices.
    const tenantId = Number(user?.tenant_id);
    if (!user || !Number.isInteger(tenantId) || tenantId <= 0) {
      return bad("no_tenant", { message: "Sign in as a shop admin to set your shop's prices." }, 400);
    }
    try {
      await saveShopMaterialPrice(tenantId, id, {
        price_per_cuin: price ?? null,
        min_charge_usd: min ?? null,
        kerf_waste_pct: kerf ?? null,
      });
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code === "42P01" || code === "42703") {
        return bad("not_migrated", { message: "Shop material prices need migration 035. Run migrations, then save again." }, 503);
      }
      throw e;
    }
    const shop = await listShopMaterialPrices(tenantId);
    return ok({ material: shape(mat[0], shop.get(id)) });
  } catch (err) {
    console.error("admin materials PATCH error:", err);
    return bad("admin_materials_patch_exception", { message: "Couldn't save the material." });
  }
}
