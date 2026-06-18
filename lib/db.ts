// lib/db.ts
import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
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
    const connectionString = requireEnv("DATABASE_URL");

    // Many managed Postgres providers (incl. Render) require SSL.
    // If the URL doesn’t include ssl params, add SSL with cert verification.
    // Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only for local dev with self-signed certs.
    const needsSsl =
      !/(\?|&)sslmode=/i.test(connectionString) && !/(\?|&)ssl=/i.test(connectionString);
    const rejectUnauthorized =
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

    globalThis.__pgPool__ = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 10_000,
      ssl: needsSsl ? { rejectUnauthorized } : undefined,
    });
  }
  return globalThis.__pgPool__!;
}

/** Back-compat aliases used by older routes */
export const getPool = db;
export const pool: Pool = db();

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

export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return (rows[0] ?? null) as T | null;
}

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

/** Health helper some routes import */
export async function dbPing() {
  const rows = await q<{ now: string; ver: string }>(
    "SELECT now()::text AS now, version() AS ver"
  );
  return rows[0];
}

export const query = q;
export const queryOne = one;
