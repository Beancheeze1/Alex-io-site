// app/api/admin/quotes/commission/route.ts
//
// Step 39O: who gets the commission on one quote.
//   GET  ?quote_no=Q-...  -> { ok, ready, rep_id, account_rep_id, customer_id,
//                              reps, can_change, why_not }
//   POST { quote_no, rep_id }  rep_id = a staff user with a sales slug, or null
//                              for "No commission". Admin only; not on a
//                              released quote or one whose commission is paid
//                              out. Marks the quote as set by staff, so the
//                              account rep never overrides it.
// GET: staff (admin / cs / sales) of the shop.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { accountRepReady, customerAccountRepId, listReps, markRepSetByStaff } from "@/app/lib/account-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type Row = { id: number; sales_rep_id: number | null; locked: boolean | null; customer_id: number | null; payout: number | null };

async function load(quoteNo: string, tenantId: number): Promise<Row | null> {
  return one<Row>(
    `SELECT id, sales_rep_id, locked, customer_id, (to_jsonb(qq) ->> 'commission_payout_id')::int AS payout
       FROM public."quotes" qq WHERE quote_no = $1 AND tenant_id = $2 LIMIT 1`,
    [quoteNo, tenantId],
  );
}

function whyNot(row: Row, admin: boolean): string | null {
  if (!admin) return "Only an admin can change the commission.";
  if (row.payout) return "This quote's commission has been paid out.";
  if (row.locked) return "Released quotes keep their commission. Revise the quote to change it.";
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return json({ ok: false, error: "forbidden", message: "Staff only." }, 403);
    const tenantId = Number(user.tenant_id);
    const quoteNo = String(req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    const row = await load(quoteNo, tenantId);
    if (!row) return json({ ok: false, error: "not_found", message: "Quote not found." }, 404);
    const ready = await accountRepReady();
    const accountRepId = ready ? await customerAccountRepId(tenantId, row.customer_id) : null;
    const why = whyNot(row, isRoleAllowed(user, ["admin"]));
    return json({
      ok: true,
      ready,
      rep_id: row.sales_rep_id ? Number(row.sales_rep_id) : null,
      account_rep_id: accountRepId,
      customer_id: row.customer_id ? Number(row.customer_id) : null,
      reps: await listReps(tenantId),
      can_change: !why,
      why_not: why,
    });
  } catch (e) {
    console.error("[admin/quotes/commission] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the commission." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin"])) return json({ ok: false, error: "forbidden", message: "Only an admin can change the commission." }, 403);
    const tenantId = Number(user.tenant_id);
    const body = (await req.json().catch(() => null)) as { quote_no?: unknown; rep_id?: unknown } | null;
    const quoteNo = String(body?.quote_no || "").trim().slice(0, 40);
    if (!quoteNo) return json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400);
    const row = await load(quoteNo, tenantId);
    if (!row) return json({ ok: false, error: "not_found", message: "Quote not found." }, 404);
    const why = whyNot(row, true);
    if (why) return json({ ok: false, error: row.payout ? "paid_out" : "locked", message: why }, 409);

    let repId: number | null = null;
    if (body?.rep_id !== null && body?.rep_id !== undefined && body?.rep_id !== "") {
      repId = Number(body.rep_id);
      const reps = await listReps(tenantId);
      if (!Number.isInteger(repId) || !reps.some((r) => r.id === repId)) {
        return json({ ok: false, error: "bad_rep", message: "Pick a team member who has a sales slug." }, 400);
      }
    }
    await q(`UPDATE public."quotes" SET sales_rep_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`, [repId, row.id, tenantId]);
    await markRepSetByStaff(Number(row.id), tenantId);
    return json({ ok: true, rep_id: repId });
  } catch (e) {
    console.error("[admin/quotes/commission] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save the commission." }, 500);
  }
}
