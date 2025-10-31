// lib/db.ts
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  // Reuse a single pool across hot reloads in dev
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

/** Back-compat aliases some routes expect */
export const getPool = db;
export const pool: Pool = db();

/** Run a query and get typed rows back */
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

/** Run a query and get a single row (or null) */
export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return (rows[0] ?? null) as T | null;
}

/**
 * withTxn — Back-compat transaction helper used by older routes.
 * Usage:
 *   await withTxn(async (tx) => {
 *     await tx.query("UPDATE ...");
 *   });
 */
export async function withTxn<R>(fn: (tx: PoolClient) => Promise<R>): Promise<R> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * dbPing — Back-compat health probe some routes import.
 * Returns an object with db time & version.
 */
export async function dbPing() {
  const rows = await q<{ now: string; ver: string }>(
    "SELECT now()::text AS now, version() AS ver"
  );
  return rows[0];
}

/** Extra compat names some codebases expect */
export const query = q;
export const queryOne = one;
