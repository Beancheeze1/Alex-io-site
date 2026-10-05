// app/api/tenant/theme/route.ts
//
// Tenant-scoped theme endpoint (public-safe).
//
// Which tenant:
//   - A real tenant subdomain (x-tenant-slug other than "default") always wins.
//   - On the core host (api.alex-io.com, tagged "default" by middleware), a
//     valid ?tenant=<slug> is used, because the core host serves every shop's
//     /t/<slug> quote center and Start Quote / editor pass it through.
//   - Otherwise "default".
//   - ?t= is NOT a tenant here: callers use it as a cache-buster.
//
// Returns: { ok, tenant_slug, tenant_id, theme_json }
// theme_json is public: internal-only keys (specsEmail) are removed.
//
// Path A: read-only, fail-soft (never breaks the editor UI).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]{1,63}$/;
const PRIVATE_THEME_KEYS = ["specsEmail"];

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function publicTheme(theme: unknown): Record<string, unknown> {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return {};
  const out: Record<string, unknown> = { ...(theme as Record<string, unknown>) };
  for (const k of PRIVATE_THEME_KEYS) delete out[k];
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const fromHeader = (req.headers.get("x-tenant-slug") || "").trim().toLowerCase();
    const qp = (req.nextUrl.searchParams.get("tenant") || "").trim().toLowerCase();
    const fromQuery = SLUG_RE.test(qp) ? qp : "";

    const slugToFind =
      fromHeader && fromHeader !== "default"
        ? fromHeader
        : fromQuery || fromHeader || "default";

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
        tenant_slug: slugToFind || null,
        tenant_id: null,
        theme_json: {},
      });
    }

    return ok({
      ok: true,
      tenant_slug: row.slug,
      tenant_id: row.id,
      theme_json: publicTheme(row.theme_json),
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
