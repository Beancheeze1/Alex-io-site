// app/lib/funnel.ts
//
// Step 35: loads the quotes the funnel is built from (rules in
// app/lib/funnel-core.ts): one shop's quotes, or every shop's for the
// platform owner, created in the last N days. Demo quotes never count.
// Estimates' expiry uses each shop's own "quote valid" days.

import { q } from "@/lib/db";
import { computeApproval, type ApprovalRow } from "@/app/lib/quote-approval-core";
import { quoteTerms } from "@/app/lib/quote-approval";
import type { FunnelQuote } from "@/app/lib/funnel-core";

export const MAX_FUNNEL_ROWS = 20000;

type Row = {
  quote_no: string;
  tenant_id: number;
  tenant_name: string | null;
  customer_name: string | null;
  created_at: unknown;
  j: Record<string, unknown>;
  has_items: boolean;
  has_boxes: boolean;
  emailed: boolean;
  ai_email: boolean;
  rep_name: string | null;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null || v === "" ? null : String(v));
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function loadFunnelQuotes(scope: { tenantId: number | null; days: number }): Promise<{ quotes: FunnelQuote[]; capped: boolean }> {
  const rows = await q<Row>(
    `SELECT qq.quote_no, qq.tenant_id, t.name AS tenant_name, qq.customer_name, qq.created_at, to_jsonb(qq) AS j,
            EXISTS (SELECT 1 FROM public.quote_items i WHERE i.quote_id = qq.id) AS has_items,
            EXISTS (SELECT 1 FROM public.quote_box_selections b WHERE b.quote_id = qq.id) AS has_boxes,
            EXISTS (SELECT 1 FROM public.quote_emails e WHERE e.quote_id = qq.id AND e.kind = 'quote' AND e.status = 'sent') AS emailed,
            EXISTS (SELECT 1 FROM public.quote_emails e WHERE e.quote_id = qq.id AND e.kind = 'quote' AND e.created_by = 'email / AI') AS ai_email,
            COALESCE(u.name, u.email) AS rep_name
       FROM public.quotes qq
       JOIN public.tenants t ON t.id = qq.tenant_id
       LEFT JOIN public."users" u ON u.id = qq.sales_rep_id
      WHERE ($1::bigint IS NULL OR qq.tenant_id = $1::bigint)
        AND qq.created_at >= now() - ($2::int * interval '1 day')
        AND COALESCE((to_jsonb(qq) ->> 'is_demo')::boolean, false) = false
        AND qq.quote_no NOT LIKE 'Q-D-%' AND qq.quote_no NOT LIKE 'Q-DEMO-%'
      ORDER BY qq.created_at DESC, qq.id DESC
      LIMIT ${MAX_FUNNEL_ROWS + 1}`,
    [scope.tenantId, scope.days],
  );
  const capped = rows.length > MAX_FUNNEL_ROWS;
  const terms = new Map<number, Awaited<ReturnType<typeof quoteTerms>>>();
  const termsFor = async (tid: number) => {
    if (!terms.has(tid)) terms.set(tid, await quoteTerms(tid));
    return terms.get(tid)!;
  };

  const out: FunnelQuote[] = [];
  for (const r of rows.slice(0, MAX_FUNNEL_ROWS)) {
    const j = r.j || {};
    const s = (k: string) => iso(j[k]);
    const row: ApprovalRow = {
      created_at: s("created_at"),
      priced_at: s("priced_at"),
      expires_at: s("expires_at"),
      accepted_at: s("accepted_at"),
      accepted_total: num(j.accepted_total),
      confirmed_at: s("confirmed_at"),
      confirmed_total: num(j.confirmed_total),
    };
    const approval = computeApproval(row, Number(row.confirmed_total ?? row.accepted_total ?? 0), await termsFor(Number(r.tenant_id)));
    const customer = r.customer_name && r.customer_name.trim() !== "Customer" ? r.customer_name.trim() : null;
    out.push({
      quote_no: r.quote_no,
      tenant_id: Number(r.tenant_id),
      tenant_name: r.tenant_name,
      customer,
      created_at: iso(r.created_at) || new Date(0).toISOString(),
      priced: r.has_items || r.has_boxes,
      emailed: r.emailed,
      ai_email: r.ai_email,
      quote_source: typeof j.quote_source === "string" ? j.quote_source : null,
      rep_id: j.sales_rep_id == null ? null : Number(j.sales_rep_id),
      rep_name: r.rep_name,
      reorder_of: typeof j.reorder_of === "string" && j.reorder_of ? j.reorder_of : null,
      accepted_at: row.accepted_at ?? null,
      accepted_total: num(j.accepted_total),
      confirmed_at: row.confirmed_at ?? null,
      confirmed_total: num(j.confirmed_total),
      released: j.locked === true,
      released_at: j.locked === true ? s("locked_at") : null,
      shipped_at: s("shipped_at"),
      expires_at: approval.expires_at,
    });
  }
  return { quotes: out, capped };
}

export async function funnelShops(): Promise<{ id: number; name: string; slug: string }[]> {
  const rows = await q<{ id: number; name: string; slug: string }>(`SELECT id, name, slug FROM public.tenants WHERE active = true ORDER BY name, id`, []);
  return rows.map((r) => ({ id: Number(r.id), name: r.name, slug: r.slug }));
}
