// lib/db.ts
import { Pool, PoolClient } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing env: DATABASE_URL");
  _pool = new Pool({ connectionString: url, max: 5 });
  return _pool;
}

/**
 * Run a function inside a BEGIN/COMMIT transaction.
 * If it throws, we ROLLBACK and rethrow.
 */
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
