// app/api/admin/users/route.ts
//
// Admin-only user management (minimal).
// - GET: list users (safe fields only, no password_hash)
// - POST: create user (bcrypt hash -> users.password_hash)
//
// Enforced server-side via session cookie + role=admin.
//
// Uses existing auth helpers:
// - getCurrentUserFromRequest()
// - isRoleAllowed(["admin"])

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Err = { ok: false; error: string; message?: string };

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: Err, status = 400) {
  return NextResponse.json(body, { status });
}

function requireAdmin(user: any) {
  return isRoleAllowed(user, ["admin"]);
}

// ---------- GET: list users ----------
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!requireAdmin(user)) {
      return bad(
        {
          ok: false,
          error: "forbidden",
          message: "Admin role required.",
        },
        403,
      );
    }

    // Use `one()` only (no assumptions about multi-row helper):
    // Return a JSON array aggregated by Postgres.
    const row = await one<{ users: any }>(
      `
      select coalesce(
        json_agg(
          json_build_object(
            'id', id,
            'email', email,
            'name', name,
            'role', role,
            'sales_slug', sales_slug,
            'created_at', created_at,
            'updated_at', updated_at
          )
          order by id asc
        ),
        '[]'::json
      ) as users
      from public.users
      `,
      [],
    );

    return ok({ ok: true, users: row?.users ?? [] }, 200);
  } catch (err: any) {
    console.error("Error in GET /api/admin/users:", err);
    return bad(
      {
        ok: false,
        error: "server_error",
        message: "Unexpected error listing users. Check logs.",
      },
      500,
    );
  }
}

// ---------- POST: create user ----------
export async function POST(req: NextRequest) {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!requireAdmin(current)) {
      return bad(
        {
          ok: false,
          error: "forbidden",
          message: "Admin role required.",
        },
        403,
      );
    }

    const body = (await req.json().catch(() => null)) as any;

    const emailRaw = body?.email;
    const nameRaw = body?.name;
    const roleRaw = body?.role;
    const passwordRaw = body?.password;
    const salesSlugRaw = body?.sales_slug;

    if (
      typeof emailRaw !== "string" ||
      emailRaw.trim().length === 0 ||
      typeof nameRaw !== "string" ||
      nameRaw.trim().length === 0 ||
      typeof roleRaw !== "string" ||
      typeof passwordRaw !== "string" ||
      passwordRaw.length === 0
    ) {
      return bad(
        {
          ok: false,
          error: "invalid_payload",
          message: "Expected { email, name, role, password, sales_slug? }.",
        },
        400,
      );
    }

    const email = emailRaw.trim();
    const name = nameRaw.trim();
    const role = roleRaw.trim().toLowerCase();

    // Roles must match the RBAC helper contract (fail closed).
    if (!(role === "viewer" || role === "sales" || role === "cs" || role === "admin")) {
      return bad(
        {
          ok: false,
          error: "invalid_role",
          message: "Role must be one of: viewer, sales, cs, admin.",
        },
        400,
      );
    }

    const sales_slug =
      typeof salesSlugRaw === "string" && salesSlugRaw.trim().length > 0
        ? salesSlugRaw.trim()
        : null;

    // Hash password
    const password_hash = await bcrypt.hash(passwordRaw, 10);

    try {
      const created = await one<{
        id: number;
        email: string;
        name: string;
        role: string;
        sales_slug: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `
        insert into public.users (email, name, role, password_hash, sales_slug)
        values ($1, $2, $3, $4, $5)
        returning id, email, name, role, sales_slug, created_at, updated_at
        `,
        [email, name, role, password_hash, sales_slug],
      );

      return ok({ ok: true, user: created }, 200);
    } catch (dbErr: any) {
      const code = String(dbErr?.code || "");
      const msg = String(dbErr?.message || "");

      // Unique violations: email or sales_slug
      if (code === "23505") {
        // Try to be minimally helpful without parsing constraint names too hard.
        const isEmail = msg.includes("users_email_key") || msg.toLowerCase().includes("email");
        const isSlug = msg.includes("users_sales_slug_key") || msg.toLowerCase().includes("sales_slug");

        return bad(
          {
            ok: false,
            error: "duplicate",
            message: isEmail
              ? "That email already exists."
              : isSlug
                ? "That sales slug already exists."
                : "Duplicate value (unique constraint).",
          },
          409,
        );
      }

      console.error("DB error creating user:", dbErr);
      return bad(
        {
          ok: false,
          error: "db_error",
          message: "Failed to create user. Check logs.",
        },
        500,
      );
    }
  } catch (err: any) {
    console.error("Error in POST /api/admin/users:", err);
    return bad(
      {
        ok: false,
        error: "server_error",
        message: "Unexpected error creating user. Check logs.",
      },
      500,
    );
  }
}
// ---------- DELETE: delete user ----------
export async function DELETE(req: NextRequest) {
  try {
    const current = await getCurrentUserFromRequest(req);
    if (!requireAdmin(current)) {
      return bad(
        { ok: false, error: "forbidden", message: "Admin role required." },
        403,
      );
    }

    // Accept id from query string first: /api/admin/users?id=123
    // Fallback: JSON body { id: 123 } (in case the UI sends it that way).
    const url = new URL(req.url);
    const idParam = url.searchParams.get("id");

    let id: number | null =
      typeof idParam === "string" && idParam.trim().length > 0
        ? Number(idParam)
        : null;

    if (!Number.isFinite(id as any)) id = null;

    if (id === null) {
      const body = (await req.json().catch(() => null)) as any;
      const bodyId = body?.id;
      const n = typeof bodyId === "string" || typeof bodyId === "number" ? Number(bodyId) : NaN;
      if (Number.isFinite(n)) id = n;
    }

    if (id === null || !Number.isInteger(id) || id <= 0) {
      return bad(
        { ok: false, error: "invalid_payload", message: "Expected ?id=<number> (or JSON { id })." },
        400,
      );
    }

    // Prevent deleting yourself (easy way to lock admin out).
    if (Number(current?.id) === id) {
      return bad(
        { ok: false, error: "cannot_delete_self", message: "You cannot delete your own account." },
        400,
      );
    }

    // Confirm user exists (so we can return 404 cleanly).
    const exists = await one<{ id: number; email: string }>(
      `select id, email from public.users where id = $1`,
      [id],
    ).catch(() => null);

    if (!exists?.id) {
      return bad(
        { ok: false, error: "not_found", message: "User not found." },
        404,
      );
    }

    try {
      await one<{ id: number }>(
        `delete from public.users where id = $1 returning id`,
        [id],
      );

      return ok({ ok: true, deleted_id: id }, 200);
    } catch (dbErr: any) {
      const code = String(dbErr?.code || "");

      // Common FK constraint code (e.g., if user is referenced elsewhere).
      if (code === "23503") {
        return bad(
          {
            ok: false,
            error: "fk_constraint",
            message: "User cannot be deleted because it is referenced by other records.",
          },
          409,
        );
      }

      console.error("DB error deleting user:", dbErr);
      return bad(
        { ok: false, error: "db_error", message: "Failed to delete user. Check logs." },
        500,
      );
    }
  } catch (err: any) {
    console.error("Error in DELETE /api/admin/users:", err);
    return bad(
      { ok: false, error: "server_error", message: "Unexpected error deleting user. Check logs." },
      500,
    );
  }
}

