// app/lib/quote-mail.ts
//
// Step 29A: buyer status emails and the quote email log.
//   - shopSender(tenantId, quoteId?): the shop name the buyer sees, where
//     replies go, the shop's link address and colors
//   - sendQuoteStatusEmail({ quoteId, kind, by }): accepted / confirmed /
//     reapprove / released, to the quote's buyer email. Respects the shop's
//     on/off settings (reapprove is only ever sent by staff on purpose).
//     Never throws; every outcome (sent / failed / skipped) is logged.
//   - logQuoteEmail() / recentQuoteEmails(): public.quote_emails (migration
//     039). Before the migration, logging is skipped and the list is empty.
// All mail goes out from the one Alex-IO mailbox (MS_MAILBOX_FROM) with the
// shop's name as the sender name and the shop's reply-to.

import { one, q } from "@/lib/db";
import { sendHtmlEmail } from "@/lib/email/send-html";
import { editLinkUrl } from "@/lib/quote-edit-token";
import { loadTenantPage } from "@/lib/tenant-page";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings, type PricingSettings } from "@/app/lib/pricing/settings";
import { approvalForQuote } from "@/app/lib/quote-approval";
import { isEmail, pickReplyTo, statusEmail, tenantBaseUrl, type StatusKind } from "@/app/lib/quote-mail-core";
import { trackingUrl } from "@/app/lib/portal-core";

export type ShopSender = {
  brand: string;
  slug: string | null;
  baseUrl: string;
  replyTo: string | null;
  primaryColor: string | null;
  onPrimary: string | null;
  logoUrl: string | null;
};

export type MailOutcome = { status: "sent" | "failed" | "skipped"; to: string | null; detail: string | null };

export type QuoteEmailRow = {
  id: number;
  kind: string;
  to_email: string | null;
  subject: string | null;
  status: string;
  detail: string | null;
  total: number | null;
  created_by: string | null;
  created_at: string;
};

const SETTING_FOR: Partial<Record<StatusKind, keyof PricingSettings>> = {
  accepted: "buyer_email_accepted",
  confirmed: "buyer_email_confirmed",
  released: "buyer_email_released",
  shipped: "buyer_email_shipped",
  expiring: "reminder_expiring_on",
  followup: "reminder_followup_on",
};

export async function shopSender(tenantId: number, quoteId?: number | null): Promise<ShopSender> {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const t = await one<{ slug: string; name: string }>(`SELECT slug, name FROM public.tenants WHERE id = $1`, [tenantId]).catch(
    () => null,
  );
  const page = t?.slug ? await loadTenantPage(t.slug).catch(() => null) : null;
  let setting = "";
  try {
    setting = String((await getPricingSettings(tenantId)).reply_to_email || "");
  } catch {
    // shop settings unavailable: fall back to the rep / page email
  }
  const rep = quoteId
    ? await one<{ email: string | null }>(
        `SELECT u.email FROM public.quotes q JOIN public."users" u ON u.id = q.sales_rep_id WHERE q.id = $1`,
        [quoteId],
      ).catch(() => null)
    : null;
  return {
    brand: page?.brandName || t?.name || "Alex-IO",
    slug: t?.slug || null,
    baseUrl: tenantBaseUrl(base, t?.slug || null),
    replyTo: pickReplyTo({ setting, rep: rep?.email, shop: page?.email }),
    primaryColor: page?.primaryColor || null,
    onPrimary: page?.onPrimary || null,
    logoUrl: page?.logoUrl || null,
  };
}

export async function logQuoteEmail(row: {
  quoteId: number;
  tenantId: number | null;
  kind: string;
  to: string | null;
  subject: string | null;
  status: MailOutcome["status"];
  detail: string | null;
  total: number | null;
  by: string | null;
}): Promise<void> {
  try {
    await q(
      `INSERT INTO public.quote_emails (quote_id, tenant_id, kind, to_email, subject, status, detail, total, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        row.quoteId,
        row.tenantId,
        row.kind,
        row.to,
        row.subject ? row.subject.slice(0, 250) : null,
        row.status,
        row.detail ? row.detail.slice(0, 500) : null,
        row.total,
        row.by ? row.by.slice(0, 120) : null,
      ],
    );
  } catch (e) {
    console.error("[quote-mail] log failed (migration 039?)", { quoteId: row.quoteId, kind: row.kind, err: String(e) });
  }
}

export async function recentQuoteEmails(quoteId: number, limit = 10): Promise<QuoteEmailRow[]> {
  try {
    const rows = await q<QuoteEmailRow>(
      `SELECT id, kind, to_email, subject, status, detail, total, created_by, created_at
         FROM public.quote_emails
        WHERE quote_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [quoteId, limit],
    );
    return rows.map((r) => ({ ...r, total: r.total == null ? null : Number(r.total) }));
  } catch {
    return [];
  }
}

export async function sendQuoteStatusEmail(opts: {
  quoteId: number;
  kind: StatusKind;
  by?: string | null;
  reapproval?: boolean;
  /** Step 29B: the follow-up's "we sent you this quote on …" date. */
  sentAt?: string | null;
  /** Step 29B: stored as the log row's detail when sent (reminders use it to send once). */
  logDetail?: string | null;
  /** Step 31: proof ready email. */
  proofVersion?: number | null;
  proofNote?: string | null;
}): Promise<MailOutcome> {
  const by = opts.by ?? null;
  try {
    const row = await one<{
      id: number;
      quote_no: string;
      tenant_id: number;
      email: string | null;
      customer_name: string | null;
      shipped_carrier: string | null;
      shipped_tracking: string | null;
      shipped_note: string | null;
    }>(
      `SELECT id, quote_no, tenant_id, email, customer_name,
              to_jsonb(q) ->> 'shipped_carrier' AS shipped_carrier,
              to_jsonb(q) ->> 'shipped_tracking' AS shipped_tracking,
              to_jsonb(q) ->> 'shipped_note' AS shipped_note
         FROM public.quotes q WHERE id = $1`,
      [opts.quoteId],
    );
    if (!row) return { status: "skipped", to: null, detail: "quote not found" };
    const tenantId = Number(row.tenant_id);
    const skip = async (detail: string, to: string | null = null): Promise<MailOutcome> => {
      await logQuoteEmail({ quoteId: row.id, tenantId, kind: opts.kind, to, subject: null, status: "skipped", detail, total: null, by });
      return { status: "skipped", to, detail };
    };

    const settingKey = SETTING_FOR[opts.kind];
    if (settingKey) {
      const settings = await getPricingSettings(tenantId).catch(() => null);
      if (settings && settings[settingKey] === false) return skip("turned off in Settings");
    }

    const to = isEmail(row.email) ? String(row.email).trim() : null;
    if (!to) return skip("no buyer email on the quote");

    const approval = await approvalForQuote({ id: row.id, quote_no: row.quote_no, tenant_id: tenantId });
    if (!approval) return skip("couldn't work out the quote total", to);

    const sender = await shopSender(tenantId, row.id);
    const facts = ((await loadFacts(row.quote_no).catch(() => null)) || {}) as { revision?: unknown };
    const link =
      editLinkUrl(`${sender.baseUrl}/quote?quote_no=${encodeURIComponent(row.quote_no)}`, row.quote_no) ||
      `${sender.baseUrl}/quote?quote_no=${encodeURIComponent(row.quote_no)}`;
    const customer = row.customer_name && row.customer_name.trim() !== "Customer" ? row.customer_name : null;
    const total =
      opts.kind === "confirmed" && approval.confirmed
        ? approval.confirmed.total
        : opts.kind === "accepted" && approval.accepted
          ? approval.accepted.total
          : approval.current_total;

    const { subject, html } = statusEmail(opts.kind, {
      brand: sender.brand,
      quoteNo: row.quote_no,
      link,
      total,
      buyerName: approval.accepted?.name || customer,
      previousTotal: approval.accepted?.total ?? approval.confirmed?.total ?? null,
      po: approval.accepted?.po || null,
      leadTime: approval.lead_time,
      validUntil: approval.expires_at,
      revision: typeof facts.revision === "string" && facts.revision.trim() ? facts.revision.trim() : null,
      reapproval: !!opts.reapproval,
      sentAt: opts.sentAt ?? null,
      proofVersion: opts.proofVersion ?? null,
      proofNote: opts.proofNote ?? null,
      shippedCarrier: row.shipped_carrier,
      shippedTracking: row.shipped_tracking,
      shippedNote: row.shipped_note,
      trackingUrl: opts.kind === "shipped" ? trackingUrl(row.shipped_carrier, row.shipped_tracking) : null,
      primaryColor: sender.primaryColor,
      onPrimary: sender.onPrimary,
      logoUrl: sender.logoUrl,
    });

    const r = await sendHtmlEmail({ to, subject, html, replyTo: sender.replyTo, replyToName: sender.brand, fromName: sender.brand });
    const outcome: MailOutcome = r.ok
      ? { status: "sent", to, detail: opts.logDetail ?? null }
      : { status: "failed", to, detail: opts.logDetail ? `${opts.logDetail}: ${r.error}` : r.error };
    await logQuoteEmail({
      quoteId: row.id,
      tenantId,
      kind: opts.kind,
      to,
      subject,
      status: outcome.status,
      detail: outcome.detail,
      total,
      by,
    });
    if (!r.ok) console.error("[quote-mail] send failed", { quoteNo: row.quote_no, kind: opts.kind, err: r.error });
    return outcome;
  } catch (e) {
    console.error("[quote-mail] failed", { quoteId: opts.quoteId, kind: opts.kind, err: String(e) });
    return { status: "failed", to: null, detail: "server error" };
  }
}
