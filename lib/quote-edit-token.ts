// lib/quote-edit-token.ts
//
// Step 21: the private edit link for a quote.
// A quote number alone only lets someone VIEW a quote. To change it, a buyer
// needs the edit token that comes with the quote: in the links of the quote
// email, or set in their browser when they started the quote themselves.
//
// editTokenFor(quoteNo) = first 24 chars of base64url(HMAC-SHA256(AUTH_SECRET,
// "quote-edit:v1:" + QUOTE_NO)). Deterministic, so no table is needed; it
// can't be worked out without AUTH_SECRET.
//
// editLinkUrl() turns a /quote, /quote/layout or /sketch-upload link into
// /api/quote/open?to=<page>&...&et=<token>, which stores the token in the
// buyer's browser and redirects to the page (so the token isn't left in the
// address bar). Server-only (Node crypto).

import { createHmac, timingSafeEqual } from "crypto";

export const EDIT_TOKEN_PARAM = "et";
export const OPEN_PAGE_PATHS = ["/quote", "/quote/layout", "/sketch-upload"] as const;

function secret(): string {
  const s = process.env.AUTH_SECRET || "";
  if (s.length < 16) throw new Error("AUTH_SECRET is not set; quote edit links can't be signed.");
  return s;
}

export function normQuoteNo(quoteNo: string | null | undefined): string {
  return String(quoteNo || "").trim().toUpperCase();
}

export function editTokenFor(quoteNo: string): string {
  return createHmac("sha256", secret())
    .update(`quote-edit:v1:${normQuoteNo(quoteNo)}`)
    .digest("base64url")
    .slice(0, 24);
}

export function isValidEditToken(quoteNo: string | null | undefined, token: string | null | undefined): boolean {
  const q = normQuoteNo(quoteNo);
  const t = String(token || "").trim();
  if (!q || t.length !== 24) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(editTokenFor(q));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The buyer's edit link for a page link. Absolute or relative URLs both work;
 * anything that isn't a /quote, /quote/layout or /sketch-upload link comes
 * back unchanged. Already-converted links come back unchanged too.
 */
export function editLinkUrl(url: string | null | undefined, quoteNo: string | null | undefined): string | null {
  if (!url) return url ?? null;
  const q = normQuoteNo(quoteNo);
  if (!q) return url;
  try {
    const isAbsolute = /^https?:\/\//i.test(url);
    const u = new URL(url, "http://relative.invalid");
    if (u.pathname === "/api/quote/open") return url;
    if (!(OPEN_PAGE_PATHS as readonly string[]).includes(u.pathname)) return url;
    const out = new URL("/api/quote/open", u.origin);
    out.searchParams.set("to", u.pathname);
    u.searchParams.forEach((v, k) => {
      if (k !== EDIT_TOKEN_PARAM && k !== "to") out.searchParams.append(k, v);
    });
    if (!out.searchParams.get("quote_no")) out.searchParams.set("quote_no", q);
    out.searchParams.set(EDIT_TOKEN_PARAM, editTokenFor(q));
    return isAbsolute ? out.toString() : `${out.pathname}${out.search}`;
  } catch {
    return url;
  }
}
