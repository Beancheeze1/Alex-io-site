// app/api/admin/templates/route.ts
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

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `select id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at
     from templates
     order by updated_at desc nulls last, created_at desc`
  );
  return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const {
    tkey,
    name,
    subject = "",
    body_html = "",
    body_text = "",
    vars = {},
    is_active = false,
  } = body || {};

  if (!tkey || !name) {
    return NextResponse.json(
      { ok: false, error: "Missing required: tkey, name" },
      { status: 400 }
    );
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `insert into templates (tkey, name, subject, body_html, body_text, vars, is_active)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, tkey, name, subject, body_html, body_text, vars, is_active, created_at, updated_at`,
    [tkey, name, subject, body_html, body_text, vars, is_active]
  );
  return NextResponse.json({ ok: true, item: rows[0] }, { status: 201 });
}
