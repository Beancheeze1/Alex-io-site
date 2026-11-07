// app/api/admin/quotes/project-name/route.ts
//
// Step 50: staff set or change a quote's project name.
//   POST { quote_no, project_name } -> { ok, project_name }
// Staff of the quote's shop (admin / cs / sales). Allowed on released quotes
// too: the name is for finding the quote, it doesn't change any price.
// Blank clears it. Up to 80 characters (lib/project-name.ts).

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { cleanProjectName } from "@/lib/project-name";
import { setQuoteProjectName } from "@/app/lib/project-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    const enforced = await enforceTenantMatch(req, user);
    if (!enforced.ok) return json(enforced.body, enforced.status);
    if (!user) return json({ ok: false, error: "UNAUTHENTICATED" }, 401);
    const role = (user.role || "").toLowerCase();
    if (!(role === "admin" || role === "sales" || role === "cs")) {
      return json({ ok: false, error: "FORBIDDEN", message: "Staff access required." }, 403);
    }
    const body = (await req.json().catch(() => null)) as { quote_no?: unknown; project_name?: unknown } | null;
    const quoteNo = typeof body?.quote_no === "string" ? body.quote_no.trim().slice(0, 40) : "";
    if (!quoteNo) return json({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
    if (body?.project_name !== null && body?.project_name !== undefined && typeof body.project_name !== "string") {
      return json({ ok: false, error: "INVALID", message: "Type a project name, or leave it blank." }, 400);
    }
    const quote = await one<{ id: number }>(`select id from quotes where quote_no = $1 and tenant_id = $2`, [
      quoteNo,
      user.tenant_id,
    ]);
    if (!quote) return json({ ok: false, error: "NOT_FOUND" }, 404);
    const saved = await setQuoteProjectName(Number(quote.id), Number(user.tenant_id), body?.project_name ?? null);
    if (!saved) {
      return json({ ok: false, error: "not_migrated", message: "Project names aren't set up yet (migration 054)." }, 503);
    }
    return json({ ok: true, project_name: cleanProjectName(body?.project_name ?? null) });
  } catch (e) {
    console.error("[admin/quotes/project-name] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save the project name." }, 500);
  }
}
