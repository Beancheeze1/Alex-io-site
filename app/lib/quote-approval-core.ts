// app/lib/quote-approval-core.ts
//
// Step 28: estimate -> buyer accepted -> shop confirmed (pure: no DB).
//
// A quote's price is an estimate until the buyer accepts it and the shop
// confirms it. Both are recorded with the quote's total at that moment, so a
// later price change (the shop reprices or edits, or the buyer edits) is seen
// by comparing totals, with no hook in every route that can change a price:
//
//   estimate          nothing accepted yet
//   accepted          the buyer accepted the current total; waiting for the shop
//   needs_reapproval  accepted (or confirmed) at a different total: the buyer
//                     re-approves the new price before the shop can confirm
//   confirmed         buyer and shop both agreed to the current total
//
// Expiry: an override date (staff), else (priced_at or created_at) + the
// shop's "quote valid" days. An expired quote can't be accepted by the buyer
// (staff can still confirm or extend it). Confirmed quotes don't expire.

export type ApprovalStage = "estimate" | "accepted" | "needs_reapproval" | "confirmed";

export type ApprovalRow = {
  created_at?: string | null;
  priced_at?: string | null;
  expires_at?: string | null; // staff override
  lead_time_text?: string | null; // staff override
  accepted_at?: string | null;
  accepted_name?: string | null;
  accepted_po?: string | null;
  accepted_total?: number | string | null;
  accepted_by_staff?: boolean | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  confirmed_total?: number | string | null;
};

export type ApprovalTerms = {
  quote_valid_days?: number | null; // shop default, 0 = never expires
  lead_time_text?: string | null; // shop default
};

export type QuoteApproval = {
  stage: ApprovalStage;
  current_total: number;
  accepted: { at: string; name: string | null; po: string | null; total: number; by_staff: boolean } | null;
  confirmed: { at: string; by: string | null; total: number } | null;
  expires_at: string | null; // effective expiry (ISO), null = never
  expires_override: boolean;
  expired: boolean;
  lead_time: string | null;
  lead_time_override: boolean;
};

export const DEFAULT_QUOTE_VALID_DAYS = 30;
export const MAX_PO_LEN = 60;
export const MAX_NAME_LEN = 120;
export const MAX_LEAD_TIME_LEN = 120;

const cents = (n: number) => Math.round((Number(n) || 0) * 100);

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Same total to the cent. */
export function sameTotal(a: number, b: number): boolean {
  return cents(a) === cents(b);
}

export function computeApproval(row: ApprovalRow, currentTotal: number, terms: ApprovalTerms, now: Date = new Date()): QuoteApproval {
  const accAt = iso(row.accepted_at);
  const accepted = accAt
    ? {
        at: accAt,
        name: row.accepted_name ?? null,
        po: row.accepted_po ?? null,
        total: num(row.accepted_total),
        by_staff: row.accepted_by_staff === true,
      }
    : null;
  const confAt = iso(row.confirmed_at);
  const confirmed = confAt ? { at: confAt, by: row.confirmed_by ?? null, total: num(row.confirmed_total) } : null;

  let stage: ApprovalStage = "estimate";
  if (accepted) {
    if (!sameTotal(accepted.total, currentTotal)) stage = "needs_reapproval";
    else if (confirmed && sameTotal(confirmed.total, currentTotal)) stage = "confirmed";
    else stage = "accepted";
  } else if (confirmed) {
    // Confirmed without a recorded acceptance can't happen through the app;
    // treat it like an acceptance at the confirmed total.
    stage = sameTotal(confirmed.total, currentTotal) ? "confirmed" : "needs_reapproval";
  }

  const override = iso(row.expires_at);
  const days = terms.quote_valid_days == null ? DEFAULT_QUOTE_VALID_DAYS : Math.max(0, Math.round(num(terms.quote_valid_days)));
  let expiresAt: string | null = override;
  if (!expiresAt && days > 0) {
    const start = iso(row.priced_at) ?? iso(row.created_at);
    if (start) expiresAt = new Date(new Date(start).getTime() + days * 86_400_000).toISOString();
  }
  const expired = stage !== "confirmed" && !!expiresAt && now.getTime() > new Date(expiresAt).getTime();

  const ownLead = typeof row.lead_time_text === "string" && row.lead_time_text.trim() ? row.lead_time_text.trim() : null;
  const shopLead = typeof terms.lead_time_text === "string" && terms.lead_time_text.trim() ? terms.lead_time_text.trim() : null;

  return {
    stage,
    current_total: Math.round(num(currentTotal) * 100) / 100,
    accepted,
    confirmed,
    expires_at: expiresAt,
    expires_override: !!override,
    expired,
    lead_time: ownLead ?? shopLead,
    lead_time_override: !!ownLead,
  };
}

/** The buyer may accept (or re-approve) now. */
export function buyerCanAccept(a: QuoteApproval, locked: boolean): boolean {
  return !locked && !a.expired && a.current_total > 0 && (a.stage === "estimate" || a.stage === "needs_reapproval");
}

/** Staff may confirm now (the buyer accepted the current total). */
export function staffCanConfirm(a: QuoteApproval): boolean {
  return a.stage === "accepted";
}

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  estimate: "Estimate",
  accepted: "Accepted by buyer",
  needs_reapproval: "Price changed: needs buyer re-approval",
  confirmed: "Confirmed by the shop",
};

/** Cleans a PO / name / lead time string: trimmed, at most `max` chars, "" -> null. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
}
