// app/api/admin/tenants/[id]/route.ts
//
// Admin-only single-tenant management.
// GET   -> fetch one tenant by id
// PATCH -> update { name?, active?, theme_json? }
//
// Path A: minimal + explicit. No magic merges unless explicitly sent.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(error: string, message?: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

const THEME_EDIT_EMAIL_ALLOWLIST = new Set<string>([
  "25thhourdesign@gmail.com",
]);

function canEditTheme(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return THEME_EDIT_EMAIL_ALLOWLIST.has(email);
}

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

  const id = Number(ctx?.params?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return bad("invalid_id", "Invalid tenant id.", 400);
  }

  const tenant = await one(
    `
    select id, name, slug, active, theme_json, created_at
    from tenants
    where id = $1
    limit 1
    `,
    [id],
  );

  if (!tenant) {
    return bad("not_found", "Tenant not found.", 404);
  }

  return ok({ ok: true, tenant });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getCurrentUserFromRequest(req);
  if (!isRoleAllowed(user, ["admin"])) {
    return bad("forbidden", "Admin role required.", 403);
  }

if (!canEditTheme(user)) {
  return bad("forbidden", "Theme edits not allowed.", 403);
}

  const id = Number(ctx?.params?.id);
  if (!Number.isFinite(id) || id <= 0) {
    return bad("invalid_id", "Invalid tenant id.", 400);
  }

  const body = (await req.json().catch(() => null)) as any;
  if (!body || typeof body !== "object") {
    return bad("invalid_body", "Invalid JSON body.", 400);
  }

  // Only allow explicit fields
  const nameRaw = body?.name;
  const activeRaw = body?.active;
  const themeRaw = body?.theme_json;

  const name =
    typeof nameRaw === "string" ? nameRaw.trim() : undefined;

  const active =
    typeof activeRaw === "boolean" ? activeRaw : undefined;

  const theme_json =
    themeRaw !== undefined ? themeRaw : undefined; // allow {} or null if you want (explicit)

  if (name === undefined && active === undefined && theme_json === undefined) {
    return bad("no_changes", "Provide at least one field to update.", 400);
  }

  // Keep update explicit. If theme_json is provided, we set it as-is.
  const updated = await one(
    `
    update tenants
       set name = coalesce($2, name),
           active = coalesce($3, active),
           theme_json = coalesce($4::jsonb, theme_json)
     where id = $1
     returning id, name, slug, active, theme_json, created_at
    `,
    [
      id,
      name ?? null,
      active ?? null,
      theme_json !== undefined ? JSON.stringify(theme_json) : null,
    ],
  );

  if (!updated) {
    return bad("not_found", "Tenant not found.", 404);
  }

  return ok({ ok: true, tenant: updated }, 200);
}