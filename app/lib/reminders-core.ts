// app/lib/reminders-core.ts
//
// Step 29B: the pure rules behind the hourly reminders (no DB, no network),
// so scripts/test-quote-mail.ts can check them.
//   - isTimeZone() / shopClock(): the shop's local day and hour
//   - expiringDue(): a quote expires within the reminder window
//   - followupDue(): the quote email went out at least N days ago
//   - approxExpiry(): the expiry from the stored columns (same rule as
//     app/lib/quote-approval-core.ts), used to pick candidates cheaply
//   - staffDigestEmail(): the shop's daily summary email
// The runner is app/lib/reminders.ts.

import { escapeHtml } from "../../lib/email/send-html";
import { day, usd } from "./quote-mail-core";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim() || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v.trim() }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** The shop's local calendar day (YYYY-MM-DD) and hour (0-23). Bad zones fall back to New York. */
export function shopClock(now: Date, tz: string | null | undefined): { day: string; hour: number } {
  const zone = isTimeZone(tz) ? String(tz).trim() : "America/New_York";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Expiry from the stored columns: staff date, else (reprice or created) + days; null = never. */
export function approxExpiry(row: {
  created_at: string | null;
  priced_at: string | null;
  expires_at: string | null;
}, validDays: number | null | undefined): string | null {
  const override = ms(row.expires_at);
  if (override != null) return new Date(override).toISOString();
  const days = Number(validDays);
  if (!Number.isFinite(days) || days <= 0) return null;
  const start = Math.max(ms(row.priced_at) ?? 0, ms(row.created_at) ?? 0);
  if (!start) return null;
  return new Date(start + days * DAY_MS).toISOString();
}

/** True when the quote hasn't expired yet and expires within `days` days. */
export function expiringDue(expiresAt: string | null | undefined, now: Date, days: number): boolean {
  const t = ms(expiresAt);
  if (t == null || !(days > 0)) return false;
  const left = t - now.getTime();
  return left > 0 && left <= days * DAY_MS;
}

/** True when the quote email went out at least `days` days ago. */
export function followupDue(sentAt: string | null | undefined, now: Date, days: number): boolean {
  const t = ms(sentAt);
  if (t == null || !(days > 0)) return false;
  return now.getTime() - t >= days * DAY_MS;
}

/** The log detail an expiring reminder is stored under (one reminder per expiry date). */
export function expiringKey(expiresAt: string): string {
  return `expires ${new Date(expiresAt).toISOString().slice(0, 10)}`;
}

export type DigestQuote = {
  quote_no: string;
  customer: string | null;
  total?: number | null;
  note?: string | null;
};

export type DigestData = {
  brand: string;
  day: string; // YYYY-MM-DD (shop day)
  baseUrl: string;
  toConfirm: DigestQuote[];
  newQuotes: DigestQuote[];
  newCount: number;
  expiring: DigestQuote[];
};

export function digestHasNews(d: Pick<DigestData, "toConfirm" | "newCount" | "expiring">): boolean {
  return d.toConfirm.length > 0 || d.newCount > 0 || d.expiring.length > 0;
}

export function staffDigestEmail(d: DigestData): { subject: string; html: string } {
  const e = escapeHtml;
  const base = d.baseUrl.replace(/\/+$/, "");
  const when = day(`${d.day}T12:00:00Z`);
  const subject = `${d.brand} quotes for ${when}: ${d.toConfirm.length} to confirm, ${d.newCount} new, ${d.expiring.length} expiring`;
  const list = (title: string, rows: DigestQuote[], empty: string, extra = "") => {
    const items = rows
      .map((r) => {
        const link = `${base}/admin/quotes/${encodeURIComponent(r.quote_no)}`;
        const bits = [r.customer || "", r.total != null ? usd(r.total) : "", r.note || ""].filter(Boolean).join(" · ");
        return `<li style="margin:0 0 6px"><a href="${e(link)}" style="color:#1c1c1a;font-weight:600">${e(r.quote_no)}</a>${bits ? ` <span style="color:#6b6b66">${e(bits)}</span>` : ""}</li>`;
      })
      .join("");
    return [
      `<h2 style="font-size:15px;margin:18px 0 8px;color:#1c1c1a">${e(title)}</h2>`,
      rows.length
        ? `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${items}</ul>${extra}`
        : `<p style="margin:0;font-size:13px;color:#6b6b66">${e(empty)}</p>`,
    ].join("");
  };
  const more = d.newCount > d.newQuotes.length ? `<p style="margin:6px 0 0;font-size:12px;color:#6b6b66">…and ${d.newCount - d.newQuotes.length} more.</p>` : "";
  const html = [
    `<div style="background:#f6f6f4;padding:24px 8px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1c1a">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px">`,
    `<tr><td style="padding:22px 24px">`,
    `<h1 style="font-size:19px;margin:0 0 4px">${e(d.brand)}: quotes for ${e(when)}</h1>`,
    `<p style="margin:0;font-size:13px;color:#6b6b66">Your daily summary from Alex-IO.</p>`,
    list("Accepted, waiting for you to confirm", d.toConfirm, "Nothing waiting."),
    list("New quotes (last 24 hours)", d.newQuotes, "No new quotes.", more),
    list("Expiring in the next 3 days (not accepted)", d.expiring, "None expiring."),
    `</td></tr>`,
    `<tr><td style="padding:14px 24px;border-top:1px solid #eeeeea;font-size:12px;color:#6b6b66">Turn this off or change the time in Admin → Settings → Reminders.</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");
  return { subject, html };
}
