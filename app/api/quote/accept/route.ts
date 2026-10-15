// app/api/quote/accept/route.ts
//
// Step 28: the buyer accepts (or re-approves) the quote's current price.
//   POST { quote_no, name, po?, agree: true }
//     -> { ok, approval }
// - Needs the buyer's edit link (or staff of the quote's shop), like every
//   other buyer change (Step 21). Released quotes are refused.
// - Refused when the quote has expired, has no price yet, or is already
//   accepted / confirmed at this price.
// - Records the name, PO and the total being accepted; a re-approval clears
//   any earlier shop confirmation (it was for another price). The shop gets
//   an "Accepted" alert.
// - Step 29A: the buyer gets an "approval received" email (shop setting).

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { buyerEditGuard } from "@/lib/quote-edit";
import { addAdminAlert } from "@/lib/admin-alerts";
import { approvalForQuote } from "@/app/lib/quote-approval";
import { sendQuoteStatusEmail } from "@/app/lib/quote-mail";
import { MAX_NAME_LEN, MAX_PO_LEN, buyerCanAccept, cleanText } from "@/app/lib/quote-approval-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const name = cleanText(b?.name, MAX_NAME_LEN);
    const po = cleanText(b?.po, MAX_PO_LEN);
    if (!name) return bad("missing_name", "Enter your name to accept the quote.");
    if (b?.agree !== true) return bad("not_agreed", "Tick the box to accept this estimate.");

    const quote = await one<{ id: number; quote_no: string; tenant_id: number; locked: boolean | null }>(
      `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const guard = await buyerEditGuard(req, quote, {
      rateName: "quote-accept",
      perMin: 10,
      lockedMessage: "This quote has been released. Contact the shop with any changes.",
    });
    if (guard) return guard;

    const approval = await approvalForQuote({ id: quote.id, quote_no: quote.quote_no, tenant_id: Number(quote.tenant_id) });
    if (!approval) return bad("no_total", "We couldn't work out this quote's total. Please try again.", 503);
    if (approval.current_total <= 0) return bad("no_price", "This quote doesn't have a price yet.", 409);
    if (approval.expired) {
      return bad("expired", "This quote has expired. Ask the shop to refresh the price.", 409);
    }
    if (!buyerCanAccept(approval, !!quote.locked)) {
      return bad("already_accepted", "This quote is already accepted at this price.", 409);
    }

    const reapproval = approval.stage === "needs_reapproval";
    await q(
      `UPDATE public.quotes
          SET accepted_at = now(),
              accepted_name = $2,
              accepted_po = $3,
              accepted_total = $4,
              accepted_by_staff = false,
              confirmed_at = NULL,
              confirmed_by = NULL,
              confirmed_total = NULL,
              status = 'accepted',
              updated_at = now()
        WHERE id = $1`,
      [quote.id, name, po, approval.current_total],
    );

    await addAdminAlert({
      req,
      tenantId: Number(quote.tenant_id),
      quoteNo: quote.quote_no,
      kind: "accepted",
      title: reapproval ? "Buyer re-approved the new price" : "Buyer accepted the quote",
      detail: `${name}${po ? ` · PO ${po}` : ""} · $${approval.current_total.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}. Confirm it on the quote page.`,
    });

    // Step 29A: "we received your approval" (never fails the acceptance).
    const email = await sendQuoteStatusEmail({ quoteId: quote.id, kind: "accepted", by: name, reapproval });

    const after = await approvalForQuote({ id: quote.id, quote_no: quote.quote_no, tenant_id: Number(quote.tenant_id) });
    return json({ ok: true, approval: after, email: { status: email.status } });
  } catch (e) {
    console.error("[quote/accept] failed:", e);
    return bad("server_error", "We couldn't record your acceptance. Please try again.", 500);
  }
}
