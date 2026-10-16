// app/api/quote/ship-to/saved/route.ts
//
// Step 34B: the buyer's saved ship-to addresses for a quote's ship-to card:
// every address used on their other quotes at this shop (same email, or the
// same customer's email), newest first, minus the ones they removed.
//   GET  ?quote_no=Q-…              -> { ok, addresses: SavedAddress[] }
//   POST { quote_no, hide: key }    -> { ok } (removed from the list for good)
// Same access as changing the ship-to: the buyer's edit link, or staff of
// the shop. Quotes with no buyer email have no saved addresses.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { buyerMayEdit, isQuoteStaff } from "@/lib/quote-edit";
import { normEmail } from "@/app/lib/portal-core";
import { savedAddresses } from "@/app/lib/reorder-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type Q = { id: number; quote_no: string; tenant_id: number; email: string | null };

async function access(req: NextRequest, quoteNoRaw: unknown): Promise<{ res: NextResponse } | { quote: Q; email: string | null }> {
  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 60) : "";
  if (!quoteNo) return { res: json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400) };
  const quote = await one<Q>(
    `SELECT qq.id, qq.quote_no, qq.tenant_id, lower(trim(coalesce(nullif(qq.email, ''), c.email, ''))) AS email
       FROM public.quotes qq LEFT JOIN public.customers c ON c.id = qq.customer_id
      WHERE qq.quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote) return { res: json({ ok: false, error: "not_found", message: "Quote not found." }, 404) };
  if (!buyerMayEdit(req, quote.quote_no) && !(await isQuoteStaff(req, quote.tenant_id))) {
    return { res: json({ ok: false, error: "EDIT_LINK_REQUIRED", message: "Open this quote from the link in your quote email to use saved addresses." }, 403) };
  }
  const email = normEmail(quote.email);
  return { quote, email: email || null };
}

export async function GET(req: NextRequest) {
  const rate = await rateLimit(req, 30, "ship-to-saved");
  if (!rate.success) return rateLimitResponse(rate.reset);
  try {
    const a = await access(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in a) return a.res;
    if (!a.email) return json({ ok: true, addresses: [] });
    const rows = await q<Record<string, unknown>>(
      `SELECT qq.ship_to_name AS name, qq.ship_to_company AS company, qq.ship_to_line1 AS line1, qq.ship_to_line2 AS line2,
              qq.ship_to_city AS city, qq.ship_to_state AS state, qq.ship_to_zip AS zip
         FROM public.quotes qq LEFT JOIN public.customers c ON c.id = qq.customer_id
        WHERE qq.tenant_id = $1
          AND lower(trim(coalesce(nullif(qq.email, ''), c.email, ''))) = $2
          AND qq.ship_to_zip IS NOT NULL AND qq.ship_to_zip <> ''
        ORDER BY COALESCE(qq.updated_at, qq.created_at) DESC, qq.id DESC
        LIMIT 100`,
      [a.quote.tenant_id, a.email],
    );
    const hidden = await q<{ address_key: string }>(
      `SELECT address_key FROM public.buyer_hidden_addresses WHERE tenant_id = $1 AND email = $2`,
      [a.quote.tenant_id, a.email],
    ).catch(() => []);
    return json({ ok: true, addresses: savedAddresses(rows, new Set(hidden.map((h) => h.address_key))) });
  } catch (e) {
    console.error("[ship-to/saved] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load saved addresses." }, 500);
  }
}

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 20, "ship-to-saved");
  if (!rate.success) return rateLimitResponse(rate.reset);
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const a = await access(req, b?.quote_no);
    if ("res" in a) return a.res;
    const key = typeof b?.hide === "string" ? b.hide.slice(0, 600) : "";
    if (!key || !a.email) return json({ ok: false, error: "invalid_input", message: "Pick a saved address to remove." }, 400);
    await q(
      `INSERT INTO public.buyer_hidden_addresses (tenant_id, email, address_key) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [a.quote.tenant_id, a.email, key],
    );
    return json({ ok: true });
  } catch (e) {
    console.error("[ship-to/saved] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't remove it. Please try again." }, 500);
  }
}
