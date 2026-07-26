// app/api/public/shipping-settings/route.ts
// Public read-only endpoint for rough_ship_pct.
// Used by the public quote page so it never calls an admin-protected route.
import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SettingsRow = { rough_ship_pct: number | string; shipping_cap_usd: number | string | null };

export async function GET() {
  try {
    const row = await one<SettingsRow>(
      `SELECT rough_ship_pct, shipping_cap_usd FROM public.shipping_settings ORDER BY id ASC LIMIT 1`,
      [],
    ).catch(() => null);

    const rawPct = row?.rough_ship_pct ?? null;
    const pct = rawPct !== null ? Number(rawPct) : null;
    const safePct = pct !== null && Number.isFinite(pct) ? pct : 2.0;

    const rawCap = row?.shipping_cap_usd ?? null;
    const cap = rawCap !== null ? Number(rawCap) : null;
    const safeCap = cap !== null && Number.isFinite(cap) ? cap : 200.0;

    return NextResponse.json({ ok: true, rough_ship_pct: safePct, shipping_cap_usd: safeCap });
  } catch {
    return NextResponse.json({ ok: true, rough_ship_pct: 2.0, shipping_cap_usd: 200.0 });
  }
}
