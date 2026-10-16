// app/lib/test-cleanup-core.ts
//
// Step 36B: rules for deleting QA test quotes by number (pure: no DB, safe in
// the browser; tested in scripts/test-cleanup.ts).
//   - parse the pasted quote numbers
//   - which tables hold quote rows (found at run time from the database's own
//     column list) and which of them are money records that must never be
//     deleted by this tool
//   - the phrase the owner types to confirm

export const MAX_QUOTES = 200;

/** Real quote numbers: Q-A-…, Q-R-…, Q-AI-…, Q-REP-… (demo quotes too). */
const QUOTE_NO = /^Q-[A-Z]+-[A-Z0-9-]+$/;

/** Splits pasted text (commas, spaces, new lines) into unique, upper-cased quote numbers. */
export function parseQuoteNos(text: unknown): { quoteNos: string[]; invalid: string[]; tooMany: boolean } {
  const parts = String(typeof text === "string" ? text : Array.isArray(text) ? text.join("\n") : "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const quoteNos: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!QUOTE_NO.test(p) || p.length > 60) {
      if (!invalid.includes(p)) invalid.push(p);
    } else if (!quoteNos.includes(p)) quoteNos.push(p);
  }
  return { quoteNos: quoteNos.slice(0, MAX_QUOTES), invalid, tooMany: quoteNos.length > MAX_QUOTES };
}

/** Columns that point at a quote. */
export const QUOTE_COLUMNS = ["quote_id", "quote_no"] as const;
export type QuoteColumn = (typeof QUOTE_COLUMNS)[number];

/**
 * Money records (commissions, expenses, payouts, invoices, payments) are never
 * deleted here: a quote that has any is refused instead.
 */
export function isProtectedTable(table: string): boolean {
  return /(commission|expense|payout|invoice|payment|ledger)/i.test(table);
}

/** Other tables whose rows belong to a quote and go with it. */
export const DELETE_ALSO = ["admin_alerts", "page_events"] as const;

/**
 * Rows are deleted only from quote tables (quote_*) and DELETE_ALSO. Any other
 * table that points at a quote (a customer record, a spec request…) is kept
 * and only reported.
 */
export function isDeletableTable(table: string): boolean {
  if (isProtectedTable(table) || isSkippedTable(table)) return false;
  return table.startsWith("quote_") || (DELETE_ALSO as readonly string[]).includes(table);
}

/** Tables this tool never touches at all (the quotes table itself is deleted last). */
export function isSkippedTable(table: string): boolean {
  return table === "quotes" || table === "schema_migrations";
}

export type TableHit = { table: string; column: QuoteColumn; rows: number };

export type QuotePreview = {
  quote_no: string;
  id: number;
  tenant_id: number;
  shop: string | null;
  customer: string | null;
  status: string | null;
  locked: boolean;
  created_at: string;
  reorders: string[]; // quotes copied from this one that are NOT in the list
};

export type Preview = {
  quotes: QuotePreview[];
  not_found: string[];
  invalid: string[];
  tables: { table: string; rows: number }[]; // rows that will be deleted, by table
  kept: { table: string; rows: number }[]; // rows that point at these quotes but stay
  blocked: { table: string; rows: number }[]; // money records: the run is refused
  confirm: string;
};

export function confirmPhrase(n: number): string {
  return `DELETE ${n} QUOTE${n === 1 ? "" : "S"}`;
}

export function phraseMatches(typed: unknown, n: number): boolean {
  return typeof typed === "string" && typed.trim().toUpperCase() === confirmPhrase(n);
}

/** Sums table hits by table name (a table can match on both quote_id and quote_no). */
export function totalByTable(hits: TableHit[]): { table: string; rows: number }[] {
  const m = new Map<string, number>();
  for (const h of hits) m.set(h.table, (m.get(h.table) || 0) + h.rows);
  return [...m.entries()].map(([table, rows]) => ({ table, rows })).sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table));
}
