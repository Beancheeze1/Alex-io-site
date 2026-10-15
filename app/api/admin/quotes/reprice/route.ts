// app/api/admin/quotes/reprice/route.ts
//
// POST /api/admin/quotes/reprice  { quote_no }  (Step 10B)
//
// "Reprice at today's rates": staff (admin / cs / sales) of the quote's shop
// move a saved quote to the shop's current prices.
//   - Foam: the saved foam prices are cleared; the next view prices them at
//     today's rates and saves them again (app/lib/pricing/foam-lock.ts).
//   - Charges: quotes.price_lock is cleared, so today's printing / die-cut
//     settings are saved on the next view.
//   - Boxes: every box is repriced now at today's rates, keeping its own
//     print (per-size quotes) or the quote's print spec.
// Locked (released) quotes are refused: revise them first.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { repriceQuoteBoxes } from "@/app/lib/packaging-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return json({ ok: false, error: "forbidden" }, 403);

    const b = (await req.json().catch(() => null)) as { quote_no?: unknown } | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);

    const quote = await one<{ id: number; quote_no: string; tenant_id: number; locked: boolean | null }>(
      `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
      return json({ ok: false, error: "not_found", message: "Quote not found." }, 404);
    }
    if (quote.locked) {
      return json(
        { ok: false, error: "quote_locked", message: "This quote is released. Revise it before repricing." },
        409,
      );
    }

    // Foam: clear the saved prices; the next view re-prices and re-saves them.
    await q(
      `UPDATE public.quote_items
          SET price_unit_usd = NULL, price_total_usd = NULL, calc_snapshot = NULL
        WHERE quote_id = $1`,
      [quote.id],
    );

    // Step 28: repricing restarts the "quote valid" clock (and drops an expiry set on the quote).
    try {
      await q(`UPDATE public.quotes SET priced_at = now(), expires_at = NULL WHERE id = $1`, [quote.id]);
    } catch (e) {
      console.warn("[admin/quotes/reprice] expiry not reset (migration 038 not run?)", String(e));
    }

    // Charges: today's printing / die-cut settings are saved on the next view.
    try {
      await q(`UPDATE public.quotes SET price_lock = NULL WHERE id = $1`, [quote.id]);
    } catch (e) {
      console.warn("[admin/quotes/reprice] price_lock not cleared (migration 031 not run?)", String(e));
    }

    // Boxes: reprice now at today's rates.
    const boxes = await q<{ id: number }>(
      `SELECT id FROM public.quote_box_selections WHERE quote_id = $1`,
      [quote.id],
    );
    if (boxes.length > 0) {
      const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
      const printArg = facts.print_mode === "per_box" ? "per_box" : parsePrintSpec(facts.print_spec);
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), printArg);
    }

    return json({ ok: true, quote_no: quote.quote_no, boxes_repriced: boxes.length });
  } catch (e) {
    console.error("[admin/quotes/reprice] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't reprice the quote. Please try again." }, 500);
  }
}
