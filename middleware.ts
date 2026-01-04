// middleware.ts
//
// Minimal auth gate for internal-only routes (Path A).
// NOTE: Middleware runs on Edge; do NOT import Node crypto auth helpers here.
// We only check presence of the session cookie and redirect to /login.
// Real auth + role enforcement remains server-side in pages/APIs.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "alexio_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only gate /internal/* in this first slice.
  if (!pathname.startsWith("/internal")) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value || "";

  // If no cookie, redirect to login with ?next=
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/internal/:path*"],
};
