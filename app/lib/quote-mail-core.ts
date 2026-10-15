// app/lib/quote-mail-core.ts
//
// Step 29A: the pure parts of the buyer status emails (no DB, no network), so
// scripts/test-quote-mail.ts can check them.
//   - tenantBaseUrl(): links in a shop's emails use the shop's own address
//     (mline.api.alex-io.com), so the buyer sees the shop's branding
//   - isEmail() / pickReplyTo(): who the buyer's replies go to
//   - statusEmail(kind, data): subject + HTML for accepted / confirmed /
//     reapprove / released, and (Step 29B) the buyer reminders expiring /
//     followup
// Sending, settings and the log live in app/lib/quote-mail.ts.

import { escapeHtml } from "../../lib/email/send-html";

export type StatusKind = "accepted" | "confirmed" | "reapprove" | "released" | "expiring" | "followup" | "proof";
export const STATUS_KINDS: readonly StatusKind[] = ["accepted", "confirmed", "reapprove", "released", "expiring", "followup", "proof"];

export function isStatusKind(v: unknown): v is StatusKind {
  return typeof v === "string" && (STATUS_KINDS as readonly string[]).includes(v);
}

const CORE_HOST = "api.alex-io.com";

/**
 * The address a shop's buyer links use: TENANT.api.alex-io.com for a shop on
 * the core host, the base itself for the Default shop or any other host
 * (local / preview builds).
 */
export function tenantBaseUrl(base: string, slug: string | null | undefined): string {
  const clean = String(base || "").replace(/\/+$/, "");
  const s = String(slug || "").trim().toLowerCase();
  if (!s || s === "default" || !/^[a-z0-9-]{1,63}$/.test(s)) return clean;
  try {
    const u = new URL(clean);
    if (u.hostname.toLowerCase() !== CORE_HOST) return clean;
    return `${u.protocol}//${s}.${CORE_HOST}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return clean;
  }
}

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 200 && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(v.trim());
}

/** Reply-to: the shop's setting, else the quote's sales rep, else the shop page email. */
export function pickReplyTo(c: { setting?: unknown; rep?: unknown; shop?: unknown }): string | null {
  for (const v of [c.setting, c.rep, c.shop]) {
    if (isEmail(v)) return String(v).trim();
  }
  return null;
}

export type StatusEmailData = {
  brand: string;
  quoteNo: string;
  link: string;
  total: number;
  buyerName?: string | null;
  previousTotal?: number | null;
  po?: string | null;
  leadTime?: string | null;
  validUntil?: string | null; // ISO
  revision?: string | null;
  reapproval?: boolean; // "accepted" sent for a re-approval
  sentAt?: string | null; // Step 29B: when the quote was emailed (follow-up)
  proofVersion?: number | null; // Step 31: proof ready
  proofNote?: string | null;
  primaryColor?: string | null;
  onPrimary?: string | null;
  logoUrl?: string | null;
};

export const usd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    : "";
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function render(d: StatusEmailData, heading: string, paras: string[], facts: [string, string][], button: string): string {
  const e = escapeHtml;
  const primary = d.primaryColor && HEX.test(d.primaryColor) ? d.primaryColor : "#2B2B28";
  const onPrimary = d.onPrimary && HEX.test(d.onPrimary) ? d.onPrimary : "#FFFFFF";
  const logo = d.logoUrl && /^https:\/\//i.test(d.logoUrl)
    ? `<img src="${e(d.logoUrl)}" alt="${e(d.brand)}" style="max-height:40px;max-width:200px;display:block">`
    : `<div style="font-size:16px;font-weight:700;color:#1c1c1a">${e(d.brand)}</div>`;
  const factRows = facts
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b6b66;font-size:13px;white-space:nowrap">${e(k)}</td><td style="padding:4px 0;font-size:13px;color:#1c1c1a;font-weight:600">${e(v)}</td></tr>`,
    )
    .join("");
  return [
    `<div style="background:#f6f6f4;padding:24px 8px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1c1a">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px">`,
    `<tr><td style="padding:18px 24px;border-bottom:3px solid ${primary}">${logo}</td></tr>`,
    `<tr><td style="padding:24px">`,
    `<h1 style="font-size:19px;line-height:1.3;margin:0 0 14px;color:#1c1c1a">${e(heading)}</h1>`,
    ...paras.map((p) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#33332f">${e(p)}</p>`),
    factRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px">${factRows}</table>` : "",
    `<a href="${e(d.link)}" style="display:inline-block;background:${primary};color:${onPrimary};text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${e(button)}</a>`,
    `</td></tr>`,
    `<tr><td style="padding:14px 24px;border-top:1px solid #eeeeea;font-size:12px;color:#6b6b66">${e(d.brand)} · Quote ${e(d.quoteNo)}. Reply to this email with any questions.</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");
}

export function statusEmail(kind: StatusKind, d: StatusEmailData): { subject: string; html: string } {
  const hi = `Hi ${d.buyerName && d.buyerName.trim() ? d.buyerName.trim() : "there"},`;
  const qn = d.quoteNo;
  const rev = d.revision ? ` (revision ${d.revision})` : "";
  if (kind === "accepted") {
    return {
      subject: `${d.brand}: ${d.reapproval ? "re-approval" : "approval"} received for quote ${qn}`,
      html: render(
        d,
        d.reapproval ? "We received your re-approval" : "We received your approval",
        [
          hi,
          `Thanks for ${d.reapproval ? "re-approving" : "approving"} quote ${qn}.`,
          `${d.brand} will review and confirm your order. You'll get another email when it's confirmed.`,
        ],
        [
          ["Total approved", usd(d.total)],
          ["PO", d.po || ""],
          ["Lead time", d.leadTime || ""],
        ],
        "View your quote",
      ),
    };
  }
  if (kind === "confirmed") {
    return {
      subject: `${d.brand}: order confirmed for quote ${qn}`,
      html: render(
        d,
        "Your order is confirmed",
        [hi, `${d.brand} has confirmed your order on quote ${qn}.`],
        [
          ["Order total", usd(d.total)],
          ["PO", d.po || ""],
          ["Lead time", d.leadTime || ""],
        ],
        "View your quote",
      ),
    };
  }
  if (kind === "proof") {
    const v = d.proofVersion ? ` (version ${d.proofVersion})` : "";
    return {
      subject: `${d.brand}: proof ready for quote ${qn}${d.proofVersion && d.proofVersion > 1 ? `, version ${d.proofVersion}` : ""}`,
      html: render(
        d,
        "Your proof is ready",
        [
          hi,
          `The proof${v} for quote ${qn} is ready.`,
          ...(d.proofNote ? [`From ${d.brand}: ${d.proofNote}`] : []),
          "Please check the spelling, colors, sizes and layout, then approve it or tell us what to change.",
        ],
        [["Quote total", usd(d.total)]],
        "Review the proof",
      ),
    };
  }
  if (kind === "expiring") {
    return {
      subject: `${d.brand}: quote ${qn} expires ${day(d.validUntil)}`,
      html: render(
        d,
        "Your quote expires soon",
        [
          hi,
          `Quote ${qn} is valid until ${day(d.validUntil)}.`,
          "To keep this price, review and accept it before then. If anything needs to change, reply to this email.",
        ],
        [
          ["Quote total", usd(d.total)],
          ["Price valid until", day(d.validUntil)],
        ],
        "Review and accept",
      ),
    };
  }
  if (kind === "followup") {
    return {
      subject: `${d.brand}: following up on quote ${qn}`,
      html: render(
        d,
        "Any questions about your quote?",
        [
          hi,
          d.sentAt ? `We sent you quote ${qn} on ${day(d.sentAt)}.` : `We sent you quote ${qn} recently.`,
          "If it looks right, you can accept it online. If anything needs to change, reply to this email.",
        ],
        [
          ["Quote total", usd(d.total)],
          ["Price valid until", day(d.validUntil)],
        ],
        "Review your quote",
      ),
    };
  }
  if (kind === "reapprove") {
    return {
      subject: `${d.brand}: quote ${qn} was updated, please re-approve`,
      html: render(
        d,
        "Your quote was updated",
        [
          hi,
          `The total on quote ${qn} changed since you approved it.`,
          "Please review the changes and re-approve, so we can confirm your order.",
        ],
        [
          ["New total", usd(d.total)],
          ["You approved", d.previousTotal != null ? usd(d.previousTotal) : ""],
          ["Price valid until", day(d.validUntil)],
        ],
        "Review and re-approve",
      ),
    };
  }
  return {
    subject: `${d.brand}: quote ${qn} is in production`,
    html: render(
      d,
      "Your order is in production",
      [hi, `Quote ${qn}${rev} has been released for manufacturing.`],
      [
        ["Order total", usd(d.total)],
        ["PO", d.po || ""],
        ["Lead time", d.leadTime || ""],
      ],
      "View your quote",
    ),
  };
}
