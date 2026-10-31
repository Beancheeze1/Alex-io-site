// app/lib/shop-assets.ts
//
// Step 46: is the tenant_assets table there (migration 052)? Uploads say so
// plainly until it is; the page itself never depends on it.

import { one } from "@/lib/db";

let ready = false;

export async function shopAssetsReady(): Promise<boolean> {
  if (ready) return true;
  try {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tenant_assets'`,
    );
    ready = Number(r?.n) === 1;
  } catch {
    ready = false;
  }
  return ready;
}
