import { NextResponse } from "next/server";
import { getToken } from "@/lib/oauthStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/hubspot/properties?hubId=...&object=deals
export async function GET(req) {
  const url = new URL(req.url);
  const hubId  = url.searchParams.get("hubId");
  const object = url.searchParams.get("object") || "deals"; // deals | companies | contacts

  // Optional admin guard (keep consistent with your other admin routes)
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // OAuth token (or PAT fallback if you set HUBSPOT_PRIVATE_APP_TOKEN)
  const token = getToken(hubId) || process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "no token for hub" }, { status: 401 });
  }

  const r = await fetch(`https://api.hubapi.com/crm/v3/properties/${object}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return NextResponse.json({ ok: false, status: r.status, error: j }, { status: r.status });
  }

  const properties = (j.results || []).map(p => ({
    internalName: p.name,   // <-- this is what you’ll use as &prop=
    label: p.label,
    fieldType: p.fieldType,
    groupName: p.groupName
  }));

  return NextResponse.json({ ok: true, object, count: properties.length, properties });
}
