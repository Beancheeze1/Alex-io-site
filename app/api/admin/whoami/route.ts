// app/api/admin/whoami/route.ts
import { NextResponse } from "next/server";
import { kvPing } from "@/lib/kv";
import { tokenStore } from "@/lib/tokenStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // Keys persisted by the OAuth callback, e.g. "hubspot:access_token"
    const keys = tokenStore.listKeys();            // string[]
    const hasAccess  = keys.includes("hubspot:access_token");
    const hasRefresh = keys.includes("hubspot:refresh_token");

    // Optional: if you also persist by portal, try to read the first portal record
    // (kept as a non-failing best effort)
    let portal: number | undefined;
    let portalAccess = false;
    let portalRefresh = false;
    const maybePortal = keys.find(k => /^\d+$/.test(k));
    if (maybePortal) {
      portal = Number(maybePortal);
      const rec = tokenStore.get(portal);         // TokenRecord | undefined
      portalAccess  = !!rec?.access_token;
      portalRefresh = !!rec?.refresh_token;
    }

    const kv = await kvPing();

    return NextResponse.json({
      ok: true,
      authorized: hasAccess && hasRefresh,           // primary check (HubSpot keys)
      tokens: {
        access: hasAccess,
        refresh: hasRefresh,
        // bonus visibility if you’re also storing by portal
        portal,
        portalAccess,
        portalRefresh,
      },
      kv,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
