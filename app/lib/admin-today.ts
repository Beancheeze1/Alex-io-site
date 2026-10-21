// app/lib/admin-today.ts
//
// Step 38D: what the admin Home shows under "Needs you today": the review
// queue counts (same numbers as Quotes → Review queue, snoozed items left
// out), new spec requests, and the shop's latest quotes. Read-only; each
// part fails on its own (null) so Home still loads if one query breaks.

import { q } from "@/lib/db";
import { buildQueue } from "@/app/lib/review-queue";
import { sectionCounts, visibleItems } from "@/app/lib/review-queue-core";

export type TodayQuote = {
  quote_no: string;
  customer_name: string | null;
  status: string | null;
  locked: boolean;
  created_at: string;
};

export type AdminToday = {
  queue: { new: number; to_confirm: number; reapprove: number; proofs: number; needs_review: number; total: number } | null;
  newSpecRequests: number | null;
  latest: TodayQuote[] | null;
};

export async function loadAdminToday(tenantId: number): Promise<AdminToday> {
  const [queue, spec, latest] = await Promise.all([
    buildQueue(tenantId)
      .then((all) => sectionCounts(visibleItems(all, { now: new Date() })))
      .catch(() => null),
    q<{ n: string }>(`SELECT count(*)::text AS n FROM public.spec_requests WHERE tenant_id = $1 AND status = 'new'`, [tenantId])
      .then((r) => Number(r[0]?.n ?? 0))
      .catch(() => null),
    q<{ quote_no: string; customer_name: string | null; status: string | null; locked: boolean | null; created_at: string }>(
      `SELECT quote_no, customer_name, status, locked, created_at::text AS created_at
         FROM public."quotes"
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 5`,
      [tenantId],
    )
      .then((rows) => rows.map((r) => ({ ...r, locked: !!r.locked })))
      .catch(() => null),
  ]);
  return { queue, newSpecRequests: spec, latest };
}
