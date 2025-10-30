// app/api/db/diag/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

async function columnsFor(pool: any, table: string) {
  const cols = await pool.query(
    `
    SELECT
      c.column_name   AS name,
      c.data_type     AS type,
      c.is_nullable   AS nullable,
      c.column_default AS default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = $1
    ORDER BY c.ordinal_position
    `,
    [table]
  );
  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return { table, count: count.rows[0]?.n ?? 0, columns: cols.rows };
}

export async function GET() {
  try {
    const pool = getPool();
    const tables = ["materials", "price_rules", "cavities", "products"];

    const details: Record<string, any> = {};
    for (const t of tables) {
      try {
        details[t] = await columnsFor(pool, t);
      } catch (e: any) {
        details[t] = { table: t, error: String(e?.message || e) };
      }
    }

    // Also show constraints we might care about
    const constraints = await pool.query(`
      SELECT conname AS name, contype, conrelid::regclass AS on_table
      FROM pg_constraint
      WHERE conname LIKE 'products_%_fkey'
      ORDER BY conrelid::regclass::text, conname
    `);

    return NextResponse.json({ ok: true, details, constraints: constraints.rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
