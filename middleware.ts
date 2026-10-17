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
//
// Step 37L: TENANT.api.alex-io.com/ shows that shop's page (/t/TENANT).
//
// NEW (Path A): /admin requires a session cookie present.
// Tenant correctness is enforced server-side by lib/auth.ts (Host->tenant match).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "alexio_session";

function extractTenantSlugFromHost(hostRaw: string | null): string | null {
  if (!hostRaw) return null;

  // Strip port if present
  const host = hostRaw.split(":")[0].toLowerCase();

  // Core host = Default tenant
  if (host === "api.alex-io.com") return "default";

  // Expect: TENANT.api.alex-io.com
  const parts = host.split(".");
  if (parts.length < 4) return null;
  if (parts.slice(1).join(".") !== "api.alex-io.com") return null;

  const slug = (parts[0] || "").trim();
  if (!slug) return null;

  return slug;
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Attach tenant slug header for A2 (if present)
  const tenantSlug = extractTenantSlugFromHost(req.headers.get("host"));

  const requestHeaders = new Headers(req.headers);
  if (tenantSlug) {
    requestHeaders.set("x-tenant-slug", tenantSlug);
  } else {
    requestHeaders.delete("x-tenant-slug");
  }

  // Gate /internal (existing behavior)
  if (pathname.startsWith("/internal")) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    if (!token) return redirectToLogin(req);
  }

  // NEW: Gate /admin pages (cookie presence only; tenant mismatch handled server-side)
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";
    if (!token) return redirectToLogin(req);
  }

  // Step 37L: a shop's own address with no path (TENANT.api.alex-io.com/)
  // shows that shop's page, the same as /t/TENANT. A rewrite, not a
  // redirect: the address bar keeps the short address, and anything after
  // "?" (e.g. ?sales_rep_slug=) rides along. Rep links (/q/REP) and every
  // other path are untouched; the core host keeps the Alex-IO home page.
  if (pathname === "/" && tenantSlug && tenantSlug !== "default" && /^[a-z0-9-]{1,63}$/.test(tenantSlug)) {
    const url = req.nextUrl.clone();
    url.pathname = `/t/${tenantSlug}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
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