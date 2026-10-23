// app/api/admin/reps/route.ts
//
// Step 39O: the staff who can get commission (users of the shop with a sales
// slug), for the "Commission to" pickers.
//   GET                 -> { ok, ready, reps: [{ id, name, role, slug }] }
//   GET ?email=a@b.com  -> also { account: { customer_id, account_rep_id } | null },
//                          the existing customer with that email and their account rep
// Staff (admin / cs / sales) of the shop. ready = migration 051 has run.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { accountRepForEmail, accountRepReady, listReps } from "@/app/lib/account-rep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    if (!user) return json({ ok: false, error: "unauthorized", message: "Login required." }, 401);
    if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return json({ ok: false, error: "forbidden", message: "Staff only." }, 403);
    const tenantId = Number(user.tenant_id);
    const email = String(req.nextUrl.searchParams.get("email") || "").trim().slice(0, 200);
    const [ready, reps] = await Promise.all([accountRepReady(), listReps(tenantId)]);
    const account = email ? await accountRepForEmail(tenantId, email) : null;
    return json({ ok: true, ready, reps, ...(email ? { account } : {}) });
  } catch (e) {
    console.error("[admin/reps] failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the reps." }, 500);
  }
}
