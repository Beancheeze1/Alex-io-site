// app/lib/quote-approval.ts
//
// Step 28: server helpers for estimate -> accepted -> confirmed
// (rules in app/lib/quote-approval-core.ts).
//   - loadApprovalRow(quoteId): the quote's acceptance / confirmation / expiry
//     columns (read through to_jsonb, so it also works before migration 038)
//   - quoteTerms(tenantId): the shop's "quote valid" days and lead time
//   - currentQuoteTotal(quoteNo): the quote's grand total exactly as the quote
//     page shows it (internal call to /api/quote/print)
//   - approvalForQuote(...): all three together

import { one } from "@/lib/db";
import { internalHeaders } from "@/lib/internal-call";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { computeApproval, type ApprovalRow, type ApprovalTerms, type QuoteApproval } from "@/app/lib/quote-approval-core";

export async function loadApprovalRow(quoteId: number): Promise<ApprovalRow> {
  const row = await one<{ j: Record<string, unknown> | null }>(
    `SELECT to_jsonb(q) AS j FROM public.quotes q WHERE q.id = $1`,
    [quoteId],
  );
  const j = (row?.j || {}) as Record<string, unknown>;
  const s = (k: string) => (j[k] == null ? null : String(j[k]));
  return {
    created_at: s("created_at"),
    priced_at: s("priced_at"),
    expires_at: s("expires_at"),
    lead_time_text: s("lead_time_text"),
    accepted_at: s("accepted_at"),
    accepted_name: s("accepted_name"),
    accepted_po: s("accepted_po"),
    accepted_total: j.accepted_total == null ? null : Number(j.accepted_total),
    accepted_by_staff: j.accepted_by_staff === true,
    confirmed_at: s("confirmed_at"),
    confirmed_by: s("confirmed_by"),
    confirmed_total: j.confirmed_total == null ? null : Number(j.confirmed_total),
  };
}

export async function quoteTerms(tenantId: number): Promise<ApprovalTerms> {
  try {
    const s = (await getPricingSettings(tenantId)) as unknown as Record<string, unknown>;
    return {
      quote_valid_days: s.quote_valid_days == null ? null : Number(s.quote_valid_days),
      lead_time_text: typeof s.lead_time_text === "string" ? s.lead_time_text : null,
    };
  } catch {
    return { quote_valid_days: null, lead_time_text: null };
  }
}

/** The grand total the quote page shows (null if it can't be worked out). */
export async function currentQuoteTotal(quoteNo: string): Promise<number | null> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  try {
    const r = await fetch(`${base}/api/quote/print?quote_no=${encodeURIComponent(quoteNo)}&t=${Date.now()}`, {
      headers: { ...internalHeaders() },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; grandTotal?: unknown } | null;
    const n = Number(j?.grandTotal);
    return j?.ok && Number.isFinite(n) ? n : null;
  } catch (e) {
    console.error("[quote-approval] current total unavailable", { quoteNo, err: String(e) });
    return null;
  }
}

export async function approvalForQuote(quote: {
  id: number;
  quote_no: string;
  tenant_id: number;
}): Promise<QuoteApproval | null> {
  const total = await currentQuoteTotal(quote.quote_no);
  if (total == null) return null;
  const [row, terms] = await Promise.all([loadApprovalRow(quote.id), quoteTerms(Number(quote.tenant_id))]);
  return computeApproval(row, total, terms);
}
