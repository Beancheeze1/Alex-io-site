// lib/quote-no.ts
//
// Quote number format (Oct 2026):
//   Q-A-YYMMDD-NNNNN   customer / quote center / chat / email quotes
//   Q-R-YYMMDD-NNNNN   rep-created quotes
//   Q-D-YYMMDD-NNNNN   landing-page demo quotes
// NNNNN = 5 random digits from a crypto random source (not the time), so a
// quote number can't be worked out from when it was created.
//
// Legacy numbers keep working everywhere:
//   Q-AI-YYYYMMDD-HHMMSS, Q-REP-YYYYMMDD-HHMMSS, Q-DEMO-YYYYMMDD-XXXXX
//
// Pure TypeScript: safe to import from client and server code.
// Server code that creates a quote should use newUniqueQuoteNo() in
// lib/quote-no-server.ts, which also checks the quotes table.

export type QuoteKind = "A" | "R" | "D";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function random5(): string {
  const c: any = (globalThis as any).crypto;
  let n: number;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    n = buf[0] % 100000;
  } else {
    n = Math.floor(Math.random() * 100000);
  }
  return String(n).padStart(5, "0");
}

/** Builds a new-format quote number. Does NOT check the database for collisions. */
export function buildQuoteNo(kind: QuoteKind, now: Date = new Date()): string {
  const yy = pad2(now.getFullYear() % 100);
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  return `Q-${kind}-${yy}${mm}${dd}-${random5()}`;
}

/** Demo quotes: new Q-D- and legacy Q-DEMO-. */
export function isDemoQuoteNo(quoteNo: string | null | undefined): boolean {
  const s = String(quoteNo || "").trim().toUpperCase();
  return s.startsWith("Q-D-") || s.startsWith("Q-DEMO-");
}

/** Matches a quote number (new or legacy) inside free text such as an email subject. */
export const QUOTE_NO_IN_TEXT_RE =
  /\bQ-(?:AI|A|REP|R|DEMO|D)-(?:\d{8}-[A-Z0-9]{5,6}|\d{6}-\d{5})\b/i;

export function extractQuoteNoFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(QUOTE_NO_IN_TEXT_RE);
  return m ? m[0] : null;
}

/**
 * Client helper: asks the server for a collision-checked number, falling
 * back to a locally built one if the request fails.
 */
export async function fetchNewQuoteNo(kind: "A" | "R"): Promise<string> {
  try {
    const res = await fetch(`/api/public/quote-number?kind=${kind}`, { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (res.ok && j?.ok && typeof j.quoteNo === "string" && j.quoteNo) return j.quoteNo;
  } catch {}
  return buildQuoteNo(kind);
}
