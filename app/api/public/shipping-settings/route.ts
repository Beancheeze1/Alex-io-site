// app/api/public/shipping-settings/route.ts
// Public read-only endpoint for the rough shipping estimate (% + cap).
// Used by the public quote page so it never calls an admin-protected route.
// Step 19: settings are per shop. Which shop: ?quote_no= (that quote's shop),
// else a real tenant subdomain, else the platform default.
import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { DEFAULT_SHIP_CAP_USD, DEFAULT_SHIP_PCT, loadShippingSettings } from "@/lib/shipping-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function tenantFor(req: NextRequest): Promise<number | null> {
  const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
  if (quoteNo) {
    const row = await one<{ tenant_id: number | null }>(
      `SELECT tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    ).catch(() => null);
    if (row?.tenant_id != null) return Number(row.tenant_id);
  }
  const slug = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
  if (slug && slug !== "default") {
    const t = await one<{ id: number }>(`SELECT id FROM public.tenants WHERE slug = $1 LIMIT 1`, [slug]).catch(() => null);
    if (t) return Number(t.id);
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const s = await loadShippingSettings(await tenantFor(req));
    return NextResponse.json({ ok: true, rough_ship_pct: s.rough_ship_pct, shipping_cap_usd: s.shipping_cap_usd });
  } catch {
    return NextResponse.json({ ok: true, rough_ship_pct: DEFAULT_SHIP_PCT, shipping_cap_usd: DEFAULT_SHIP_CAP_USD });
  }
}
