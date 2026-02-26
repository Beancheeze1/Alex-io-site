// app/api/admin/tenants/route.ts
//
// Admin-only tenant management.
// GET  -> list tenants
// POST -> create tenant
//
// Tenant writes are OWNER-ONLY via email allowlist.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(error: string, message?: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>([
  "25thhourdesign@gmail.com",
]);

function canWriteTenants(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(email);
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

  const tenants = await q(`
    select id, name, slug, active, theme_json, created_at
    from tenants
    order by id asc
  `);

  return ok({ ok: true, tenants });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

  // OWNER ONLY — no one else can create tenants
  if (!canWriteTenants(user)) {
    return bad("forbidden", "Tenant changes are restricted.", 403);
  }

  const body = await req.json().catch(() => null);
  const name = body?.name?.trim();
  const slug = body?.slug?.trim()?.toLowerCase();

  if (!name || !slug) {
    return bad("invalid_input", "name and slug required");
  }

  try {
    const rows = await q(
      `
      insert into tenants (name, slug)
      values ($1, $2)
      returning id, name, slug, active, theme_json, created_at
      `,
      [name, slug],
    );

    return ok({ ok: true, tenant: rows[0] });
  } catch (e: any) {
    const msg = String(e?.message || e);

    // Friendly conflict error for onboarding UX
    if (msg.toLowerCase().includes("tenants_slug") || msg.toLowerCase().includes("unique")) {
      return bad("slug_taken", "That tenant slug already exists.", 409);
    }

    return bad("create_failed", msg, 500);
  }
}