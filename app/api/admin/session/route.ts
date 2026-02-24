// app/api/admin/session/route.ts
//
// Admin-only session status endpoint.
// GET /api/admin/session
//
// Returns auth status + session exp so we can diagnose cookie expiry quickly.
//
// Response (success):
//   {
//     ok: true,
//     authenticated: true,
//     user: { id, email, name, role, tenant_id },
//     nowSec: number,
//     sessionExpSec: number | null,
//     secondsLeft: number | null
//   }

import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentUserFromRequest,
  verifySessionToken,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Err = {
  ok: false;
  error: string;
  message: string;
};

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: Err, status = 400) {
  return NextResponse.json(body, { status });
}

function isAdminUser(user: any): boolean {
  const role = String(user?.role || user?.user?.role || "")
    .trim()
    .toLowerCase();
  return role === "admin";
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUserFromRequest(req);

    if (!user) {
      return bad(
        { ok: false, error: "unauthorized", message: "Login required." },
        401,
      );
    }

    if (!isAdminUser(user)) {
      return bad(
        { ok: false, error: "forbidden", message: "Admin role required." },
        403,
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Read the raw session cookie token and decode exp (if present/valid).
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || null;
    const payload = verifySessionToken(token);

    const sessionExpSec =
      payload && typeof (payload as any).exp === "number" ? (payload as any).exp : null;

    const secondsLeft =
      typeof sessionExpSec === "number" ? Math.max(0, sessionExpSec - nowSec) : null;

    return ok(
      {
        ok: true,
        authenticated: true,
        user,
        nowSec,
        sessionExpSec,
        secondsLeft,
      },
      200,
    );
  } catch (e: any) {
    return bad(
      {
        ok: false,
        error: "session_status_failed",
        message: String(e?.message || e),
      },
      500,
    );
  }
}