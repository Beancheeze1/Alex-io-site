// app/api/admin/hubspot/caps/route.js
import { NextResponse } from "next/server";
import { getRecord } from "@lib/oauthStore.js";

export const runtime = "nodejs";

// GET /api/admin/hubspot/caps?hubId=244053164
// Requires header: x-admin-key: <your ADMIN_KEY>
export async function GET(req) {
  const url = new URL(req.url);
  const hubId = url.searchParams.get("hubId");
  const adminKey = req.headers.get("x-admin-key");

  if (adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!hubId) {
    return NextResponse.json({ ok: false, error: "missing hubId" }, { status: 400 });
  }

  const rec = getRecord(hubId);
  if (!rec) {
    return NextResponse.json({ ok: false, hubId, error: "No OAuth token stored for this hub" });
  }

  return NextResponse.json({
    ok: true,
    hubId,
    hasToken: !!rec.access_token,
    expires_at: rec.expires_at ?? null,
    scopes: rec.scopes ?? [],
  });
}
