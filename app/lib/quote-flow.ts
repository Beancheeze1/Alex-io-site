// app/lib/quote-flow.ts
//
// Step 39R: the flow stage (app/lib/quote-flow-core.ts) for each quote on the
// admin quotes list, from the quote's own columns, the quote email log, the
// latest proof and the review queue (cached 60 s per shop). Any part that
// can't be read is skipped, so the list never fails because of it.

import { q } from "@/lib/db";
import { computeApproval } from "@/app/lib/quote-approval-core";
import { quoteTerms } from "@/app/lib/quote-approval";
import { buildQueue } from "@/app/lib/review-queue";
import { flowStage, type FlowStage } from "@/app/lib/quote-flow-core";

export type QuoteFlow = {
  stage: FlowStage;
  proof: "waiting" | "changes" | null; // latest proof is out, or the buyer asked for changes
  needs_review: boolean;
};

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch {
    return [];
  }
}

const str = (v: unknown) => (v == null || v === "" ? null : v instanceof Date ? v.toISOString() : String(v));

export async function quoteFlows(tenantId: number, quoteIds: number[], now: Date = new Date()): Promise<Map<number, QuoteFlow>> {
  const out = new Map<number, QuoteFlow>();
  const ids = Array.from(new Set(quoteIds.filter((n) => Number.isInteger(n) && n > 0)));
  if (!ids.length) return out;

  const [rows, mailed, proofs, terms, queue] = await Promise.all([
    safe(q<{ id: number; j: Record<string, unknown> }>(`SELECT id, to_jsonb(qq) AS j FROM public.quotes qq WHERE qq.tenant_id = $1 AND qq.id = ANY($2::int[])`, [tenantId, ids])),
    safe(
      q<{ quote_id: number }>(
        `SELECT DISTINCT quote_id FROM public.quote_emails WHERE quote_id = ANY($1::bigint[]) AND kind = 'quote' AND status = 'sent'`,
        [ids],
      ),
    ),
    safe(
      q<{ quote_id: number; status: string }>(
        `SELECT DISTINCT ON (quote_id) quote_id, status FROM public.quote_proofs WHERE quote_id = ANY($1::int[]) ORDER BY quote_id, version DESC`,
        [ids],
      ),
    ),
    quoteTerms(tenantId).catch(() => ({})),
    buildQueue(tenantId).catch(() => []),
  ]);

  const mailedSet = new Set(mailed.map((m) => Number(m.quote_id)));
  const proofOf = new Map(proofs.map((p) => [Number(p.quote_id), String(p.status)]));
  const reapprove = new Set(queue.filter((i) => i.section === "reapprove").map((i) => Number(i.quote_id)));
  const review = new Set(queue.filter((i) => i.section === "needs_review").map((i) => Number(i.quote_id)));

  for (const r of rows) {
    const id = Number(r.id);
    const j = r.j || {};
    const locked = j.locked === true;
    const agreed = Number(j.confirmed_total ?? j.accepted_total ?? 0) || 0;
    const approval = computeApproval(
      {
        created_at: str(j.created_at),
        priced_at: str(j.priced_at),
        expires_at: str(j.expires_at),
        accepted_at: str(j.accepted_at),
        accepted_total: j.accepted_total as number | null,
        confirmed_at: str(j.confirmed_at),
        confirmed_total: j.confirmed_total as number | null,
      },
      agreed,
      terms,
      now,
    );
    const status = String(j.status || "").toLowerCase();
    const proof = proofOf.get(id);
    out.set(id, {
      stage: flowStage({
        locked,
        shipped_at: str(j.shipped_at),
        accepted_at: str(j.accepted_at),
        confirmed_at: str(j.confirmed_at),
        reapprove: reapprove.has(id),
        expired: !locked && approval.expired,
        sent: status === "sent" || status === "revised" || mailedSet.has(id),
      }),
      proof: !locked && proof === "sent" ? "waiting" : !locked && proof === "changes" ? "changes" : null,
      needs_review: review.has(id),
    });
  }
  return out;
}
