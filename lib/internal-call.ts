// lib/internal-call.ts
//
// Step 19: server-to-server calls inside Alex-IO (quote page pricing,
// commissions, email/AI quotes, sketch upload) carry a private header so
// routes can tell them apart from the public. The header value is the
// server's ADMIN_KEY, which never leaves the server.
//   - internalHeaders(): add to fetch() headers for internal calls
//   - isInternalCall(req): true only when the header matches ADMIN_KEY
//   - internalOrStaff(req): internal call, or a signed-in admin / cs / sales user
//   - staffMayTouchQuote(user, quoteId): that user's shop owns the quote (or platform owner)
//   - legacyRouteBlocked(req, name): turns off an old endpoint for everyone but
//     internal calls, and logs each blocked call so it shows up in the server logs

import { timingSafeEqual } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { one } from "@/lib/db";
import { env } from "./env";
import { getCurrentUserFromRequest, isRoleAllowed, type CurrentUser } from "./auth";
import { isPlatformOwner } from "./admin-auth";

export const INTERNAL_HEADER = "x-alexio-internal";

export function internalHeaders(): Record<string, string> {
  return { [INTERNAL_HEADER]: env.ADMIN_KEY };
}

export function isInternalCall(req: Request): boolean {
  const got = req.headers.get(INTERNAL_HEADER) || "";
  const key = env.ADMIN_KEY || "";
  if (!got || !key) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Internal call, or a signed-in admin / cs / sales user. null = neither. */
export async function internalOrStaff(
  req: NextRequest,
): Promise<{ internal: boolean; user: CurrentUser | null } | null> {
  if (isInternalCall(req)) return { internal: true, user: null };
  const user = await getCurrentUserFromRequest(req);
  if (user && isRoleAllowed(user, ["admin", "cs", "sales"])) return { internal: false, user };
  return null;
}

/** True when the quote belongs to the user's shop (or the user is the platform owner). */
export async function staffMayTouchQuote(user: CurrentUser | null, quoteId: number | null | undefined): Promise<boolean> {
  if (!user || quoteId == null) return false;
  if (isPlatformOwner(user)) return true;
  const row = await one<{ tenant_id: number | null }>(`SELECT tenant_id FROM public.quotes WHERE id = $1`, [quoteId]);
  return !!row && Number(row.tenant_id) === Number(user.tenant_id);
}

/**
 * Old endpoints with no caller in the app: refuse public calls (410) and log
 * them as "[legacy-route] blocked ..." so any outside user shows up in the
 * server logs. Returns null when the call may go ahead (internal calls only).
 */
export function legacyRouteBlocked(req: Request, name: string): NextResponse | null {
  if (isInternalCall(req)) return null;
  console.warn(`[legacy-route] blocked call to ${name}`, {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
    userAgent: req.headers.get("user-agent") || "",
    referer: req.headers.get("referer") || "",
  });
  return NextResponse.json(
    { ok: false, error: "route_disabled", message: "This endpoint is turned off." },
    { status: 410 },
  );
}
