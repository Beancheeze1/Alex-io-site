import { NextResponse } from "next/server";
import { tokenStore } from "../../../../lib/tokenStore"; // 4 ups

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const portal = searchParams.get("portal");
    if (!portal) {
      return NextResponse.json({ ok: false, error: "missing_portal_param" }, { status: 400 });
    }

    const rec = await tokenStore.get(portal);
    if (!rec) {
      return NextResponse.json({ ok: true, portal, exists: false });
    }
    return NextResponse.json({
      ok: true,
      portal,
      exists: true,
      expires_at: rec.expires_at,
      seconds_left: Math.max(0, rec.expires_at - Math.floor(Date.now() / 1000)),
      scopes: rec.scopes ?? []
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
