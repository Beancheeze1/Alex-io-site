// app/api/quote/ship-to/route.ts
//
// Step 30: the quote's ship-to and freight terms.
//   POST { quote_no, terms, name?, company?, line1?, line2?, city?, state?,
//          zip?, account?, freight_override_usd? }
//     -> { ok, ship_to }
// - The buyer's edit link (or staff of the quote's shop), like every other
//   buyer change (Step 21). Released quotes are refused for buyers.
// - terms must be one the shop allows. A ZIP is needed unless it's pickup.
// - freight_override_usd (a number, or null to go back to the freight table)
//   is staff only.
// The quote page then shows the new freight; with prepaid & add it's in the
// quote total, so an accepted quote needs re-approval if it changes.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { buyerEditGuard, isQuoteStaff } from "@/lib/quote-edit";
import { cleanZip, isFreightTerms } from "@/app/lib/freight-core";
import { loadShipTo, shopFreightSettings } from "@/app/lib/freight";
import { addAdminAlert } from "@/lib/admin-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return bad("invalid_body", "Expected a JSON body.");
    const quoteNo = typeof b.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await one<{ id: number; quote_no: string; tenant_id: number; locked: boolean | null }>(
      `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const guard = await buyerEditGuard(req, quote, {
      rateName: "quote-ship-to",
      perMin: 20,
      lockedMessage: "This quote has been released. Contact the shop to change the ship-to.",
    });
    if (guard) return guard;
    const staff = await isQuoteStaff(req, quote.tenant_id);

    const settings = await shopFreightSettings(Number(quote.tenant_id));
    if (!isFreightTerms(b.terms) || !settings.terms_allowed.includes(b.terms)) {
      return bad("invalid_terms", "Pick one of the freight options this shop offers.");
    }
    const terms = b.terms;
    const zipRaw = text(b.zip, 12);
    const zip = zipRaw ? cleanZip(zipRaw) : null;
    if (zipRaw && !zip) return bad("invalid_zip", "Enter a 5-digit US ZIP code.");
    if (!zip && terms !== "pickup") return bad("missing_zip", "Enter the ship-to ZIP code.");
    const stateRaw = text(b.state, 20);
    const state = stateRaw ? stateRaw.toUpperCase() : null;
    if (state && !/^[A-Z]{2}$/.test(state)) return bad("invalid_state", "Use the 2-letter state code (e.g. OH).");

    let override: number | null | undefined; // undefined = leave as is
    if (Object.prototype.hasOwnProperty.call(b, "freight_override_usd")) {
      if (!staff) return bad("forbidden", "Only the shop can set the freight.", 403);
      const raw = b.freight_override_usd;
      if (raw === null || raw === "") override = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return bad("invalid_override", "Freight must be a dollar amount.");
        override = Math.round(n * 100) / 100;
      }
    }

    const before = await loadShipTo(quote.id);
    await q(
      `UPDATE public.quotes
          SET freight_terms = $2, ship_to_name = $3, ship_to_company = $4, ship_to_line1 = $5,
              ship_to_line2 = $6, ship_to_city = $7, ship_to_state = $8, ship_to_zip = $9,
              freight_account = $10,
              freight_override_usd = CASE WHEN $11::boolean THEN $12::numeric ELSE freight_override_usd END,
              updated_at = now()
        WHERE id = $1`,
      [
        quote.id,
        terms,
        text(b.name, 120),
        text(b.company, 120),
        text(b.line1, 160),
        text(b.line2, 160),
        text(b.city, 80),
        state,
        zip,
        terms === "fob_origin" ? text(b.account, 60) : null,
        override !== undefined,
        override ?? null,
      ],
    );

    if (!staff && (before.zip !== zip || before.terms !== terms)) {
      await addAdminAlert({
        req,
        tenantId: Number(quote.tenant_id),
        quoteNo: quote.quote_no,
        kind: "buyer_change",
        title: "Buyer updated the ship-to",
        detail: `${terms === "pickup" ? "Customer pickup" : `Ship to ${zip}`} (${terms.replace("_", " ")}).`,
      });
    }

    return json({ ok: true, ship_to: await loadShipTo(quote.id) });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") return bad("not_migrated", "Ship-to isn't set up yet (migration 041).", 503);
    console.error("[quote/ship-to] failed:", e);
    return bad("server_error", "We couldn't save the ship-to. Please try again.", 500);
  }
}
