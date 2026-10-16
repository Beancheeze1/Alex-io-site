// app/lib/funnel-core.ts
//
// Step 35: the quote funnel's rules (pure: no DB, safe in the browser;
// tested in scripts/test-funnel.ts). Everything comes from quote data the
// app already keeps; no visitor tracking.
//   Stages:   created -> priced -> accepted -> confirmed -> in production -> shipped
//             (a quote counts at a stage when it reached it, even if it went on)
//   Side:     emailed to the buyer, reorders
//   Channel:  reorder / embed widget / emailed RFQ (AI) / staff-created /
//             rep link / online (shop page, quote center, chat)
//   Cycle:    median hours between stages
//   Stalled:  quotes waiting too long at a stage

export type FunnelQuote = {
  quote_no: string;
  tenant_id: number;
  tenant_name: string | null;
  customer: string | null;
  created_at: string;
  priced: boolean; // has foam lines or boxes, or was emailed / accepted
  emailed: boolean; // a quote email went to the buyer
  ai_email: boolean; // created from an emailed RFQ (Alex-IO's AI)
  quote_source: string | null; // direct / embed_website
  rep_id: number | null;
  rep_name: string | null;
  reorder_of: string | null;
  accepted_at: string | null;
  accepted_total: number | null;
  confirmed_at: string | null;
  confirmed_total: number | null;
  released: boolean; // locked (released for manufacture)
  released_at: string | null;
  shipped_at: string | null;
  expires_at: string | null; // effective expiry of an estimate (null = never)
};

export type StageKey = "created" | "priced" | "accepted" | "confirmed" | "production" | "shipped";
export const STAGES: readonly StageKey[] = ["created", "priced", "accepted", "confirmed", "production", "shipped"];
export const STAGE_LABEL: Record<StageKey, string> = {
  created: "Quotes created",
  priced: "Priced",
  accepted: "Accepted by the buyer",
  confirmed: "Confirmed by the shop",
  production: "Released to production",
  shipped: "Shipped",
};

export type Channel = "reorder" | "embed" | "email_ai" | "staff" | "rep_link" | "online";
export const CHANNEL_LABEL: Record<Channel, string> = {
  reorder: "Reorder",
  embed: "Widget on the shop's website",
  email_ai: "Emailed RFQ (AI)",
  staff: "Created by staff",
  rep_link: "Rep link",
  online: "Shop page / quote center / chat",
};

export function channelOf(q: Pick<FunnelQuote, "quote_no" | "quote_source" | "ai_email" | "rep_id" | "reorder_of">): Channel {
  if (q.reorder_of) return "reorder";
  if (q.quote_source === "embed_website") return "embed";
  if (q.ai_email) return "email_ai";
  if (/^Q-(R|REP)-/i.test(q.quote_no)) return "staff";
  if (q.rep_id != null) return "rep_link";
  return "online";
}

/** Which stages a quote reached (each implies the ones before it). */
export function reached(q: FunnelQuote): Record<StageKey, boolean> {
  const shipped = !!q.shipped_at;
  const production = shipped || q.released;
  const confirmed = production || !!q.confirmed_at;
  const accepted = confirmed || !!q.accepted_at;
  const priced = accepted || q.priced || q.emailed;
  return { created: true, priced, accepted, confirmed, production, shipped };
}

export type StageRow = { key: StageKey; label: string; count: number; pct_of_created: number | null; pct_of_previous: number | null; value: number | null };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const money = (n: number) => Math.round(n * 100) / 100;

/** Counts per stage, % of created and of the stage before, and $ at accepted / confirmed and later. */
export function funnel(quotes: FunnelQuote[]): StageRow[] {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<StageKey, number>;
  const value: Record<StageKey, number> = { created: 0, priced: 0, accepted: 0, confirmed: 0, production: 0, shipped: 0 };
  for (const q of quotes) {
    const r = reached(q);
    const total = Number(q.confirmed_total ?? q.accepted_total ?? 0) || 0;
    for (const s of STAGES) {
      if (!r[s]) continue;
      counts[s]++;
      if (s === "accepted") value.accepted += Number(q.accepted_total ?? q.confirmed_total ?? 0) || 0;
      else if (s === "confirmed" || s === "production" || s === "shipped") value[s] += total;
    }
  }
  return STAGES.map((s, i) => ({
    key: s,
    label: STAGE_LABEL[s],
    count: counts[s],
    pct_of_created: i === 0 ? null : pct(counts[s], counts.created),
    pct_of_previous: i === 0 ? null : pct(counts[s], counts[STAGES[i - 1]]),
    value: s === "created" || s === "priced" ? null : money(value[s]),
  }));
}

export type GroupRow = {
  key: string;
  label: string;
  created: number;
  accepted: number;
  confirmed: number;
  win_rate: number | null; // confirmed / created, %
  confirmed_value: number;
};

export function groupBy(quotes: FunnelQuote[], keyOf: (q: FunnelQuote) => { key: string; label: string }): GroupRow[] {
  const m = new Map<string, GroupRow>();
  for (const q of quotes) {
    const k = keyOf(q);
    const g = m.get(k.key) ?? { key: k.key, label: k.label, created: 0, accepted: 0, confirmed: 0, win_rate: null, confirmed_value: 0 };
    const r = reached(q);
    g.created++;
    if (r.accepted) g.accepted++;
    if (r.confirmed) {
      g.confirmed++;
      g.confirmed_value += Number(q.confirmed_total ?? q.accepted_total ?? 0) || 0;
    }
    m.set(k.key, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, win_rate: pct(g.confirmed, g.created), confirmed_value: money(g.confirmed_value) }))
    .sort((a, b) => b.created - a.created || a.label.localeCompare(b.label));
}

export const byChannel = (qs: FunnelQuote[]) => groupBy(qs, (q) => ({ key: channelOf(q), label: CHANNEL_LABEL[channelOf(q)] }));
export const byRep = (qs: FunnelQuote[]) =>
  groupBy(qs, (q) => (q.rep_id == null ? { key: "none", label: "No rep" } : { key: String(q.rep_id), label: q.rep_name || `User ${q.rep_id}` }));
export const byShop = (qs: FunnelQuote[]) => groupBy(qs, (q) => ({ key: String(q.tenant_id), label: q.tenant_name || `Shop ${q.tenant_id}` }));

const hours = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
  return Number.isFinite(d) && d >= 0 ? d : null;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type CycleRow = { key: string; label: string; median_hours: number | null; count: number };

/** Median hours for each step a quote actually took. */
export function cycleTimes(quotes: FunnelQuote[]): CycleRow[] {
  const steps: { key: string; label: string; from: (q: FunnelQuote) => string | null; to: (q: FunnelQuote) => string | null }[] = [
    { key: "quote_to_accept", label: "Quote to acceptance", from: (q) => q.created_at, to: (q) => q.accepted_at },
    { key: "accept_to_confirm", label: "Acceptance to confirmation", from: (q) => q.accepted_at, to: (q) => q.confirmed_at },
    { key: "confirm_to_release", label: "Confirmation to production", from: (q) => q.confirmed_at, to: (q) => q.released_at },
    { key: "release_to_ship", label: "Production to shipped", from: (q) => q.released_at, to: (q) => q.shipped_at },
    { key: "quote_to_ship", label: "Quote to shipped (overall)", from: (q) => q.created_at, to: (q) => q.shipped_at },
  ];
  return steps.map((s) => {
    const xs = quotes.map((q) => hours(s.from(q), s.to(q))).filter((x): x is number => x != null);
    const m = median(xs);
    return { key: s.key, label: s.label, median_hours: m == null ? null : Math.round(m * 10) / 10, count: xs.length };
  });
}

/** "45 min", "6.5 h", "3.2 days". */
export function durationLabel(h: number | null): string {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

export const STALL_DAYS = { estimate: 7, accepted: 2, confirmed: 7, production: 14 } as const;

export type StalledRow = { quote_no: string; tenant_id: number; customer: string | null; stage: string; since: string; days: number; value: number | null };

/**
 * Quotes waiting longer than STALL_DAYS at a stage: an estimate nobody
 * accepted (not expired), accepted but not confirmed, confirmed but not
 * released, released but not shipped. Longest wait first.
 */
export function stalled(quotes: FunnelQuote[], now: Date): StalledRow[] {
  const out: StalledRow[] = [];
  const age = (iso: string) => (now.getTime() - new Date(iso).getTime()) / 86_400_000;
  for (const q of quotes) {
    let stage: string | null = null;
    let since: string | null = null;
    let limit = 0;
    if (q.shipped_at) continue;
    if (q.released) {
      stage = "Released, not shipped";
      since = q.released_at;
      limit = STALL_DAYS.production;
    } else if (q.confirmed_at) {
      stage = "Confirmed, not released";
      since = q.confirmed_at;
      limit = STALL_DAYS.confirmed;
    } else if (q.accepted_at) {
      stage = "Accepted, not confirmed";
      since = q.accepted_at;
      limit = STALL_DAYS.accepted;
    } else if (q.priced || q.emailed) {
      if (q.expires_at && new Date(q.expires_at).getTime() < now.getTime()) continue;
      stage = "Estimate, not accepted";
      since = q.created_at;
      limit = STALL_DAYS.estimate;
    }
    if (!stage || !since) continue;
    const days = age(since);
    if (!(days > limit)) continue;
    out.push({
      quote_no: q.quote_no,
      tenant_id: q.tenant_id,
      customer: q.customer,
      stage,
      since,
      days: Math.round(days * 10) / 10,
      value: q.confirmed_total ?? q.accepted_total ?? null,
    });
  }
  return out.sort((a, b) => b.days - a.days);
}

const CSV_COLS = [
  "quote_no",
  "shop",
  "customer",
  "created_at",
  "channel",
  "rep",
  "reorder_of",
  "stage_reached",
  "emailed",
  "accepted_at",
  "accepted_total",
  "confirmed_at",
  "confirmed_total",
  "released_at",
  "shipped_at",
] as const;

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per quote, for spreadsheets. */
export function funnelCsv(quotes: FunnelQuote[]): string {
  const lines = [CSV_COLS.join(",")];
  for (const q of quotes) {
    const r = reached(q);
    const last = [...STAGES].reverse().find((s) => r[s]) ?? "created";
    const row: Record<(typeof CSV_COLS)[number], unknown> = {
      quote_no: q.quote_no,
      shop: q.tenant_name,
      customer: q.customer,
      created_at: q.created_at,
      channel: CHANNEL_LABEL[channelOf(q)],
      rep: q.rep_id == null ? "" : q.rep_name || q.rep_id,
      reorder_of: q.reorder_of,
      stage_reached: STAGE_LABEL[last],
      emailed: q.emailed ? "yes" : "no",
      accepted_at: q.accepted_at,
      accepted_total: q.accepted_total,
      confirmed_at: q.confirmed_at,
      confirmed_total: q.confirmed_total,
      released_at: q.released_at,
      shipped_at: q.shipped_at,
    };
    lines.push(CSV_COLS.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export const RANGE_DAYS = [30, 90, 365] as const;

export function cleanDays(v: unknown): number {
  const n = Number(v);
  return (RANGE_DAYS as readonly number[]).includes(n) ? n : 90;
}
