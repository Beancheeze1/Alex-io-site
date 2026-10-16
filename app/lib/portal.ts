// app/lib/portal.ts
//
// Step 34A: loads the buyer portal (rules in app/lib/portal-core.ts).
//   - portalTenant(slug): the active shop behind /t/[slug]
//   - buyerQuoteCount / buyerOwnsQuote: quotes whose email (or customer's
//     email) is the buyer's, at that shop; demo quotes never count
//   - loadBuyerOrders(): the buyer's 50 most recent quotes with stage,
//     timeline, open actions and documents
// Totals shown are the ones the buyer agreed to (accepted / confirmed);
// estimates open the quote page for the live price. Step 36C: an accepted or
// confirmed order not yet in production is re-priced; if the price changed,
// it shows the new price, "please re-approve" and a Re-approve action.

import { one, q } from "@/lib/db";
import { computeApproval, type ApprovalRow } from "@/app/lib/quote-approval-core";
import { currentQuoteTotal, quoteTerms } from "@/app/lib/quote-approval";
import { shopFreightSettings } from "@/app/lib/freight";
import { isFreightTerms } from "@/app/lib/freight-core";
import { loadProofs } from "@/app/lib/proofs";
import { proofStage } from "@/app/lib/proofs-core";
import {
  REAPPROVE_LABEL,
  STAGE_LABEL,
  normEmail,
  openActions,
  orderStage,
  orderTimeline,
  trackingUrl,
  type OpenAction,
  type OrderFacts,
  type OrderStage,
  type TimelineStep,
} from "@/app/lib/portal-core";

export type PortalTenant = { id: number; slug: string; name: string };

export type PortalDoc = { label: string; url: string };

export type PortalOrder = {
  quote_no: string;
  created_at: string | null;
  stage: OrderStage;
  stage_label: string;
  total: number | null; // accepted / confirmed total (the new price when it changed)
  was_total?: number | null; // Step 36C: the accepted total, when the price changed since
  po: string | null;
  timeline: TimelineStep[];
  actions: OpenAction[];
  docs: PortalDoc[];
  shipped: { at: string; carrier: string | null; tracking: string | null; tracking_url: string | null; note: string | null } | null;
  open_url: string; // /api/portal/open?quote_no=…
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null || v === "" ? null : String(v));
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v));

/** Same match the quote lookup uses: the quote's email, else its customer's. */
const EMAIL_MATCH = `lower(trim(coalesce(nullif(qq.email, ''), c.email, ''))) = $2`;
const NOT_DEMO = `COALESCE((to_jsonb(qq) ->> 'is_demo')::boolean, false) = false AND qq.quote_no NOT LIKE 'Q-DEMO-%'`;

export async function portalTenant(slugRaw: unknown): Promise<PortalTenant | null> {
  const slug = typeof slugRaw === "string" ? slugRaw.trim().toLowerCase() : "";
  if (!/^[a-z0-9-]{1,63}$/.test(slug)) return null;
  const row = await one<{ id: number; slug: string; name: string }>(
    `SELECT id, slug, name FROM public.tenants WHERE slug = $1 AND active = true LIMIT 1`,
    [slug],
  );
  return row ? { id: Number(row.id), slug: row.slug, name: row.name } : null;
}

export async function buyerQuoteCount(tenantId: number, email: string): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM public.quotes qq LEFT JOIN public.customers c ON c.id = qq.customer_id
      WHERE qq.tenant_id = $1 AND ${EMAIL_MATCH} AND ${NOT_DEMO}`,
    [tenantId, normEmail(email)],
  );
  return Number(r?.n) || 0;
}

export async function buyerOwnsQuote(tenantId: number, email: string, quoteNo: string): Promise<string | null> {
  const r = await one<{ quote_no: string }>(
    `SELECT qq.quote_no
       FROM public.quotes qq LEFT JOIN public.customers c ON c.id = qq.customer_id
      WHERE qq.tenant_id = $1 AND ${EMAIL_MATCH} AND ${NOT_DEMO} AND upper(qq.quote_no) = $3
      LIMIT 1`,
    [tenantId, normEmail(email), String(quoteNo || "").trim().toUpperCase()],
  );
  return r?.quote_no ?? null;
}

type Row = { id: number; quote_no: string; j: Record<string, unknown> };

export async function loadBuyerOrders(tenantId: number, email: string, now: Date = new Date()): Promise<PortalOrder[]> {
  const rows = await q<Row>(
    `SELECT qq.id, qq.quote_no, to_jsonb(qq) AS j
       FROM public.quotes qq LEFT JOIN public.customers c ON c.id = qq.customer_id
      WHERE qq.tenant_id = $1 AND ${EMAIL_MATCH} AND ${NOT_DEMO}
      ORDER BY qq.created_at DESC, qq.id DESC
      LIMIT 50`,
    [tenantId, normEmail(email)],
  );
  const [terms, freight] = await Promise.all([quoteTerms(tenantId), shopFreightSettings(tenantId)]);
  const freightSetUp = !!freight.ship_from_zip;

  return Promise.all(
    rows.map(async (r) => {
      const j = r.j || {};
      const approvalRow: ApprovalRow = {
        created_at: str(j.created_at),
        priced_at: str(j.priced_at),
        expires_at: str(j.expires_at),
        lead_time_text: str(j.lead_time_text),
        accepted_at: str(j.accepted_at),
        accepted_name: str(j.accepted_name),
        accepted_po: str(j.accepted_po),
        accepted_total: j.accepted_total == null ? null : Number(j.accepted_total),
        accepted_by_staff: j.accepted_by_staff === true,
        confirmed_at: str(j.confirmed_at),
        confirmed_by: str(j.confirmed_by),
        confirmed_total: j.confirmed_total == null ? null : Number(j.confirmed_total),
      };
      const agreed = Number(approvalRow.confirmed_total ?? approvalRow.accepted_total ?? 0);
      // Step 36C: only accepted / confirmed orders not yet released or shipped can need re-approval.
      const live =
        approvalRow.accepted_at && j.locked !== true && !str(j.shipped_at) ? await currentQuoteTotal(r.quote_no).catch(() => null) : null;
      const approval = computeApproval(approvalRow, live != null && live > 0 ? live : agreed, terms, now);
      const changed = approval.stage === "needs_reapproval";
      const proofs = await loadProofs(Number(r.id), r.quote_no);
      const ps = proofStage(proofs);
      const approved = proofs.filter((p) => p.status === "approved").sort((a, b) => b.version - a.version)[0];
      const terms0 = isFreightTerms(j.freight_terms) ? j.freight_terms : null;

      const facts: OrderFacts = {
        created_at: iso(j.created_at),
        expires_at: approval.expires_at,
        accepted_at: approvalRow.accepted_at ?? null,
        accepted_name: approvalRow.accepted_name ?? null,
        confirmed_at: approvalRow.confirmed_at ?? null,
        locked: j.locked === true,
        locked_at: str(j.locked_at),
        shipped_at: str(j.shipped_at),
        shipped_carrier: str(j.shipped_carrier),
        shipped_tracking: str(j.shipped_tracking),
        proof: proofs.length
          ? {
              stage: ps.stage,
              version: ps.latest ? ps.latest.version : null,
              required: true,
              at: approved?.response?.at ?? null,
            }
          : null,
        ship_to_zip: str(j.ship_to_zip),
        terms: terms0,
        needs_reapproval: changed,
      };
      const stage = orderStage(facts, now);
      const openUrl = `/api/portal/open?quote_no=${encodeURIComponent(r.quote_no)}`;
      const docs: PortalDoc[] = [{ label: stage === "in_production" || stage === "shipped" ? "Order (printable)" : "Quote", url: openUrl }];
      const shownProof = approved ?? ps.latest;
      if (shownProof?.file) docs.push({ label: `Proof v${shownProof.version}${shownProof.status === "approved" ? " (approved)" : ""}`, url: shownProof.file.url });

      return {
        quote_no: r.quote_no,
        created_at: facts.created_at,
        stage,
        stage_label: changed ? REAPPROVE_LABEL : STAGE_LABEL[stage],
        total: changed ? approval.current_total : approval.confirmed?.total ?? approval.accepted?.total ?? null,
        was_total: changed ? approval.confirmed?.total ?? approval.accepted?.total ?? null : null,
        po: approvalRow.accepted_po ?? str(j.po_number),
        timeline: orderTimeline(facts),
        actions: openActions(facts, now, freightSetUp),
        docs,
        shipped: facts.shipped_at
          ? {
              at: facts.shipped_at,
              carrier: facts.shipped_carrier,
              tracking: facts.shipped_tracking,
              tracking_url: trackingUrl(facts.shipped_carrier, facts.shipped_tracking),
              note: str(j.shipped_note),
            }
          : null,
        open_url: openUrl,
      } satisfies PortalOrder;
    }),
  );
}
