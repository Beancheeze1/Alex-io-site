// lib/quote-no-server.ts
//
// Server-only: builds a new-format quote number and confirms it isn't
// already used in public.quotes (5 random digits per day can collide).

import { one } from "@/lib/db";
import { buildQuoteNo, type QuoteKind } from "@/lib/quote-no";

export async function newUniqueQuoteNo(kind: QuoteKind): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const quoteNo = buildQuoteNo(kind);
    const taken = await one<{ x: number }>(
      `SELECT 1 AS x FROM public."quotes" WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!taken) return quoteNo;
  }
  throw new Error("Could not find a free quote number after 25 attempts");
}
