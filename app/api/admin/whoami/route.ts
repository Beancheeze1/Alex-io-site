// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { getAnyToken, listPortals, refreshIfNeeded } from "@/lib/hubspot";

export const runtime = "nodejs";

export async function GET() {
  try {
    const bundle = await getAnyToken();
    const hubs = await listPortals();
    if (!bundle) {
      return NextResponse.json({ ok: true, hasToken: false, portals: hubs });
    }
    const fresh = await refreshIfNeeded(bundle);
    return NextResponse.json({
      ok: true,
      hasToken: true,
      hubId: fresh.hubId,
      expires_at: fresh.expires_at,
      portals: hubs,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
