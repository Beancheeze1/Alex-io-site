// app/lib/portal-core.ts
//
// Step 34A: the buyer portal's rules (pure: no DB, safe in the browser;
// tested in scripts/test-portal.ts).
//   - normEmail / isPortalEmail
//   - orderStage(): estimate -> accepted -> confirmed -> in production -> shipped
//   - orderTimeline(): the dated steps the portal shows for an order
//   - openActions(): what the buyer still has to do (accept, proof, ship-to)
//   - trackingUrl() / cleanShipped(): staff's "Mark shipped"
//   - signInEmail(): the one-time sign-in link email
// Sessions and links (Node crypto) live in lib/buyer-session.ts; loading in
// app/lib/portal.ts.

import { escapeHtml } from "../../lib/email/send-html";

export const LINK_MINUTES = 30;
export const SESSION_DAYS = 30;
export const LINKS_PER_WINDOW = 3; // sign-in emails per email per window
export const LINK_WINDOW_MINUTES = 15;

export function normEmail(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function isPortalEmail(v: unknown): boolean {
  const s = normEmail(v);
  return s.length > 3 && s.length <= 200 && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s);
}

export type OrderStage = "estimate" | "expired" | "accepted" | "confirmed" | "in_production" | "shipped";

export const STAGE_LABEL: Record<OrderStage, string> = {
  estimate: "Estimate",
  expired: "Estimate expired",
  accepted: "Accepted, waiting for the shop",
  confirmed: "Order confirmed",
  in_production: "In production",
  shipped: "Shipped",
};

/** The order fields the portal works from (all optional columns as read). */
export type OrderFacts = {
  created_at: string | null;
  expires_at: string | null; // effective expiry, null = never
  accepted_at: string | null;
  accepted_name: string | null;
  confirmed_at: string | null;
  locked: boolean;
  locked_at: string | null;
  shipped_at: string | null;
  shipped_carrier: string | null;
  shipped_tracking: string | null;
  proof: { stage: "none" | "waiting" | "approved" | "changes"; version: number | null; required: boolean; at: string | null } | null;
  ship_to_zip: string | null;
  terms: "prepaid_add" | "fob_origin" | "pickup" | null;
};

const t = (iso: string | null | undefined) => {
  if (!iso) return NaN;
  return new Date(iso).getTime();
};

export function orderStage(o: OrderFacts, now: Date): OrderStage {
  if (o.shipped_at) return "shipped";
  if (o.locked) return "in_production";
  if (o.confirmed_at) return "confirmed";
  if (o.accepted_at) return "accepted";
  const exp = t(o.expires_at);
  if (Number.isFinite(exp) && exp < now.getTime()) return "expired";
  return "estimate";
}

export type TimelineStep = { key: string; label: string; done: boolean; at: string | null; detail: string | null };

/** The steps an order goes through, done or not, with dates. Proof only when there is one or one is needed. */
export function orderTimeline(o: OrderFacts): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "quoted", label: "Quoted", done: true, at: o.created_at, detail: null },
    { key: "accepted", label: "Accepted", done: !!o.accepted_at, at: o.accepted_at, detail: o.accepted_name ? `by ${o.accepted_name}` : null },
    { key: "confirmed", label: "Confirmed by the shop", done: !!o.confirmed_at, at: o.confirmed_at, detail: null },
  ];
  if (o.proof && (o.proof.required || o.proof.stage !== "none")) {
    const p = o.proof;
    steps.push({
      key: "proof",
      label: "Artwork proof",
      done: p.stage === "approved",
      at: p.stage === "approved" ? p.at : null,
      detail:
        p.stage === "approved"
          ? `v${p.version} approved`
          : p.stage === "changes"
            ? `changes requested on v${p.version}`
            : p.stage === "waiting"
              ? `v${p.version} waiting for you`
              : "coming",
    });
  }
  steps.push({ key: "production", label: "In production", done: o.locked || !!o.shipped_at, at: o.locked_at, detail: null });
  steps.push({
    key: "shipped",
    label: "Shipped",
    done: !!o.shipped_at,
    at: o.shipped_at,
    detail: o.shipped_at ? [o.shipped_carrier, o.shipped_tracking].filter(Boolean).join(" ") || null : null,
  });
  return steps;
}

export type OpenAction = { key: "accept" | "proof" | "ship_to"; label: string };

/** What the buyer still has to do on this order. */
export function openActions(o: OrderFacts, now: Date, freightSetUp: boolean): OpenAction[] {
  const stage = orderStage(o, now);
  const out: OpenAction[] = [];
  if (stage === "estimate") out.push({ key: "accept", label: "Review and accept" });
  if (o.proof && o.proof.stage === "waiting" && !o.shipped_at) out.push({ key: "proof", label: `Review proof v${o.proof.version}` });
  if (freightSetUp && !o.locked && stage !== "expired" && o.terms !== "pickup" && !(o.ship_to_zip && o.ship_to_zip.trim())) {
    out.push({ key: "ship_to", label: "Add a ship-to address" });
  }
  return out;
}

export const CARRIERS = ["UPS", "FedEx", "USPS", "LTL / freight", "Our truck", "Other"] as const;

/** Tracking page for the parcel carriers; null for anything else. */
export function trackingUrl(carrier: string | null | undefined, tracking: string | null | undefined): string | null {
  const c = String(carrier || "").trim().toLowerCase();
  const n = String(tracking || "").replace(/\s+/g, "");
  if (!n || !/^[A-Za-z0-9-]{4,40}$/.test(n)) return null;
  const e = encodeURIComponent(n);
  if (c === "ups") return `https://www.ups.com/track?tracknum=${e}`;
  if (c === "fedex") return `https://www.fedex.com/fedextrack/?trknbr=${e}`;
  if (c === "usps") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${e}`;
  return null;
}

export type ShippedInput = { carrier: string | null; tracking: string | null; note: string | null };

/** Staff input for "Mark shipped": a carrier is required; tracking and note are optional. */
export function cleanShipped(raw: unknown): { ok: true; value: ShippedInput } | { ok: false; field: string; message: string } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
  const carrier = s(b.carrier, 60);
  const tracking = s(b.tracking, 80);
  const note = s(b.note, 300);
  if (!carrier) return { ok: false, field: "carrier", message: "Pick the carrier (or Our truck / Other)." };
  if (tracking && !/^[A-Za-z0-9 #/.,-]{1,80}$/.test(tracking)) {
    return { ok: false, field: "tracking", message: "Tracking can use letters, numbers, spaces and - / # . , only." };
  }
  return { ok: true, value: { carrier, tracking: tracking || null, note: note || null } };
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The sign-in link email (subject + HTML). */
export function signInEmail(d: {
  brand: string;
  link: string;
  minutes: number;
  primaryColor?: string | null;
  onPrimary?: string | null;
  logoUrl?: string | null;
}): { subject: string; html: string } {
  const e = escapeHtml;
  const primary = d.primaryColor && HEX.test(d.primaryColor) ? d.primaryColor : "#2B2B28";
  const onPrimary = d.onPrimary && HEX.test(d.onPrimary) ? d.onPrimary : "#FFFFFF";
  const logo =
    d.logoUrl && /^https:\/\//i.test(d.logoUrl)
      ? `<img src="${e(d.logoUrl)}" alt="${e(d.brand)}" style="max-height:40px;max-width:200px;display:block">`
      : `<div style="font-size:16px;font-weight:700;color:#1c1c1a">${e(d.brand)}</div>`;
  const p = (s: string) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#33332f">${e(s)}</p>`;
  const html = [
    `<div style="background:#f6f6f4;padding:24px 8px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1c1a">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px">`,
    `<tr><td style="padding:18px 24px;border-bottom:3px solid ${primary}">${logo}</td></tr>`,
    `<tr><td style="padding:24px">`,
    `<h1 style="font-size:19px;line-height:1.3;margin:0 0 14px;color:#1c1c1a">Sign in to your orders</h1>`,
    p(`Use the button below to see your quotes and orders with ${d.brand}.`),
    p(`The link works once, for ${d.minutes} minutes. If you didn't ask for it, you can ignore this email.`),
    `<a href="${e(d.link)}" style="display:inline-block;background:${primary};color:${onPrimary};text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open your orders</a>`,
    `</td></tr>`,
    `<tr><td style="padding:14px 24px;border-top:1px solid #eeeeea;font-size:12px;color:#6b6b66">${e(d.brand)}</td></tr>`,
    `</table></td></tr></table></div>`,
  ].join("");
  return { subject: `${d.brand}: your sign-in link`, html };
}
