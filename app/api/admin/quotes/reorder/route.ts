// app/api/admin/quotes/reorder/route.ts
//
// Step 34B: staff reorder a released job for the customer.
//   GET  ?quote_no=Q-…  -> { ok, info }
//   POST { quote_no, foam_qty?, boxes?: [{ id, qty }], artwork_changed? }
//     -> { ok, quote_no, url } — the new quote (R- number) at today's prices
// Staff (admin / cs / sales) of the shop. No alert (staff made it).

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { createReorder, reorderInfo } from "@/app/lib/reorder";
import { cleanReorderInput } from "@/app/lib/reorder-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function staff(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: json({ ok: false, error: "unauthorized", message: "Login required." }, 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: json({ ok: false, error: "forbidden", message: "Staff only." }, 403) };
  return { user, tenantId: Number(user.tenant_id) };
}

export async function GET(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const quoteNo = String(req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 60);
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    const r = await reorderInfo(quoteNo, s.tenantId);
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);
    return json({ ok: true, info: r.info });
  } catch (e) {
    console.error("[admin/quotes/reorder] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Something went wrong." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const s = await staff(req);
    if ("res" in s) return s.res;
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 60) : "";
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    const info = await reorderInfo(quoteNo, s.tenantId);
    if (!info.ok) return json({ ok: false, error: info.error, message: info.message }, info.status);
    const input = cleanReorderInput(b, info.source);
    if (!input.ok) return json({ ok: false, error: "invalid_input", field: input.field, message: input.message }, 400);
    const r = await createReorder({
      tenantId: s.tenantId,
      srcQuoteNo: info.info.quote_no,
      input: input.value,
      by: "staff",
      byName: String((s.user as { name?: string | null }).name || s.user.email || "staff"),
    });
    if (!r.ok) return json({ ok: false, error: r.error, message: r.message }, r.status);
    return json({ ok: true, quote_no: r.quote_no, url: `/admin/quotes/${encodeURIComponent(r.quote_no)}` });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "42703") return json({ ok: false, error: "not_migrated", message: "Reorders aren't set up yet (migration 046)." }, 503);
    console.error("[admin/quotes/reorder] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't make the reorder." }, 500);
  }
}
