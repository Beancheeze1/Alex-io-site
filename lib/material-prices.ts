// lib/material-prices.ts
//
// Step 20: per-shop material prices. public.materials is the shared catalog
// (edited by the platform owner). public.tenant_material_prices (migration
// 035) holds a shop's own price per cubic inch, minimum charge and kerf /
// waste % for a material; a NULL field (or no row) uses the catalog value.
// Every foam price goes through applyShopPrice() via /api/quotes/calc and
// computePricing (send-quote), so the quote page, emails, commissions, the
// AI/email path and sketches all price with the shop's numbers.

import { one, q } from "@/lib/db";

export type ShopMaterialPrice = {
  price_per_cuin: number | null;
  min_charge_usd: number | null;
  kerf_waste_pct: number | null;
};

export const SHOP_PRICE_FIELDS = ["price_per_cuin", "min_charge_usd", "kerf_waste_pct"] as const;
export type ShopPriceField = (typeof SHOP_PRICE_FIELDS)[number];

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isSchemaError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** A tenant id (number) from a number, numeric string or slug ("default"). null if none. */
export async function resolveTenantNumericId(t: number | string | null | undefined): Promise<number | null> {
  if (t === null || t === undefined || t === "") return null;
  const n = Number(t);
  if (Number.isInteger(n) && n > 0) return n;
  const row = await one<{ id: number }>(`SELECT id FROM public.tenants WHERE slug = $1 LIMIT 1`, [String(t)]).catch(
    () => null,
  );
  return row ? Number(row.id) : null;
}

/** The shop's own prices for one material, or null (none set, or before migration 035). */
export async function shopMaterialPrice(
  tenant: number | string | null | undefined,
  materialId: number,
): Promise<ShopMaterialPrice | null> {
  const tenantId = await resolveTenantNumericId(tenant);
  if (tenantId == null) return null;
  try {
    const row = await one<Record<string, unknown>>(
      `SELECT price_per_cuin, min_charge_usd, kerf_waste_pct
         FROM public.tenant_material_prices
        WHERE tenant_id = $1 AND material_id = $2`,
      [tenantId, materialId],
    );
    if (!row) return null;
    return {
      price_per_cuin: numOrNull(row.price_per_cuin),
      min_charge_usd: numOrNull(row.min_charge_usd),
      kerf_waste_pct: numOrNull(row.kerf_waste_pct),
    };
  } catch (e) {
    if (isSchemaError(e)) return null;
    throw e;
  }
}

/** Overwrites the catalog fields on a material row with the shop's non-null prices (in place). */
export function applyShopPrice<T extends { price_per_cuin: unknown; min_charge_usd: unknown; kerf_waste_pct: unknown }>(
  mat: T,
  shop: ShopMaterialPrice | null,
): T {
  if (!shop) return mat;
  const m = mat as Record<string, unknown>;
  for (const f of SHOP_PRICE_FIELDS) {
    if (shop[f] !== null) m[f] = shop[f];
  }
  return mat;
}

/** All of a shop's material prices, keyed by material id (empty before migration 035). */
export async function listShopMaterialPrices(tenantId: number): Promise<Map<number, ShopMaterialPrice>> {
  const out = new Map<number, ShopMaterialPrice>();
  try {
    const rows = await q<Record<string, unknown>>(
      `SELECT material_id, price_per_cuin, min_charge_usd, kerf_waste_pct
         FROM public.tenant_material_prices
        WHERE tenant_id = $1`,
      [tenantId],
    );
    for (const r of rows) {
      out.set(Number(r.material_id), {
        price_per_cuin: numOrNull(r.price_per_cuin),
        min_charge_usd: numOrNull(r.min_charge_usd),
        kerf_waste_pct: numOrNull(r.kerf_waste_pct),
      });
    }
  } catch (e) {
    if (!isSchemaError(e)) throw e;
  }
  return out;
}

/**
 * Saves a shop's prices for one material. null = use the catalog for that
 * field; all null removes the shop row. Requires migration 035.
 */
export async function saveShopMaterialPrice(
  tenantId: number,
  materialId: number,
  p: ShopMaterialPrice,
): Promise<void> {
  if (p.price_per_cuin === null && p.min_charge_usd === null && p.kerf_waste_pct === null) {
    await q(`DELETE FROM public.tenant_material_prices WHERE tenant_id = $1 AND material_id = $2`, [tenantId, materialId]);
    return;
  }
  await q(
    `INSERT INTO public.tenant_material_prices
       (tenant_id, material_id, price_per_cuin, min_charge_usd, kerf_waste_pct, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, material_id) DO UPDATE SET
       price_per_cuin = EXCLUDED.price_per_cuin,
       min_charge_usd = EXCLUDED.min_charge_usd,
       kerf_waste_pct = EXCLUDED.kerf_waste_pct,
       updated_at = now()`,
    [tenantId, materialId, p.price_per_cuin, p.min_charge_usd, p.kerf_waste_pct],
  );
}
