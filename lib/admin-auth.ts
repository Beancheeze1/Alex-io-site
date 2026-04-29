// lib/admin-auth.ts
import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import logger from "./logger";

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const providedKey = req.headers.get("x-admin-key") || req.headers.get("admin-key");

  if (!providedKey) {
    logger.warn("Admin access attempt – missing key", {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
      path: req.nextUrl.pathname,
    });
    return NextResponse.json(
      { ok: false, error: "admin_key_required" },
      { status: 401 }
    );
  }

  if (providedKey !== env.ADMIN_KEY) {
    logger.warn("Admin access attempt – invalid key", {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
      path: req.nextUrl.pathname,
    });
    return NextResponse.json(
      { ok: false, error: "invalid_admin_key" },
      { status: 403 }
    );
  }

  logger.info("Admin access granted", { path: req.nextUrl.pathname });
  return null; // success – continue
}

// Convenience wrapper for route handlers
export function adminOnly(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    const authError = await requireAdmin(req);
    if (authError) return authError;
    return handler(req);
  };
}