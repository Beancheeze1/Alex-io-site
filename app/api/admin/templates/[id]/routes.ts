// app/api/admin/templates/[id]/route.ts
import { NextResponse } from "next/server";
import { Pool } from "pg";

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

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at
     from templates where id = $1`,
    [params.id]
  );
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, item: rows[0] });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
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

  const pool = getPool();
  values.push(params.id);
  const { rows } = await pool.query(
    `update templates set ${fields.join(", ")}
     where id = $${i}
     returning id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at`,
    values
  );
  if (!rows.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: rows[0] });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const pool = getPool();
  const { rowCount } = await pool.query(`delete from templates where id = $1`, [params.id]);
  if (!rowCount) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH: /api/admin/templates/:id?action=activate
 * - Convenience endpoint to toggle active status
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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
    [params.id]
  );
  if (!rows.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: rows[0] });
}
