// app/api/admin/templates/[id]/route.ts
//
// Renamed from routes.ts (typo — Next.js App Router only registers exact
// filename "route.ts", so this file was previously dead code; every
// PUT/DELETE/PATCH here 404'd regardless of auth).
//
// Also fixes: params is a Promise in Next 16, but this file previously
// destructured it synchronously ({ params }: { params: { id: string } }),
// so params.id was always undefined. Awaited properly below.
//
// Uses requireAdmin() inline rather than the adminOnly() wrapper, since
// adminOnly only forwards the request to the handler and would drop the
// route's { params } context argument.

import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { requireAdmin } from "@/lib/admin-auth";

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

type ParamsCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: ParamsCtx) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const { id } = await ctx.params;
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at
     from templates where id = $1`,
    [id]
  );
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: rows[0] });
}

export async function PUT(req: NextRequest, ctx: ParamsCtx) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const { id } = await ctx.params;
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

  const fields: string[] = [];
  const values: any[] = [];
  let i = 1;

  function set(col: string, v: any) {
    fields.push(`${col} = $${i++}`);
    values.push(v);
  }

  if (tkey !== undefined) set("tkey", tkey);
  if (name !== undefined) set("name", name);
  if (subject !== undefined) set("subject", subject ?? "");
  if (body_html !== undefined) set("body_html", body_html ?? "");
  if (body_text !== undefined) set("body_text", body_text ?? "");
  if (vars !== undefined) set("vars", vars ?? {});
  if (is_active !== undefined) set("is_active", !!is_active);
  set("updated_at", new Date());

  if (!fields.length) {
    return NextResponse.json({ ok: false, error: "No fields to update" }, { status: 400 });
  }

  try {
    const pool = getPool();
    values.push(id);
    const { rows } = await pool.query(
      `update templates set ${fields.join(", ")}
       where id = $${i}
       returning id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at`,
      values
    );
    if (!rows.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, item: rows[0] });
  } catch (e: any) {
    if (String(e?.code) === "23505") {
      return NextResponse.json({ ok: false, error: "tkey already exists" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: e?.message || "failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: ParamsCtx) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const { id } = await ctx.params;
  const pool = getPool();
  const { rowCount } = await pool.query(`delete from templates where id = $1`, [id]);
  if (!rowCount) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH: /api/admin/templates/:id?action=activate
 * - Convenience endpoint to toggle active status
 */
export async function PATCH(req: NextRequest, ctx: ParamsCtx) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const { id } = await ctx.params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  if (action !== "activate") {
    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }
  const pool = getPool();
  const { rows } = await pool.query(
    `update templates set is_active = true, updated_at = now()
     where id = $1
     returning id, tkey, name, is_active, updated_at`,
    [id]
  );
  if (!rows.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: rows[0] });
}
