// app/api/auth/logout/route.ts
//
// Clears the session cookie.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true }, { status: 200 });

  // Clear cookie by setting empty + maxAge 0.
  // domain/sameSite must match what login sets it with (app/api/auth/login/route.ts)
  // — a mismatched domain creates a *different* cookie instead of clearing
  // the real one, silently leaving the session active.
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    domain: ".alex-io.com",
    maxAge: 0,
  });

  return res;
}

export function GET() {
  return NextResponse.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405 },
  );
}
