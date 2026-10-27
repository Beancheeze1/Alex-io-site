// lib/pdf/drawing-shop.ts
//
// Step 44: the shop's name for the title block of the 3-view PDF drawings
// (the tenant's brand name from its theme, else its name). Never throws: a
// drawing without the name falls back to "FOAM INSERT DRAWING".

import { one } from "@/lib/db";

export async function drawingShopName(tenantId: number | string | null | undefined): Promise<string | undefined> {
  if (tenantId == null || tenantId === "") return undefined;
  try {
    const row = await one<{ name: string | null; theme_json: unknown }>(
      `SELECT name, theme_json FROM public.tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    if (!row) return undefined;
    const th = row.theme_json && typeof row.theme_json === "object" ? (row.theme_json as Record<string, unknown>) : {};
    const brand = typeof th.brandName === "string" ? th.brandName.trim() : "";
    const name = (brand || String(row.name || "").trim()).slice(0, 60);
    return name || undefined;
  } catch {
    return undefined;
  }
}
