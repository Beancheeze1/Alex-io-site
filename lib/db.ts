// lib/db.ts
import { Pool, type QueryResultRow } from "pg";

declare global {
  // Reuse a single pool in dev/hot-reload
  // eslint-disable-next-line no-var
  var __pgPool__: Pool | undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function db(): Pool {
  if (!globalThis.__pgPool__) {
    globalThis.__pgPool__ = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return globalThis.__pgPool__!;
}

/** Back-compat alias (some routes import getPool/pool) */
export const getPool = db;
export const pool: Pool = db();

/**
 * Run a query and get typed rows back.
 * Usage: const rows = await q<{ id:number; name:string }>("SELECT id,name FROM t");
 */
export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const client = await db().connect();
  try {
    const res = await client.query<T>(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

/** Run a query and get a single row (or null). */
export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return (rows[0] ?? null) as T | null;
}
