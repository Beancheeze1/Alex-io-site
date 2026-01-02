// app/api/materials/options/route.ts
//
// NEW endpoint: Materials dropdown options for the quote form.
// - Does NOT modify any existing logic.
// - Reads materials from DB and returns a small options list.
// - Family is returned EXACTLY as stored in DB (material_family).
//
// Response:
//   [{ id, name, family, density_lb_ft3 }]
//
// NOTE: Requires `DATABASE_URL` and the `pg` package.
// If your project already connects to Postgres elsewhere, this is intentionally
// self-contained to avoid touching existing DB code.

import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Keep a single pool across hot reloads / lambda invocations.
declare global {
  // eslint-disable-next-line no-var
  var __alexio_pg_pool: Pool | undefined;
}

function getPool() {
  if (!global.__alexio_pg_pool) {
    const connectionString = requireEnv("DATABASE_URL");
    global.__alexio_pg_pool = new Pool({
      connectionString,
      // Render + managed PG often requires SSL; this setting is safe for many hosts.
      // If your DB explicitly rejects SSL, set PGSSLMODE=disable at the environment level instead.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global.__alexio_pg_pool;
}

type MaterialOption = {
  id: number;
  name: string;
  family: string;
  density_lb_ft3: number | null;
};

export async function GET() {
  try {
    const pool = getPool();

    // Minimal, dropdown-friendly shape.
    // IMPORTANT: family is returned EXACTLY as stored (material_family).
    const sql = `
      SELECT
        id,
        name,
        material_family AS family,
        density_lb_ft3
      FROM materials
      WHERE COALESCE(is_active, true) = true
      ORDER BY material_family ASC, density_lb_ft3 ASC NULLS LAST, name ASC
    `;

    const { rows } = await pool.query(sql);

    const options: MaterialOption[] = rows.map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      family: String(r.family),
      density_lb_ft3: r.density_lb_ft3 === null ? null : Number(r.density_lb_ft3),
    }));

    return NextResponse.json(options, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
