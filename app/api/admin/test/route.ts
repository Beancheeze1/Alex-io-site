// app/api/admin/test/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Simple health endpoint for admin testing.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/admin/test",
    now: new Date().toISOString(),
  });
}
