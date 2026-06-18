// app/api/public/shipping-settings/route.ts
// Public read-only endpoint for rough_ship_pct.
// Used by the public quote page so it never calls an admin-protected route.
import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SettingsRow = { rough_ship_pct: number | string };

export async function GET() {
  try {
    const row = await one<SettingsRow>(
      `SELECT rough_ship_pct FROM public.shipping_settings ORDER BY id ASC LIMIT 1`,
      [],
    ).catch(() => null);

    const raw = row?.rough_ship_pct ?? null;
    const pct = raw !== null ? Number(raw) : null;
    const safe = pct !== null && Number.isFinite(pct) ? pct : 2.0;

    return NextResponse.json({ ok: true, rough_ship_pct: safe });
  } catch {
    return NextResponse.json({ ok: true, rough_ship_pct: 2.0 });
  }
}
