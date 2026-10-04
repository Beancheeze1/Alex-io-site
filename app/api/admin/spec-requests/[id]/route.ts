// app/api/admin/spec-requests/[id]/route.ts
//
// PATCH { status } on a spec request in the caller's own tenant.
// Roles: admin, cs, sales.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["new", "in_progress", "quoted", "closed"]);

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized", message: "Login required." }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) {
    return NextResponse.json({ ok: false, error: "forbidden", message: "Not allowed." }, { status: 403 });
  }

  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_id", message: "Invalid id." }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const status = typeof body?.status === "string" ? body.status : "";
  if (!STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: "invalid_status", message: "Invalid status." }, { status: 400 });
  }

  const row = await one<{ id: number; status: string }>(
    `UPDATE public.spec_requests SET status = $3, updated_at = now()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, status`,
    [id, user.tenant_id, status],
  );
  if (!row) return NextResponse.json({ ok: false, error: "not_found", message: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, id: Number(row.id), status: row.status });
}
