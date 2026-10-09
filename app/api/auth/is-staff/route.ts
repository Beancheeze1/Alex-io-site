// app/api/auth/is-staff/route.ts
//
// GET /api/auth/is-staff -> { ok: true, staff: boolean }
// True when the caller is logged in as admin / cs / sales. Lets public pages
// (layout editor) show staff-only tools. Never errors for logged-out callers.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  let staff = false;
  try {
    const user = await getCurrentUserFromRequest(req);
    staff = !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
  } catch {
    staff = false;
  }
  return NextResponse.json({ ok: true, staff }, { headers: { "Cache-Control": "no-store" } });
}
