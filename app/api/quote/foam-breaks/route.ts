// app/api/quote/foam-breaks/route.ts
//
// Step 24: foam "Price by quantity" (foam-only and complete-pack quotes).
//   GET  ?quote_no=…  -> { ok, current_qty, locked, has_boxes, printing_extra,
//                         breaks: [{ qty, foam_usd, cutting_usd, method,
//                                    boxes_usd, plates_usd, total_usd, unit_usd, stored }] }
//                        (breaks is empty unless there are 2+ quantities)
//   POST { quote_no, qty } -> makes one of the compare quantities the
//        quantity on the quote: every quote line, every box and facts.qty
//        move to it; the boxes are repriced now, the foam on the next view
//        (its price lock key includes the quantity).
// The quote number is enough to see the prices (rate limited); switching
// needs staff of the quote's shop or the buyer's edit link (Step 21), and
// buyers can't switch a released quote. Boxes-only quotes use
// /api/quote/box-breaks.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { buyerEditGuard, isQuoteStaff } from "@/lib/quote-edit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { addAdminAlert } from "@/lib/admin-alerts";
import { repriceQuoteBoxes } from "@/app/lib/packaging-selection";
import { foamBreakQtys, foamBreaksForQuote } from "@/app/lib/pricing/foam-breaks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

export async function GET(req: NextRequest) {
  try {
    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await one<{ tenant_id: number }>(`SELECT tenant_id FROM public.quotes WHERE quote_no = $1 LIMIT 1`, [quoteNo]);
    if (!quote) return bad("not_found", "Quote not found.", 404);
    if (!(await isQuoteStaff(req, quote.tenant_id))) {
      const rate = await rateLimit(req, 30, "foam-breaks-get");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const out = await foamBreaksForQuote(quoteNo);
    if (!out) return bad("not_found", "Quote not found.", 404);
    return json(out);
  } catch (e) {
    console.error("[quote/foam-breaks] GET failed:", e);
    return bad("server_error", "We couldn't load the quantity prices.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    const qty = Number(b?.qty);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    if (!Number.isInteger(qty) || qty < 1) return bad("invalid_qty", "Pick one of the quantities on your quote.");

    const quote = await one<{ id: number; quote_no: string; tenant_id: number; locked: boolean | null }>(
      `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const guard = await buyerEditGuard(req, quote, {
      rateName: "foam-breaks-post",
      perMin: 20,
      lockedMessage: "This quote has been released. Contact the shop to change the quantity.",
    });
    if (guard) return guard;
    if (quote.locked) {
      return bad("locked", "This quote is released. Revise it to change the quantity.", 409);
    }

    const info = await foamBreakQtys(quote.quote_no);
    if (!info || info.list.length < 2) return bad("no_breaks", "This quote has no other quantities to switch to.");
    if (!info.list.includes(qty)) return bad("not_a_break", "Pick one of the quantities on your quote.");
    if (info.current === qty) return json({ ok: true, qty, unchanged: true });

    // Every line on a foam quote carries the order quantity (the billable set,
    // its layer rows and any carton rows), and the boxes follow the foam.
    await q(`UPDATE public.quote_items SET qty = $2 WHERE quote_id = $1`, [quote.id, qty]);
    const boxes = await q<{ id: number }>(`SELECT id FROM public.quote_box_selections WHERE quote_id = $1`, [quote.id]);
    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    if (boxes.length > 0) {
      await q(`UPDATE public.quote_box_selections SET qty = $2 WHERE quote_id = $1`, [quote.id, qty]);
      const printArg = facts.print_mode === "per_box" ? "per_box" : parsePrintSpec(facts.print_spec);
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), printArg);
    }
    // Step 25: keep the quantity we switched away from, so the buyer can switch back.
    const kept = [...new Set([...info.list.filter((n) => n !== qty)])].slice(0, 3);
    await saveFacts(quote.quote_no, { ...facts, qty, foam_qty_breaks: kept });

    await addAdminAlert({
      req,
      tenantId: Number(quote.tenant_id),
      quoteNo: quote.quote_no,
      kind: "buyer_change",
      title: `Quantity changed to ${qty.toLocaleString("en-US")}`,
      detail: "Switched to one of the compare quantities on the quote.",
    });

    return json({ ok: true, qty, boxes_repriced: boxes.length });
  } catch (e) {
    console.error("[quote/foam-breaks] POST failed:", e);
    return bad("server_error", "We couldn't change the quantity. Please try again.", 500);
  }
}
