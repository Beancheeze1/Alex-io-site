import { NextResponse } from "next/server";
import { getToken } from "@/lib/oauthStore.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/hubspot/records
 *   ?hubId=...&object=deals|companies|contacts
 *   [&id=123]                                -> fetch one by id
 *   [&limit=20] [&properties=dealname,amount,hs_object_id]
 *
 * POST /api/admin/hubspot/records
 *   body: { hubId, object, query: { property, operator, value }, limit, properties }
 *   -> uses CRM Search API
 */
function requireAdmin(req) {
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== (process.env.ADMIN_KEY || "dev-admin-key")) {
    return NextResponse.json({ ok:false, error:"unauthorized" }, { status:401 });
  }
  return null;
}

function bearerFor(hubId) {
  return getToken(hubId) || process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
}

export async function GET(req) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const hubId     = url.searchParams.get("hubId");
  const object    = url.searchParams.get("object") || "deals";
  const id        = url.searchParams.get("id");
  const limit     = Number(url.searchParams.get("limit") || "20");
  const properties= url.searchParams.get("properties") || "dealname,amount,hs_object_id";

  const token = bearerFor(hubId);
  if (!token) return NextResponse.json({ ok:false, error:"no token for hub" }, { status:401 });

  const base = `https://api.hubapi.com/crm/v3/objects/${object}`;
  const headers = { Authorization: `Bearer ${token}` };

  if (id) {
    const r = await fetch(`${base}/${id}?properties=${encodeURIComponent(properties)}&archived=false`, { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return NextResponse.json({ ok:false, status:r.status, error:j }, { status:r.status });
    return NextResponse.json({ ok:true, object, result:j });
  }

  // list recent (simple browse)
  const r = await fetch(`${base}?limit=${limit}&properties=${encodeURIComponent(properties)}&archived=false`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ ok:false, status:r.status, error:j }, { status:r.status });
  return NextResponse.json({ ok:true, object, results:j.results || [], paging:j.paging || null });
}

export async function POST(req) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const hubId     = body.hubId;
  const object    = body.object || "deals";
  const limit     = body.limit ?? 20;
  const properties= body.properties || "dealname,amount,hs_object_id";
  const query     = body.query; // { property, operator, value }

  const token = bearerFor(hubId);
  if (!token) return NextResponse.json({ ok:false, error:"no token for hub" }, { status:401 });

  if (!query?.property || !query?.operator || typeof query.value === "undefined") {
    return NextResponse.json({ ok:false, error:"query must have property, operator, value" }, { status:400 });
  }

  const payload = {
    limit,
    properties: properties.split(",").map(s => s.trim()).filter(Boolean),
    filterGroups: [
      { filters: [ { propertyName: query.property, operator: query.operator, value: `${query.value}` } ] }
    ]
  };

  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/${object}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ ok:false, status:r.status, error:j }, { status:r.status });

  return NextResponse.json({ ok:true, object, results:j.results || [], total:j.total ?? null });
}
