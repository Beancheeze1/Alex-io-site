// app/api/portal/reorder/route.ts
//
// Step 34B: a signed-in buyer reorders one of their released orders.
//   GET  ?quote_no=Q-…  -> { ok, info } (foam sets, box lines, printed, proof)
//   POST { quote_no, foam_qty?, boxes?: [{ id, qty }], artwork_changed? }
//     -> { ok, quote_no, open_url } — the new quote at today's prices
//        (app/lib/reorder.ts); open_url gives this browser its edit grant.
// Buyer session for the quote's shop, and the quote must be theirs.

import { NextRequest, NextResponse } from "next/server";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { readBuyerSession } from "@/lib/buyer-session";
import { buyerOwnsQuote } from "@/app/lib/portal";
import { createReorder, reorderInfo } from "@/app/lib/reorder";
import { cleanReorderInput } from "@/app/lib/reorder-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function owned(req: NextRequest, quoteNoRaw: unknown) {
  const s = readBuyerSession(req);
  if (!s) return { res: json({ ok: false, error: "signed_out", message: "Sign in to reorder." }, 401) };
  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 60) : "";
  if (!quoteNo) return { res: json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400) };
  const own = await buyerOwnsQuote(s.tenantId, s.email, quoteNo);
  if (!own) return { res: json({ ok: false, error: "not_found", message: "Order not found." }, 404) };
  return { tenantId: s.tenantId, quoteNo: own };
}

export async function GET(req: NextRequest) {
  try {
    const o = await owned(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in o) return o.res;
    const r = await reorderInfo(o.quoteNo, o.tenantId);
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);
    return json({ ok: true, info: r.info });
  } catch (e) {
    console.error("[portal/reorder] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Something went wrong. Please try again." }, 500);
  }
}

export async function POST(req: NextRequest) {
  const rate = await rateLimit(req, 10, "portal-reorder");
  if (!rate.success) return rateLimitResponse(rate.reset);
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const o = await owned(req, b?.quote_no);
    if ("res" in o) return o.res;
    const info = await reorderInfo(o.quoteNo, o.tenantId);
    if (!info.ok) return json({ ok: false, error: info.error, message: info.message }, info.status);
    const input = cleanReorderInput(b, info.source);
    if (!input.ok) return json({ ok: false, error: "invalid_input", field: input.field, message: input.message }, 400);
    const r = await createReorder({ tenantId: o.tenantId, srcQuoteNo: o.quoteNo, input: input.value, by: "buyer" });
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);
    return json({ ok: true, quote_no: r.quote_no, open_url: `/api/portal/open?quote_no=${encodeURIComponent(r.quote_no)}` });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") return json({ ok: false, error: "not_migrated", message: "Reorders aren't set up yet." }, 503);
    console.error("[portal/reorder] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't make the reorder. Please try again." }, 500);
  }
}
