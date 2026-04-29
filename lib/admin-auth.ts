// lib/admin-auth.ts
import { NextRequest, NextResponse } from "next/server";
import { env } from "./env";
import logger from "./logger";
import { getCurrentUserFromRequest, isRoleAllowed } from "./auth";

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  // 1. Check for x-admin-key header (extra security layer)
  const providedKey = req.headers.get("x-admin-key") || req.headers.get("admin-key");
  if (providedKey && providedKey === env.ADMIN_KEY) {
    logger.info("Admin access granted via key", { path: req.nextUrl.pathname });
    return null; // success
  }

  // 2. Fallback to existing session + role check (for the admin UI)
  const user = await getCurrentUserFromRequest(req);
  if (user && isRoleAllowed(user, ["admin"])) {
    logger.info("Admin access granted via session", { path: req.nextUrl.pathname, userId: user.id });
    return null; // success
  }

  // No valid key or session → deny
  logger.warn("Admin access denied", {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
    path: req.nextUrl.pathname,
    hasKey: !!providedKey,
    hasSession: !!user,
  });

  return NextResponse.json(
    { ok: false, error: "admin_access_required" },
    { status: 401 }
  );
}

// Convenience wrapper
export function adminOnly(handler: (req: NextRequest) => Promise<NextResponse>) {
  return async (req: NextRequest) => {
    const authError = await requireAdmin(req);
    if (authError) return authError;
    return handler(req);
  };
}