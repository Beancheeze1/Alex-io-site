// lib/db.ts
import { Pool, PoolClient } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing env: DATABASE_URL");

  // Auto-detect if SSL is required
  const needsSSL =
    process.env.PGSSLMODE?.toLowerCase() === "require" ||
    url.includes("sslmode=require") ||
    url.includes("ssl=true");

  _pool = new Pool({
    connectionString: url,
    max: 5,
    ssl: needsSSL ? { rejectUnauthorized: false } : undefined, // dev-safe; swap to CA pinning later if you want
  });

  return _pool;
}

/** Transaction helper */
export async function withTxn<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
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
