import { NextResponse } from "next/server";
import { tokenStore } from "@/lib/tokenStore";
import { hsFetch } from "@/lib/hubspot";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPortalNumber(portal?: string | null): number | undefined {
  if (!portal) return undefined;
  return /^\d+$/.test(portal) ? Number(portal) : undefined;
}

export async function GET(req: Request) {
  try {
    requireEnv();

    const url = new URL(req.url);
    const portalParam = url.searchParams.get("portal");
    const portal = toPortalNumber(portalParam);

    const rec = tokenStore.get(portal);
    if (!rec?.access_token) {
      return NextResponse.json({
        ok: true,
        portal: portal ?? "default",
        hasToken: false
      });
    }

    const r = await hsFetch(rec, `/oauth/v1/access-tokens/${encodeURIComponent(rec.access_token)}`);
    const data = await r.json().catch(() => ({}));

    return NextResponse.json({
      ok: r.ok,
      portal: portal ?? rec.hubId ?? "default",
      hasToken: true,
      tokenInfo: data
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
