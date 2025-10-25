// lib/db.ts
import "server-only";
import pg from "pg"; // works well in ESM/Next
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 5),
  ssl: process.env.DATABASE_URL?.includes("sslmode=require") ? undefined : { rejectUnauthorized: false },
});

// keep a tiny ping to verify connectivity
export async function dbPing() {
  const r = await pool.query("select 1 as ok");
  return r.rows?.[0]?.ok === 1;
}

export async function getProductsBySkus(skus: string[]) {
  const r = await pool.query("select * from products where sku = any($1)", [skus]);
  return r.rows;
}

export { pool };
