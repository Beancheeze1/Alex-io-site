// app/api/admin/templates/route.ts
//
// CRUD list/create for the `templates` table (email templates managed via
// /admin/templates). GET returns { ok, items }, POST creates a new row.
//
// The email-preview/render diagnostic that used to live at GET here has
// moved to app/api/admin/templates/preview/route.ts — it was a different
// feature entirely (renders a sample email using the active template +
// signature) and didn't return the { items } shape this list page needs.

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { adminOnly } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __TEMPLATE_DB_POOL__: Pool | undefined;
}

function getPool() {
  if (!global.__TEMPLATE_DB_POOL__) {
    const conn = process.env.DATABASE_URL;
    if (!conn) throw new Error("Missing env: DATABASE_URL");
    global.__TEMPLATE_DB_POOL__ = new Pool({ connectionString: conn, max: 5 });
  }
  return global.__TEMPLATE_DB_POOL__;
}

export const GET = adminOnly(async (_req: NextRequest) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `select id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at
       from templates
       order by updated_at desc`
    );
    return NextResponse.json({ ok: true, items: rows });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "failed" }, { status: 500 });
  }
});

export const POST = adminOnly(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      tkey,
      name,
      subject,
      body_html,
      body_text,
      vars,
      is_active,
    } = body || {};

    if (!tkey || !name) {
      return NextResponse.json({ ok: false, error: "tkey and name are required" }, { status: 400 });
    }

    const pool = getPool();
    const { rows } = await pool.query(
      `insert into templates (tkey, name, subject, body_html, body_text, vars, is_active)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at`,
      [
        tkey,
        name,
        subject ?? "",
        body_html ?? "",
        body_text ?? "",
        vars ?? {},
        !!is_active,
      ]
    );
    return NextResponse.json({ ok: true, item: rows[0] }, { status: 201 });
  } catch (e: any) {
    if (String(e?.code) === "23505") {
      return NextResponse.json({ ok: false, error: "tkey already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "failed" }, { status: 500 });
  }
});
