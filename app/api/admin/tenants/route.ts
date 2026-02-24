// app/api/admin/tenants/route.ts
//
// Admin-only tenant management.
// GET  -> list tenants
// POST -> create tenant

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
    return bad("create_failed", String(e?.message || e), 500);
  }
}