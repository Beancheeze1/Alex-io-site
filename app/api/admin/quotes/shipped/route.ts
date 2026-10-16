// app/api/admin/quotes/shipped/route.ts
//
// Step 34A: staff mark a released order shipped (the buyer portal shows it,
// and the buyer gets a "shipped" email unless staff say not to or the shop
// turned it off in Settings).
//   GET  ?quote_no=Q-…  -> { ok, released, shipped: { at, carrier, tracking, tracking_url, note, by } | null }
//   POST { quote_no, carrier, tracking?, note?, notify_buyer? } -> { ok, shipped, email }
//        { quote_no, clear: true } -> { ok, shipped: null } (no email)
// Staff (admin / cs / sales) of the shop. Only released quotes can be shipped.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { sendQuoteStatusEmail } from "@/app/lib/quote-mail";
import { cleanShipped, trackingUrl } from "@/app/lib/portal-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function bad(error: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ ok: false, error, message, ...extra }, status);
}

type Row = { id: number; quote_no: string; j: Record<string, unknown> };

const iso = (v: unknown) => (v == null || v === "" ? null : String(v));

function shippedOf(j: Record<string, unknown>) {
  const at = iso(j.shipped_at);
  if (!at) return null;
  const carrier = iso(j.shipped_carrier);
  const tracking = iso(j.shipped_tracking);
  return { at, carrier, tracking, tracking_url: trackingUrl(carrier, tracking), note: iso(j.shipped_note), by: iso(j.shipped_by) };
}

async function staff(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: bad("unauthorized", "Login required.", 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: bad("forbidden", "Staff only.", 403) };
  return { user, tenantId: Number(user.tenant_id) };
}

async function loadQuote(quoteNo: string, tenantId: number): Promise<Row | null> {
  return one<Row>(
    `SELECT id, quote_no, to_jsonb(q) AS j FROM public.quotes q WHERE quote_no = $1 AND tenant_id = $2 LIMIT 1`,
    [quoteNo, tenantId],
  );
}

export async function GET(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const quoteNo = String(req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const row = await loadQuote(quoteNo, s.tenantId);
    if (!row) return bad("not_found", "Quote not found.", 404);
    return json({ ok: true, released: row.j?.locked === true, shipped: shippedOf(row.j || {}) });
  } catch (e) {
    console.error("[admin/quotes/shipped] GET failed:", e);
    return bad("server_error", "Couldn't load shipping.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    const row = await loadQuote(quoteNo, s.tenantId);
    if (!row) return bad("not_found", "Quote not found.", 404);

    if (b?.clear === true) {
      await q(
        `UPDATE public.quotes
            SET shipped_at = NULL, shipped_carrier = NULL, shipped_tracking = NULL, shipped_note = NULL, shipped_by = NULL
          WHERE id = $1 AND tenant_id = $2`,
        [row.id, s.tenantId],
      );
      return json({ ok: true, shipped: null, email: null });
    }

    if (row.j?.locked !== true) return bad("NOT_RELEASED", "Release the quote for manufacture before marking it shipped.", 409);
    const c = cleanShipped(b);
    if (!c.ok) return bad("invalid_input", c.message, 400, { field: c.field });
    const who = String((s.user as { name?: string | null }).name || s.user.email || "staff").slice(0, 120);
    const was = shippedOf(row.j || {});
    const updated = await one<{ j: Record<string, unknown> }>(
      `UPDATE public.quotes
          SET shipped_at = COALESCE(shipped_at, now()), shipped_carrier = $3, shipped_tracking = $4, shipped_note = $5, shipped_by = $6
        WHERE id = $1 AND tenant_id = $2
       RETURNING to_jsonb(quotes) AS j`,
      [row.id, s.tenantId, c.value.carrier, c.value.tracking, c.value.note, who],
    );
    // The buyer hears about it once, when it's first marked (edits to the tracking don't re-send).
    const email = !was && b?.notify_buyer !== false ? (await sendQuoteStatusEmail({ quoteId: row.id, kind: "shipped", by: who })).status : null;
    return json({ ok: true, shipped: shippedOf(updated?.j || {}), email });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") return bad("not_migrated", "Shipping isn't set up yet (migration 045).", 503);
    console.error("[admin/quotes/shipped] POST failed:", e);
    return bad("server_error", "Couldn't save. Please try again.", 500);
  }
}
