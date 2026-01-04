// app/api/auth/whoami/route.ts
//
// Sanity endpoint for auth/RBAC debugging.
// Returns current user + role if authenticated, else authenticated:false.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);

  if (!user) {
    return NextResponse.json({
      ok: true,
      authenticated: false,
      user: null,
      role: null,
    });
  }

  return NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    role: user.role,
  });
}
