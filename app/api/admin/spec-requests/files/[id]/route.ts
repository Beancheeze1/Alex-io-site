// app/api/admin/spec-requests/files/[id]/route.ts
//
// Download a spec request file. Only staff (admin/cs/sales) of the tenant
// that owns the request. Always served as an attachment with nosniff so
// uploaded files are never rendered inline on our origin.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id: rawId } = await ctx.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });

  const f = await one<{ filename: string; size_bytes: number; data: Buffer }>(
    `SELECT f.filename, f.size_bytes, f.data
     FROM public.spec_request_files f
     JOIN public.spec_requests r ON r.id = f.spec_request_id
     WHERE f.id = $1 AND r.tenant_id = $2
     LIMIT 1`,
    [id, user.tenant_id],
  );
  if (!f) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const safeName = f.filename.replace(/["\r\n\\]/g, "_");
  return new NextResponse(new Uint8Array(f.data), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(f.data.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
