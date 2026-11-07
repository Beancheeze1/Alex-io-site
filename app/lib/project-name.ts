// app/lib/project-name.ts
//
// Step 50: save a quote's project name (quotes.project_name, migration 054).
// Server only. Before the migration the column is missing: the save is
// skipped (returns false) instead of failing the request it rides on.

import { q } from "@/lib/db";
import { cleanProjectName } from "@/lib/project-name";

/** Sets (or clears, for blank) the project name of one quote of one shop. */
export async function setQuoteProjectName(quoteId: number, tenantId: number, raw: unknown): Promise<boolean> {
  const name = cleanProjectName(raw);
  try {
    await q(`UPDATE public.quotes SET project_name = $3 WHERE id = $1 AND tenant_id = $2`, [quoteId, tenantId, name]);
    return true;
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "42703") return false; // column not there yet
    throw e;
  }
}
