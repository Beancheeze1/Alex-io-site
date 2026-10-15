// app/api/admin/quotes/approval/route.ts
//
// Step 28: the shop's side of estimate -> accepted -> confirmed (admin quote
// page, "Approval" card).
//   GET  ?quote_no=…  -> { ok, locked, approval, buyer_email, emails }
//   POST { quote_no, action, ... }
//     action "confirm"   { buyer_name?, po? }  confirm the current price. If
//                        the buyer hasn't accepted it (or the price changed
//                        since), buyer_name records their acceptance for them
//                        (e.g. a PO by email); without it the call is refused.
//                        Step 29A: emails the buyer "order confirmed" unless
//                        notify_buyer is false (or the shop turned it off).
//     action "unconfirm"                       take the confirmation back
//     action "expiry"    { expires_on: "YYYY-MM-DD" | null }  null = shop default
//     action "lead_time" { lead_time: string | null }         null = shop default
//     action "email_reapprove"   Step 29A: email the buyer "your quote was
//                        updated, please re-approve" (only when the price
//                        changed since they accepted)
//   POST -> { ok, locked, approval, buyer_email, emails, email? }
// Staff (admin / cs / sales) of the quote's shop, or the platform owner.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { approvalForQuote, quoteFreightNow } from "@/app/lib/quote-approval";
import { saveFreightLock } from "@/app/lib/freight";
import { MAX_LEAD_TIME_LEN, MAX_NAME_LEN, MAX_PO_LEN, cleanText } from "@/app/lib/quote-approval-core";
import { recentQuoteEmails, sendQuoteStatusEmail, type MailOutcome } from "@/app/lib/quote-mail";
import { isEmail } from "@/app/lib/quote-mail-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null; email: string | null };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

async function staffQuote(
  req: NextRequest,
  quoteNoRaw: unknown,
): Promise<{ quote: QuoteRow; who: string } | { res: NextResponse }> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: bad("unauthorized", "Login required.", 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: bad("forbidden", "Staff only.", 403) };
  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 40) : "";
  if (!quoteNo) return { res: bad("missing_quote_no", "quote_no is required.") };
  const quote = await one<QuoteRow>(
    `SELECT id, quote_no, tenant_id, locked, email FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
    return { res: bad("not_found", "Quote not found.", 404) };
  }
  const u = user as { name?: string | null; email?: string | null };
  return { quote, who: String(u.name || u.email || "staff").slice(0, 120) };
}

/** Step 29A: the buyer email (if any) and the quote's recent emails, for the panel. */
async function mailInfo(quote: QuoteRow) {
  return {
    buyer_email: isEmail(quote.email) ? String(quote.email).trim() : null,
    emails: await recentQuoteEmails(quote.id),
  };
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const approval = await approvalForQuote({ id: r.quote.id, quote_no: r.quote.quote_no, tenant_id: Number(r.quote.tenant_id) });
    if (!approval) return bad("no_total", "Couldn't work out the quote total.", 503);
    return json({ ok: true, locked: !!r.quote.locked, approval, ...(await mailInfo(r.quote)) });
  } catch (e) {
    console.error("[admin/quotes/approval] GET failed:", e);
    return bad("server_error", "Couldn't load the approval.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return bad("invalid_body", "Expected a JSON body.");
    const r = await staffQuote(req, b.quote_no);
    if ("res" in r) return r.res;
    const { quote, who } = r;
    const ref = { id: quote.id, quote_no: quote.quote_no, tenant_id: Number(quote.tenant_id) };
    const action = String(b.action || "");
    let email: MailOutcome | null = null;

    if (action === "confirm") {
      const a = await approvalForQuote(ref);
      if (!a) return bad("no_total", "Couldn't work out the quote total.", 503);
      if (a.current_total <= 0) return bad("no_price", "This quote doesn't have a price yet.", 409);
      if (a.stage === "confirmed") return bad("already_confirmed", "This quote is already confirmed at this price.", 409);
      if (a.stage !== "accepted") {
        // Record the buyer's acceptance for them (PO by email, phone, ...).
        const buyerName = cleanText(b.buyer_name, MAX_NAME_LEN);
        if (!buyerName) {
          return bad(
            "not_accepted",
            a.stage === "needs_reapproval"
              ? "The price changed since the buyer accepted. Ask them to re-approve, or enter who approved it to record it for them."
              : "The buyer hasn't accepted this quote. Enter who approved it to record it for them.",
            409,
          );
        }
        await q(
          `UPDATE public.quotes
              SET accepted_at = now(), accepted_name = $2, accepted_po = $3, accepted_total = $4,
                  accepted_by_staff = true
            WHERE id = $1`,
          [quote.id, buyerName, cleanText(b.po, MAX_PO_LEN), a.current_total],
        );
      }
      await q(
        `UPDATE public.quotes
            SET confirmed_at = now(), confirmed_by = $2, confirmed_total = $3,
                status = 'confirmed', updated_at = now()
          WHERE id = $1`,
        [quote.id, who, a.current_total],
      );
      // Step 30B: keep the freight the confirmed total includes.
      const fNow = await quoteFreightNow(quote.quote_no);
      if (fNow) await saveFreightLock(quote.id, fNow.preFreightTotal, fNow.freight);
      // Step 29A: "your order is confirmed" (staff can untick it).
      if (b.notify_buyer !== false) email = await sendQuoteStatusEmail({ quoteId: quote.id, kind: "confirmed", by: who });
    } else if (action === "email_reapprove") {
      const a = await approvalForQuote(ref);
      if (!a) return bad("no_total", "Couldn't work out the quote total.", 503);
      if (a.stage !== "needs_reapproval") {
        return bad("not_changed", "The price hasn't changed since the buyer accepted, so there's nothing to re-approve.", 409);
      }
      if (!isEmail(quote.email)) return bad("no_buyer_email", "This quote has no buyer email.", 409);
      email = await sendQuoteStatusEmail({ quoteId: quote.id, kind: "reapprove", by: who });
      if (email.status !== "sent") {
        return bad("email_failed", `The email wasn't sent (${email.detail || email.status}).`, 502);
      }
    } else if (action === "unconfirm") {
      await q(
        `UPDATE public.quotes
            SET confirmed_at = NULL, confirmed_by = NULL, confirmed_total = NULL,
                status = CASE WHEN accepted_at IS NOT NULL THEN 'accepted' ELSE status END,
                updated_at = now()
          WHERE id = $1`,
        [quote.id],
      );
    } else if (action === "expiry") {
      const raw = b.expires_on;
      let at: string | null = null;
      if (raw !== null && raw !== undefined && raw !== "") {
        const s = String(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(new Date(`${s}T23:59:59Z`).getTime())) {
          return bad("invalid_date", "Pick a valid expiry date.");
        }
        at = `${s}T23:59:59Z`;
      }
      await q(`UPDATE public.quotes SET expires_at = $2, updated_at = now() WHERE id = $1`, [quote.id, at]);
    } else if (action === "lead_time") {
      const text = b.lead_time === null ? null : cleanText(b.lead_time, MAX_LEAD_TIME_LEN);
      await q(`UPDATE public.quotes SET lead_time_text = $2, updated_at = now() WHERE id = $1`, [quote.id, text]);
    } else {
      return bad("invalid_action", "action must be confirm, unconfirm, expiry, lead_time or email_reapprove.");
    }

    const approval = await approvalForQuote(ref);
    return json({
      ok: true,
      locked: !!quote.locked,
      approval,
      ...(await mailInfo(quote)),
      ...(email ? { email: { status: email.status, to: email.to, detail: email.detail } } : {}),
    });
  } catch (e) {
    console.error("[admin/quotes/approval] POST failed:", e);
    return bad("server_error", "Couldn't save. Please try again.", 500);
  }
}
