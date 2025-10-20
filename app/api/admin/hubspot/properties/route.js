// app/api/admin/hubspot/properties/route.js
import { NextResponse } from "next/server";
import { getPortalAccessToken } from "@/lib/hsClient";
import { hsGetProperties } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok: false, status: 500, error: "ADMIN_KEY missing" };
  if (sent !== need) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

/**
 * GET /api/admin/hubspot/properties?portal=<hub_id>&object=contacts&limit=25
 * - Requires header: x-admin-key
 * - If ?portal is omitted, falls back to HUBSPOT_PORTAL_ID env
 * - Uses OAuth token for the portal (auto-refresh via getPortalAccessToken)
 */
export async function GET(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json(auth, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const portalParam = searchParams.get("portal");
  const object = (searchParams.get("object") || "contacts").toLowerCase();
  const limit = Number(searchParams.get("limit") || "25");

  const portal =
    portalParam != null
      ? Number(portalParam)
      : process.env.HUBSPOT_PORTAL_ID
      ? Number(process.env.HUBSPOT_PORTAL_ID)
      : undefined;

  if (!portal) {
    return NextResponse.json(
      { ok: false, error: "Missing portal (pass ?portal= or set HUBSPOT_PORTAL_ID)" },
      { status: 400 }
    );
  }

  try {
    // 1) get a valid OAuth access token for this portal
    const accessToken = await getPortalAccessToken(portal);

    // 2) fetch properties for the requested object
    const data = await hsGetProperties(accessToken, object);

    const results = Array.isArray(data?.results) ? data.results : [];
    const summary = results.slice(0, limit).map((p) => ({
      name: p?.name,
      label: p?.label ?? null,
      type: p?.type ?? null,
      fieldType: p?.fieldType ?? null,
      groupName: p?.groupName ?? null,
      createdAt: p?.createdAt ?? null,
      updatedAt: p?.updatedAt ?? null,
    }));

    return NextResponse.json({
      ok: true,
      portal,
      object,
      count: results.length,
      sampleCount: summary.length,
      properties: summary,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, portal, object, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
