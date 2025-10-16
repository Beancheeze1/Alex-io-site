import { NextResponse } from "next/server";
import { fetchCaps } from "@/lib/hubspotCaps.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const hubId = url.searchParams.get("hubId") || process.env.HUBSPOT_PORTAL_ID || null;

  // simple admin guard
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const rec = await fetchCaps(hubId); // may throw: no token, missing scope, etc.
    return NextResponse.json({
      ok: true,
      hubId,
      scopes: [...rec.scopes],
      quotingMode: rec.quotingMode,
      cached: !!rec.ts
    });
  } catch (err) {
    // return the actual reason instead of a 500
    return NextResponse.json(
      { ok: false, hubId, error: String(err) },
      { status: 200 }
    );
  }
}
