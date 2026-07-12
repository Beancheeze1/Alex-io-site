// app/api/admin/test/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Simple JSON probe — great for quick health/header checks.
 * PowerShell:
 *   curl.exe -i "$BASE/api/admin/test?t=$(Get-Random)"
 */
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  return NextResponse.json({
    ok: true,
    route: "/api/admin/test",
    ts: Date.now(),
  });
}
