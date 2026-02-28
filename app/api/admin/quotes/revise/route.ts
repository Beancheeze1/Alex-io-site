import { NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { loadFacts, saveFacts } from "@/app/lib/memory";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const quoteNo = typeof body?.quoteNo === "string" ? body.quoteNo.trim() : "";
  if (!quoteNo) {
    return NextResponse.json({ ok: false, error: "MISSING_QUOTE_NO" }, { status: 400 });
  }

  const user = await getCurrentUserFromRequest(req as any);
  const enforced = await enforceTenantMatch(req as any, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });

  if (!user) {
    return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  if (!isRoleAllowed(user, ["admin", "cs"])) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const row = await one(
    `select id from quotes where quote_no = $1 and tenant_id = $2 limit 1`,
    [quoteNo, user.tenant_id],
  );

  if (!row) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const facts: any = await loadFacts(quoteNo);
  facts.stage_pending_bump = true;
  await saveFacts(quoteNo, facts);

  return NextResponse.json({ ok: true });
}
