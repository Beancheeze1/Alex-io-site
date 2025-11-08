// app/lib/db_call_optional.ts
// Dependency-free optional DB helper. If DATABASE_URL is set and the 'postgres'
// package happens to be installed, we'll use it; otherwise we return null and
// callers should fall back (as cushion/recommend already does).

type SqlLike = (strings: TemplateStringsArray, ...values: any[]) => Promise<any>;
let _sql: any | null = null;

async function tryLoadPostgres(): Promise<SqlLike | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  try {
    // Avoid a static import so TypeScript doesn't require type declarations.
    // This executes at runtime only if DATABASE_URL is present.
    // eslint-disable-next-line no-new-func
    const dynamicImport = new Function(
      "spec",
      "return import(spec)"
    ) as (spec: string) => Promise<any>;

    const mod = await dynamicImport("postgres").catch(() => null);
    if (!mod || !mod.default) return null;

    // Create a tiny client (same shape as 'postgres' default export)
    _sql = mod.default(url, { max: 1, idle_timeout: 5 });
    return _sql;
  } catch {
    return null;
  }
}

/**
 * Run a parameterized query if a postgres client is available.
 * Returns { rows } or null if no client is available.
 */
export default async function runDb(query: string, params: any[]) {
  try {
    if (!_sql) {
      _sql = await tryLoadPostgres();
      if (!_sql) return null;
    }
    const rows = await _sql.unsafe(query, params);
    return { rows };
  } catch {
    return null;
  }
}
