// app/api/tenant/theme/route.ts
//
// Tenant-scoped theme endpoint (public-safe).
// - Reads middleware header x-tenant-slug
// - If missing, falls back to "default"
//
// Returns: { ok, tenant_slug, tenant_id, theme_json }
//
// Path A: read-only, fail-soft (never breaks the editor UI).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const tenantSlugHeader = (req.headers.get("x-tenant-slug") || "").trim();
    const tenantSlugFromHeader = tenantSlugHeader ? tenantSlugHeader.toLowerCase() : "";

    const qpTenant = (req.nextUrl.searchParams.get("tenant") || "").trim();
    const qpT = (req.nextUrl.searchParams.get("t") || "").trim();
    const tenantSlugFromQuery = (qpTenant || qpT).toLowerCase();

    const tenantSlug = tenantSlugFromHeader || tenantSlugFromQuery || "";
    const slugToFind = tenantSlug || "default";

    const row = await one<{
      id: number;
      slug: string;
      active: boolean;
      theme_json: any;
    }>(
      `
      select id, slug, active, theme_json
      from public.tenants
      where slug = $1
        and active = true
      limit 1
      `,
      [slugToFind],
    );

    if (!row) {
      return ok({
        ok: true,
        tenant_slug: tenantSlug || null,
        tenant_id: null,
        theme_json: {},
      });
    }

    return ok({
      ok: true,
      tenant_slug: row.slug,
      tenant_id: row.id,
      theme_json: row.theme_json || {},
    });
  } catch {
    // Fail-soft
    return ok({
      ok: true,
      tenant_slug: null,
      tenant_id: null,
      theme_json: {},
    });
  }
}
