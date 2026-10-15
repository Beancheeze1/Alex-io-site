// app/lib/review-queue.ts
//
// Step 32: builds a shop's review queue (rules in app/lib/review-queue-core.ts)
// from the quotes, approvals, proofs and review flags, plus the assignment /
// snooze state (quote_queue_state, migration 044). The result is cached for
// 60 s per shop (the totals need one quote-page calculation per accepted
// quote); assigning or snoozing clears the cache.

import { q } from "@/lib/db";
import { approvalForQuote } from "@/app/lib/quote-approval";
import { quoteReviewFlags } from "@/app/lib/pricing/foam-quote";
import { proofNeedsAttention, PROOF_WAIT_DAYS, type QueueItem, type QueueSection } from "@/app/lib/review-queue-core";

const CACHE_MS = 60_000;
const MAX_ACCEPTED = 60;
const MAX_REVIEW = 60;
const REVIEW_DAYS = 45;

type Cache = { at: number; items: QueueItem[] };
const cacheKey = (tenantId: number) => `__ALEXIO_REVIEW_QUEUE_${tenantId}__`;

export function clearQueueCache(tenantId: number): void {
  delete (globalThis as Record<string, unknown>)[cacheKey(tenantId)];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Base = { section: QueueSection; quote_id: number; quote_no: string; customer: string | null; since: string; detail: string };

async function safe<T>(p: Promise<T[]>): Promise<T[]> {
  try {
    return await p;
  } catch {
    return [];
  }
}

export async function buildQueue(tenantId: number, opts: { fresh?: boolean } = {}): Promise<QueueItem[]> {
  const g = globalThis as Record<string, unknown>;
  const c = g[cacheKey(tenantId)] as Cache | undefined;
  if (!opts.fresh && c && Date.now() - c.at < CACHE_MS) return c.items;

  const now = new Date();
  const out: Base[] = [];
  const customerName = (n: string | null) => (n && n.trim() && n.trim() !== "Customer" ? n.trim() : null);

  // New, not opened
  const fresh = await safe(
    q<{ id: number; quote_no: string; customer_name: string | null; created_at: unknown }>(
      `SELECT id, quote_no, customer_name, created_at
         FROM public.quotes
        WHERE tenant_id = $1 AND first_staff_view_at IS NULL AND COALESCE(locked, false) = false
        ORDER BY created_at ASC
        LIMIT 100`,
      [tenantId],
    ),
  );
  for (const r of fresh) {
    out.push({ section: "new", quote_id: Number(r.id), quote_no: r.quote_no, customer: customerName(r.customer_name), since: iso(r.created_at), detail: "No one has opened it yet." });
  }

  // Accepted: to confirm, or price changed since
  const accepted = await safe(
    q<{ id: number; quote_no: string; customer_name: string | null; accepted_at: unknown }>(
      `SELECT id, quote_no, customer_name, accepted_at
         FROM public.quotes
        WHERE tenant_id = $1 AND accepted_at IS NOT NULL AND COALESCE(locked, false) = false
        ORDER BY accepted_at ASC
        LIMIT ${MAX_ACCEPTED}`,
      [tenantId],
    ),
  );
  for (const r of accepted) {
    const a = await approvalForQuote({ id: Number(r.id), quote_no: r.quote_no, tenant_id: tenantId }).catch(() => null);
    if (!a) continue;
    if (a.stage === "accepted") {
      out.push({
        section: "to_confirm",
        quote_id: Number(r.id),
        quote_no: r.quote_no,
        customer: customerName(r.customer_name),
        since: iso(r.accepted_at),
        detail: `Accepted by ${a.accepted?.name || "the buyer"}${a.accepted?.po ? `, PO ${a.accepted.po}` : ""} at ${usd(a.current_total)}.`,
      });
    } else if (a.stage === "needs_reapproval") {
      const was = a.confirmed?.total ?? a.accepted?.total ?? 0;
      out.push({
        section: "reapprove",
        quote_id: Number(r.id),
        quote_no: r.quote_no,
        customer: customerName(r.customer_name),
        since: iso(r.accepted_at),
        detail: `Accepted at ${usd(was)}, now ${usd(a.current_total)}. Email the buyer to re-approve.`,
      });
    }
  }

  // Proofs
  const proofs = await safe(
    q<{ quote_id: number; quote_no: string; customer_name: string | null; version: number; status: string; sent_at: unknown; response_at: unknown; response_comment: string | null }>(
      `SELECT DISTINCT ON (p.quote_id) p.quote_id, qq.quote_no, qq.customer_name, p.version, p.status,
              p.sent_at, p.response_at, p.response_comment
         FROM public.quote_proofs p
         JOIN public.quotes qq ON qq.id = p.quote_id
        WHERE qq.tenant_id = $1 AND COALESCE(qq.locked, false) = false
        ORDER BY p.quote_id, p.version DESC`,
      [tenantId],
    ),
  );
  for (const p of proofs) {
    if (!proofNeedsAttention({ status: p.status, sent_at: iso(p.sent_at) }, now)) continue;
    out.push({
      section: "proofs",
      quote_id: Number(p.quote_id),
      quote_no: p.quote_no,
      customer: customerName(p.customer_name),
      since: p.status === "changes" ? iso(p.response_at) : iso(p.sent_at),
      detail:
        p.status === "changes"
          ? `Changes requested on proof v${p.version}: ${String(p.response_comment || "").slice(0, 140)}`
          : `Proof v${p.version} has waited ${PROOF_WAIT_DAYS}+ days for the buyer.`,
    });
  }

  // Needs review: recent unreleased quotes with review flags or a box without a price
  const recent = await safe(
    q<{ id: number; quote_no: string; customer_name: string | null; created_at: unknown; box_review: number }>(
      `SELECT qq.id, qq.quote_no, qq.customer_name, qq.created_at,
              (SELECT count(*)::int FROM public.quote_box_selections b
                WHERE b.quote_id = qq.id AND (to_jsonb(b) ->> 'needs_review') = 'true') AS box_review
         FROM public.quotes qq
        WHERE qq.tenant_id = $1 AND COALESCE(qq.locked, false) = false
          AND qq.created_at > now() - interval '${REVIEW_DAYS} days'
        ORDER BY qq.created_at DESC
        LIMIT ${MAX_REVIEW}`,
      [tenantId],
    ),
  );
  for (const r of recent) {
    const flags = await quoteReviewFlags(Number(r.id), r.quote_no, tenantId).catch(() => []);
    const msgs = flags.map((f) => f.message);
    if (Number(r.box_review) > 0) msgs.push(`${r.box_review} box line${Number(r.box_review) > 1 ? "s" : ""} priced from the nearest stock box (no board price).`);
    if (!msgs.length) continue;
    out.push({
      section: "needs_review",
      quote_id: Number(r.id),
      quote_no: r.quote_no,
      customer: customerName(r.customer_name),
      since: iso(r.created_at),
      detail: msgs.slice(0, 2).join(" ") + (msgs.length > 2 ? ` (+${msgs.length - 2} more)` : ""),
    });
  }

  // Assignment / snooze
  const ids = Array.from(new Set(out.map((i) => i.quote_id)));
  const states = ids.length
    ? await safe(
        q<{ quote_id: number; assigned_user_id: number | null; assigned_name: string | null; snoozed_until: unknown }>(
          `SELECT quote_id, assigned_user_id, assigned_name, snoozed_until
             FROM public.quote_queue_state WHERE quote_id = ANY($1::bigint[])`,
          [ids],
        ),
      )
    : [];
  const byId = new Map(states.map((s) => [Number(s.quote_id), s]));
  const items: QueueItem[] = out.map((b) => {
    const s = byId.get(b.quote_id);
    return {
      ...b,
      assigned_user_id: s?.assigned_user_id == null ? null : Number(s.assigned_user_id),
      assigned_name: s?.assigned_name ?? null,
      snoozed_until: s?.snoozed_until ? iso(s.snoozed_until) : null,
    };
  });
  g[cacheKey(tenantId)] = { at: Date.now(), items } satisfies Cache;
  return items;
}

/** Mark a quote as opened by staff (first time only). Never throws. */
export async function markStaffViewed(quoteId: number): Promise<void> {
  try {
    await q(`UPDATE public.quotes SET first_staff_view_at = now() WHERE id = $1 AND first_staff_view_at IS NULL`, [quoteId]);
  } catch {
    // before migration 044
  }
}
