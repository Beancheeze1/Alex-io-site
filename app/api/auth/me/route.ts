// app/api/auth/me/route.ts
//
// Returns the current signed-in user (if any).
// GET -> { ok: true, user: { id, email, name, role } | null }

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);
    return NextResponse.json(
      {
        ok: true,
        user,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error in /api/auth/me:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        user: null,
      },
      { status: 500 },
    );
  }
}
