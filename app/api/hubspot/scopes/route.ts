// app/api/hubspot/scopes/route.ts
import { NextResponse } from "next/server";
import { tokenStore } from "../../../../lib/tokenStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const portal = url.searchParams.get("portal");
    if (!portal) {
      return NextResponse.json({ ok: false, error: "missing ?portal=PORTAL_ID" }, { status: 400 });
    }

    const rec = await tokenStore.get(portal);
    if (!rec) {
      return NextResponse.json({ ok: true, portal, hasToken: false });
    }

    // HubSpot token inspection: GET /oauth/v1/access-tokens/{token}
    const inspectUrl = `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(
      rec.access_token
    )}`;

    const res = await fetch(inspectUrl, { method: "GET", cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: `HubSpot ${res.status}: ${text || res.statusText}` }, { status: 500 });
    }
    const info = await res.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      portal,
      hasToken: true,
      expires_at: rec.expires_at,
      seconds_left: Math.max(0, rec.expires_at - Math.floor(Date.now() / 1000)),
      scopes: info?.scopes ?? rec.scopes ?? [],
      token_info: info
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
