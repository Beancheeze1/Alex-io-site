// lib/quote-types-server.ts
//
// Step 11: server-side lookup of the quote types a shop offers
// (tenants.theme_json.quoteTypes, see lib/quote-types.ts).

import { one } from "@/lib/db";
import { QUOTE_TYPE_KEYS, quoteTypesFromTheme, type QuoteTypeKey } from "@/lib/quote-types";

export async function tenantQuoteTypes(tenantId: number): Promise<QuoteTypeKey[]> {
  try {
    const row = await one<{ theme_json: unknown }>(`SELECT theme_json FROM public.tenants WHERE id = $1`, [tenantId]);
    return quoteTypesFromTheme(row?.theme_json);
  } catch {
    // Never block quoting on a lookup failure.
    return [...QUOTE_TYPE_KEYS];
  }
}

export async function tenantOffersQuoteType(tenantId: number, type: QuoteTypeKey): Promise<boolean> {
  return (await tenantQuoteTypes(tenantId)).includes(type);
}
