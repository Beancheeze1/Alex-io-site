// app/api/quote/box-breaks/route.ts
//
// Boxes-only quantity breaks (Corrugated Step 5).
//
// GET  /api/quote/box-breaks?quote_no=Q-...
//   -> { ok, current_qty, locked, breaks: BoxBreakPrice[] }
//   Prices every box on the quote at each saved break (facts.box_qty_breaks).
//   Read-only. Returns breaks: [] for quotes that aren't boxes-only or have
//   fewer than 2 breaks.
//
// POST /api/quote/box-breaks  { quote_no, qty }
//   Switches the quote to one of its saved breaks: every box row gets the new
//   qty, facts.qty is saved, and the boxes are repriced (repriceQuoteBoxes).
//   Only boxes-only quotes, only a saved break, never a locked quote.
//
// The quote page is public by quote number, so both are open to logged-out
// buyers (rate limited); staff are not limited.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { priceQuoteBoxesAtQtys, repriceQuoteBoxes } from "@/app/lib/packaging-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

/** Whole numbers 1..10M, unique, ascending, at most 4. */
function cleanBreaks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 10_000_000) set.add(n);
  }
  return [...set].sort((a, b) => a - b).slice(0, 4);
}

type QuoteRow = { id: number; tenant_id: number; locked: boolean | null };

async function isStaffRequest(req: NextRequest): Promise<boolean> {
  try {
    const user = await getCurrentUserFromRequest(req);
    return !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isStaffRequest(req))) {
      const rate = await rateLimit(req, 60, "box-breaks-get");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await one<QuoteRow>(
      `SELECT id, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, any>;
    if (facts.pack_type !== "boxes_only") return json({ ok: true, current_qty: null, locked: !!quote.locked, breaks: [] });

    const breaks = cleanBreaks(facts.box_qty_breaks);
    if (breaks.length < 2) return json({ ok: true, current_qty: null, locked: !!quote.locked, breaks: [] });

    const print = parsePrintSpec(facts.print_spec);
    const prices = await priceQuoteBoxesAtQtys(quote.id, Number(quote.tenant_id), print, breaks);
    const current = Number(facts.qty);

    return json({
      ok: true,
      current_qty: Number.isInteger(current) && current > 0 ? current : null,
      locked: !!quote.locked,
      breaks: prices,
    });
  } catch (e) {
    console.error("[quote/box-breaks] GET failed:", e);
    return bad("server_error", "We couldn't load the quantity prices.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isStaffRequest(req))) {
      const rate = await rateLimit(req, 20, "box-breaks-post");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    const qty = Number(b?.qty);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    if (!Number.isInteger(qty) || qty < 1) return bad("invalid_qty", "Pick one of the quantities on your quote.");

    const quote = await one<QuoteRow>(
      `SELECT id, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);
    if (quote.locked) {
      return bad("locked", "This quote is locked. Contact us to change the quantity.", 409);
    }

    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, any>;
    if (facts.pack_type !== "boxes_only") {
      return bad("not_boxes_only", "Quantity breaks are only available on boxes-only quotes.");
    }
    const breaks = cleanBreaks(facts.box_qty_breaks);
    if (!breaks.includes(qty)) return bad("not_a_break", "Pick one of the quantities on your quote.");

    await q(`UPDATE public.quote_box_selections SET qty = $2 WHERE quote_id = $1`, [quote.id, qty]);
    await saveFacts(quoteNo, { ...facts, qty });
    await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), parsePrintSpec(facts.print_spec));

    return json({ ok: true, qty });
  } catch (e) {
    console.error("[quote/box-breaks] POST failed:", e);
    return bad("server_error", "We couldn't change the quantity. Please try again.", 500);
  }
}
