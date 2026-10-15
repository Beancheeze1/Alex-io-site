// lib/shipping-settings.ts
//
// Step 19: the rough shipping estimate (% of foam + packaging, with a $ cap)
// is set per shop. public.shipping_settings has one row per tenant
// (tenant_id); the row with tenant_id NULL is the platform default that a
// shop uses until it saves its own. Before migration 034 adds tenant_id,
// everything falls back to the old single global row.

import { one, q } from "@/lib/db";

export const DEFAULT_SHIP_PCT = 2.0;
export const DEFAULT_SHIP_CAP_USD = 200.0;

export type ShippingSettings = {
  rough_ship_pct: number;
  shipping_cap_usd: number;
  source: "shop" | "default";
};

type Row = { rough_ship_pct: number | string | null; shipping_cap_usd: number | string | null; tenant_id?: number | null };

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
}

function isSchemaError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** The shop's shipping settings, else the platform default, else built-in defaults. */
export async function loadShippingSettings(tenantId: number | null): Promise<ShippingSettings> {
  let row: Row | null = null;
  try {
    row = await one<Row>(
      `SELECT rough_ship_pct, shipping_cap_usd, tenant_id
         FROM public.shipping_settings
        WHERE tenant_id = $1 OR tenant_id IS NULL
        ORDER BY (tenant_id IS NULL), id
        LIMIT 1`,
      [tenantId],
    );
  } catch (e) {
    if (!isSchemaError(e)) throw e;
    // Before migration 034 (no tenant_id): the old single global row.
    row = await one<Row>(
      `SELECT rough_ship_pct, shipping_cap_usd FROM public.shipping_settings ORDER BY id ASC LIMIT 1`,
      [],
    ).catch(() => null);
  }
  return {
    rough_ship_pct: num(row?.rough_ship_pct, DEFAULT_SHIP_PCT),
    shipping_cap_usd: num(row?.shipping_cap_usd, DEFAULT_SHIP_CAP_USD),
    source: row && tenantId != null && Number(row.tenant_id) === Number(tenantId) ? "shop" : "default",
  };
}

/** Saves the shop's own row (creates it the first time). Requires migration 034. */
export async function saveShippingSettings(tenantId: number, pct: number, cap: number): Promise<void> {
  const updated = await q<{ id: number }>(
    `UPDATE public.shipping_settings
        SET rough_ship_pct = $2, shipping_cap_usd = $3
      WHERE tenant_id = $1
      RETURNING id`,
    [tenantId, pct, cap],
  );
  if (updated.length === 0) {
    await q(
      `INSERT INTO public.shipping_settings (tenant_id, rough_ship_pct, shipping_cap_usd) VALUES ($1, $2, $3)`,
      [tenantId, pct, cap],
    );
  }
}
