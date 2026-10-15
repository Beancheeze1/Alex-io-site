// app/lib/reminders.ts
//
// Step 29B: the hourly reminder run (POST /api/cron/reminders, called by the
// GitHub Actions workflow .github/workflows/reminders.yml). For each active
// shop, using its Admin -> Settings -> Reminders:
//   - buyer "your quote expires soon": N days before an unaccepted quote
//     expires; once per expiry date (a reprice or a new staff date can send
//     another)
//   - buyer "any questions?": N days after the quote email if the buyer
//     hasn't accepted; once per quote email (an expiry reminder counts)
//   - staff daily digest at the shop's hour: accepted quotes waiting to be
//     confirmed, new quotes in the last 24 hours, quotes expiring in 3 days;
//     not sent when there's nothing to report
// Buyer reminders only go to quotes Alex-IO actually emailed to the buyer
// (a sent "quote" row in quote_emails), so older quotes and quotes the buyer
// never received are left alone. Rules: app/lib/reminders-core.ts.

import { one, q } from "@/lib/db";
import { sendHtmlEmail } from "@/lib/email/send-html";
import { getPricingSettings, type PricingSettings } from "@/app/lib/pricing/settings";
import { approvalForQuote } from "@/app/lib/quote-approval";
import { sendQuoteStatusEmail, shopSender } from "@/app/lib/quote-mail";
import { day, isEmail } from "@/app/lib/quote-mail-core";
import {
  approxExpiry,
  digestHasNews,
  expiringDue,
  expiringKey,
  followupDue,
  shopClock,
  staffDigestEmail,
  type DigestQuote,
} from "@/app/lib/reminders-core";

export type RunOptions = { now?: Date; dry?: boolean; digestNow?: boolean; tenantSlug?: string | null };

export type ShopResult = { shop: string; expiring: string[]; followup: string[]; digest: string; errors: string[] };
export type RunSummary = { ok: true; dry: boolean; at: string; shops: ShopResult[] };

const MAX_CANDIDATES = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function isoOf(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Claim a shop-level key before sending: "claimed", "taken" (already done) or "error" (e.g. no migration 040). */
export async function claimShopEmail(tenantId: number, kind: string, runKey: string): Promise<"claimed" | "taken" | "error"> {
  try {
    const row = await one<{ id: number }>(
      `INSERT INTO public.shop_emails (tenant_id, kind, run_key, status)
       VALUES ($1, $2, $3, 'claimed')
       ON CONFLICT (tenant_id, kind, run_key) DO NOTHING
       RETURNING id`,
      [tenantId, kind, runKey],
    );
    return row ? "claimed" : "taken";
  } catch (e) {
    console.error("[reminders] claim failed (migration 040?)", { tenantId, kind, err: String(e) });
    return "error";
  }
}

export async function finishShopEmail(
  tenantId: number,
  kind: string,
  runKey: string,
  p: { status: string; to?: string | null; subject?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await q(
      `UPDATE public.shop_emails
          SET status = $4, to_email = $5, subject = $6, detail = $7, updated_at = now()
        WHERE tenant_id = $1 AND kind = $2 AND run_key = $3`,
      [tenantId, kind, runKey, p.status, p.to ?? null, p.subject ? p.subject.slice(0, 250) : null, p.detail ? p.detail.slice(0, 500) : null],
    );
  } catch (e) {
    console.error("[reminders] finish failed", { tenantId, kind, err: String(e) });
  }
}

type Candidate = {
  id: number;
  quote_no: string;
  created_at: unknown;
  priced_at: unknown;
  expires_at: unknown;
  accepted_at: unknown;
  last_quote_at: unknown;
};

async function buyerReminders(tenantId: number, s: PricingSettings, now: Date, dry: boolean, out: ShopResult) {
  const expOn = s.reminder_expiring_on !== false;
  const folOn = s.reminder_followup_on !== false;
  if (!expOn && !folOn) return;
  const expDays = Number(s.reminder_expiring_days) || 5;
  const folDays = Number(s.reminder_followup_days) || 3;

  const rows = await q<Candidate>(
    `SELECT q.id, q.quote_no, q.created_at, q.priced_at, q.expires_at, q.accepted_at,
            (SELECT max(e.created_at) FROM public.quote_emails e
              WHERE e.quote_id = q.id AND e.kind = 'quote' AND e.status = 'sent') AS last_quote_at
       FROM public.quotes q
      WHERE q.tenant_id = $1
        AND COALESCE(q.locked, false) = false
        AND q.confirmed_at IS NULL
        AND q.email LIKE '%@%'
        AND EXISTS (SELECT 1 FROM public.quote_emails e
                     WHERE e.quote_id = q.id AND e.kind = 'quote' AND e.status = 'sent')
      ORDER BY q.id DESC
      LIMIT ${MAX_CANDIDATES}`,
    [tenantId],
  );

  for (const c of rows) {
    const approx = approxExpiry(
      { created_at: isoOf(c.created_at), priced_at: isoOf(c.priced_at), expires_at: isoOf(c.expires_at) },
      s.quote_valid_days,
    );
    const lastQuote = isoOf(c.last_quote_at);
    const maybeExp = expOn && expiringDue(approx, now, expDays);
    const maybeFol = folOn && c.accepted_at == null && followupDue(lastQuote, now, folDays);
    if (!maybeExp && !maybeFol) continue;

    const a = await approvalForQuote({ id: c.id, quote_no: c.quote_no, tenant_id: tenantId });
    if (!a || a.current_total <= 0 || a.expired) continue;
    if (a.stage !== "estimate" && a.stage !== "needs_reapproval") continue;

    if (maybeExp && a.expires_at && expiringDue(a.expires_at, now, expDays)) {
      const key = expiringKey(a.expires_at);
      const done = await one<{ x: number }>(
        `SELECT 1 AS x FROM public.quote_emails WHERE quote_id = $1 AND kind = 'expiring' AND detail LIKE $2 LIMIT 1`,
        [c.id, `${key}%`],
      );
      if (!done) {
        if (dry) out.expiring.push(`${c.quote_no}: would send (${key})`);
        else {
          const r = await sendQuoteStatusEmail({ quoteId: c.id, kind: "expiring", by: "reminders", logDetail: key });
          out.expiring.push(`${c.quote_no}: ${r.status}`);
        }
        continue; // the expiry reminder also serves as this quote's follow-up
      }
    }

    if (maybeFol && a.stage === "estimate" && lastQuote) {
      const done = await one<{ x: number }>(
        `SELECT 1 AS x FROM public.quote_emails
          WHERE quote_id = $1 AND kind IN ('followup', 'expiring') AND created_at > $2 LIMIT 1`,
        [c.id, lastQuote],
      );
      if (!done) {
        if (dry) out.followup.push(`${c.quote_no}: would send (quote emailed ${day(lastQuote)})`);
        else {
          const r = await sendQuoteStatusEmail({ quoteId: c.id, kind: "followup", by: "reminders", sentAt: lastQuote });
          out.followup.push(`${c.quote_no}: ${r.status}`);
        }
      }
    }
  }
}

async function staffDigest(
  tenantId: number,
  s: PricingSettings,
  now: Date,
  dry: boolean,
  digestNow: boolean,
  out: ShopResult,
) {
  if (s.staff_digest_on === false) {
    out.digest = "off";
    return;
  }
  const clock = shopClock(now, s.shop_timezone);
  const hour = Number(s.staff_digest_hour);
  if (!digestNow && clock.hour !== hour) {
    out.digest = `not now (sends at ${hour}:00 shop time)`;
    return;
  }
  if (!dry) {
    const claim = await claimShopEmail(tenantId, "staff_digest", clock.day);
    if (claim !== "claimed") {
      out.digest = claim === "taken" ? "already sent today" : "not sent (couldn't record it)";
      return;
    }
  }
  const finish = (p: { status: string; to?: string | null; subject?: string | null; detail?: string | null }) =>
    dry ? Promise.resolve() : finishShopEmail(tenantId, "staff_digest", clock.day, p);

  const sender = await shopSender(tenantId);

  const accepted = await q<{
    quote_no: string;
    customer_name: string | null;
    accepted_total: unknown;
    accepted_name: string | null;
    accepted_po: string | null;
  }>(
    `SELECT quote_no, customer_name, accepted_total, accepted_name, accepted_po
       FROM public.quotes
      WHERE tenant_id = $1 AND accepted_at IS NOT NULL AND confirmed_at IS NULL
        AND COALESCE(locked, false) = false
      ORDER BY accepted_at ASC
      LIMIT 25`,
    [tenantId],
  );
  const toConfirm: DigestQuote[] = accepted.map((r) => ({
    quote_no: r.quote_no,
    customer: r.customer_name,
    total: r.accepted_total == null ? null : Number(r.accepted_total),
    note: `accepted by ${r.accepted_name || "the buyer"}${r.accepted_po ? `, PO ${r.accepted_po}` : ""}`,
  }));

  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const newCountRow = await one<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.quotes WHERE tenant_id = $1 AND created_at > $2`,
    [tenantId, since],
  );
  const newRows = await q<{ quote_no: string; customer_name: string | null; status: string | null }>(
    `SELECT quote_no, customer_name, status FROM public.quotes
      WHERE tenant_id = $1 AND created_at > $2
      ORDER BY created_at DESC
      LIMIT 20`,
    [tenantId, since],
  );
  const newQuotes: DigestQuote[] = newRows.map((r) => ({ quote_no: r.quote_no, customer: r.customer_name, note: r.status }));

  const validDays = Number(s.quote_valid_days) || 0;
  const open = await q<{ quote_no: string; customer_name: string | null; created_at: unknown; priced_at: unknown; expires_at: unknown }>(
    `SELECT quote_no, customer_name, created_at, priced_at, expires_at
       FROM public.quotes
      WHERE tenant_id = $1 AND accepted_at IS NULL AND confirmed_at IS NULL
        AND COALESCE(locked, false) = false
        AND (expires_at IS NOT NULL OR ($2::int > 0 AND COALESCE(priced_at, created_at) > $3))
      ORDER BY id DESC
      LIMIT 500`,
    [tenantId, validDays, new Date(now.getTime() - (validDays + 4) * DAY_MS).toISOString()],
  );
  const expiring: DigestQuote[] = open
    .map((r) => ({
      r,
      exp: approxExpiry(
        { created_at: isoOf(r.created_at), priced_at: isoOf(r.priced_at), expires_at: isoOf(r.expires_at) },
        validDays,
      ),
    }))
    .filter((x) => expiringDue(x.exp, now, 3))
    .slice(0, 25)
    .map((x) => ({ quote_no: x.r.quote_no, customer: x.r.customer_name, note: `expires ${day(x.exp)}` }));

  const newCount = Number(newCountRow?.n) || 0;
  if (!digestHasNews({ toConfirm, newCount, expiring })) {
    out.digest = "nothing to report";
    await finish({ status: "skipped", detail: "nothing to report" });
    return;
  }

  let to: string[] = [];
  if (isEmail(s.staff_digest_to)) to = [String(s.staff_digest_to).trim()];
  else {
    const admins = await q<{ email: string | null }>(
      `SELECT email FROM public."users" WHERE tenant_id = $1 AND lower(role) = 'admin' ORDER BY id LIMIT 10`,
      [tenantId],
    );
    to = Array.from(new Set(admins.map((a) => String(a.email || "").trim()).filter((e) => isEmail(e))));
  }
  if (!to.length) {
    out.digest = "not sent (no admin email)";
    await finish({ status: "skipped", detail: "no admin email" });
    return;
  }

  const { subject, html } = staffDigestEmail({
    brand: sender.brand,
    day: clock.day,
    baseUrl: sender.baseUrl,
    toConfirm,
    newQuotes,
    newCount,
    expiring,
  });
  if (dry) {
    out.digest = `would send to ${to.join(", ")}: ${subject}`;
    return;
  }
  const errors: string[] = [];
  for (const addr of to) {
    const r = await sendHtmlEmail({ to: addr, subject, html, fromName: "Alex-IO" });
    if (!r.ok) errors.push(`${addr}: ${r.error}`);
  }
  await finish({
    status: errors.length ? "failed" : "sent",
    to: to.join(", "),
    subject,
    detail: errors.length ? errors.join("; ") : null,
  });
  out.digest = errors.length ? `failed (${errors.length} of ${to.length})` : `sent to ${to.join(", ")}`;
}

export async function runReminders(opts: RunOptions = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const dry = !!opts.dry;
  const slug = opts.tenantSlug ? String(opts.tenantSlug).trim().toLowerCase() : null;
  const tenants = await q<{ id: number; slug: string }>(
    `SELECT id, slug FROM public.tenants WHERE active = true ${slug ? "AND slug = $1" : ""} ORDER BY id`,
    slug ? [slug] : [],
  );
  const shops: ShopResult[] = [];
  for (const t of tenants) {
    const out: ShopResult = { shop: t.slug, expiring: [], followup: [], digest: "", errors: [] };
    const tenantId = Number(t.id);
    let s: PricingSettings | null = null;
    try {
      s = await getPricingSettings(tenantId);
    } catch (e) {
      out.errors.push(`settings: ${String(e)}`);
    }
    if (s) {
      try {
        await buyerReminders(tenantId, s, now, dry, out);
      } catch (e) {
        out.errors.push(`buyer reminders: ${String(e)}`);
      }
      try {
        await staffDigest(tenantId, s, now, dry, !!opts.digestNow, out);
      } catch (e) {
        out.errors.push(`digest: ${String(e)}`);
      }
    }
    shops.push(out);
  }
  return { ok: true, dry, at: now.toISOString(), shops };
}
