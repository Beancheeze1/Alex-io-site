// app/api/portal/orders/route.ts
//
// Step 34A: the signed-in buyer's quotes and orders at a shop.
//   GET ?tenant=slug -> { ok, email, orders: PortalOrder[] }
//   401 signed_out when there's no session for this shop (the page then
//   shows the sign-in form).

import { NextRequest, NextResponse } from "next/server";
import { readBuyerSession } from "@/lib/buyer-session";
import { loadBuyerOrders, portalTenant } from "@/app/lib/portal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const tenant = await portalTenant(req.nextUrl.searchParams.get("tenant"));
    if (!tenant) return json({ ok: false, error: "not_found", message: "Shop not found." }, 404);
    const s = readBuyerSession(req);
    if (!s || s.tenantId !== tenant.id) return json({ ok: false, error: "signed_out", message: "Sign in to see your orders." }, 401);
    const orders = await loadBuyerOrders(tenant.id, s.email);
    return json({ ok: true, email: s.email, orders });
  } catch (e) {
    console.error("[portal/orders] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load your orders. Please try again." }, 500);
  }
}
