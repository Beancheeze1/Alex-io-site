// app/api/admin/test/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Simple JSON probe — great for quick health/header checks.
 * PowerShell:
 *   curl.exe -i "$BASE/api/admin/test?t=$(Get-Random)"
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/admin/test",
    ts: Date.now(),
  });
}
