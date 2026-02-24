// middleware.ts
//
// Minimal auth gate for internal-only routes (Path A).
// NOTE: Middleware runs on Edge; do NOT import Node crypto auth helpers here.
// We only check presence of the session cookie and redirect to /login.
// Real auth + role enforcement remains server-side in pages/APIs.
//
// A2 Multi-tenant:
// - For TENANT.api.alex-io.com, attach request header: x-tenant-slug=TENANT
// - For api.alex-io.com (core host), no tenant slug header.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "alexio_session";

function extractTenantSlugFromHost(hostRaw: string | null): string | null {
  if (!hostRaw) return null;

  // Strip port if present
  const host = hostRaw.split(":")[0].toLowerCase();

  // Core host (no tenant)
  if (host === "api.alex-io.com") return null;

  // Expect: TENANT.api.alex-io.com
  const parts = host.split(".");
  if (parts.length < 4) return null;
  if (parts.slice(1).join(".") !== "api.alex-io.com") return null;

  const slug = (parts[0] || "").trim();
  if (!slug) return null;

  return slug;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Attach tenant slug header for A2 (if present)
  const tenantSlug = extractTenantSlugFromHost(req.headers.get("host"));

  const requestHeaders = new Headers(req.headers);
  if (tenantSlug) {
    requestHeaders.set("x-tenant-slug", tenantSlug);
  } else {
    // Fail-closed: do not set any tenant header on core host
    requestHeaders.delete("x-tenant-slug");
  }

  // Preserve existing /internal gate behavior (unchanged logic)
  if (pathname.startsWith("/internal")) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";

    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  // Run on everything so tenant context is available everywhere (pages + APIs),
  // while still preserving /internal gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};