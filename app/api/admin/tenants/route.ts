// app/api/admin/tenants/route.ts
//
// Admin-only tenant management.
// GET  -> list tenants
// POST -> create tenant
//
// Tenant writes are OWNER-ONLY via email allowlist.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { q, withTxn } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(error: string, message?: string, status = 400) {
  return NextResponse.json({ ok: false, error, message }, { status });
}

const TENANT_WRITE_EMAIL_ALLOWLIST = new Set<string>(["25thhourdesign@gmail.com"]);

function canWriteTenants(user: any): boolean {
  const email = String(user?.email || "").trim().toLowerCase();
  return TENANT_WRITE_EMAIL_ALLOWLIST.has(email);
}

// Deterministic admin email strategy (global-unique users.email):
//   25thhourdesign+<tenant_slug>@gmail.com
const TENANT_ADMIN_EMAIL_BASE = "25thhourdesign";
const TENANT_ADMIN_EMAIL_DOMAIN = "gmail.com";

function adminEmailForSlug(slug: string): string {
  const s = String(slug || "").trim().toLowerCase();
  return `${TENANT_ADMIN_EMAIL_BASE}+${s}@${TENANT_ADMIN_EMAIL_DOMAIN}`;
}

function makeTempPassword(): string {
  // 20 chars, URL-safe, high entropy.
  return crypto.randomBytes(24).toString("base64url").slice(0, 20);
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

  const admin_email = adminEmailForSlug(slug);
  const temp_password = makeTempPassword();

  try {
    const result = await withTxn(async (tx) => {
      const tRes = await tx.query(
        `
        insert into tenants (name, slug)
        values ($1, $2)
        returning id, name, slug, active, theme_json, created_at
        `,
        [name, slug],
      );

      const tenant = tRes.rows?.[0];
      if (!tenant) throw new Error("Tenant insert returned no row.");

      const password_hash = await bcrypt.hash(temp_password, 10);

      // Seed a per-tenant admin user (email is globally unique due to +<slug> aliasing)
      await tx.query(
        `
        insert into users (email, name, role, tenant_id, password_hash)
        values ($1, $2, 'admin', $3, $4)
        `,
        [admin_email, `${name} Admin`, tenant.id, password_hash],
      );

      return { tenant };
    });

    // Return temp password ONCE (owner-only endpoint). UI should show it immediately.
    return ok({
      ok: true,
      tenant: result.tenant,
      admin_email,
      temp_password,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const low = msg.toLowerCase();

    // Friendly conflicts
    if (low.includes("unique") || low.includes("duplicate key")) {
      if (low.includes("tenants") && low.includes("slug")) {
        return bad("slug_taken", "That tenant slug already exists.", 409);
      }
      if (low.includes("users") && low.includes("email")) {
        return bad(
          "admin_email_taken",
          `Admin email already exists: ${admin_email}. Pick a different slug.`,
          409,
        );
      }
      return bad("conflict", "Conflict creating tenant. Slug or admin email may already exist.", 409);
    }

    return bad("create_failed", msg, 500);
  }
}