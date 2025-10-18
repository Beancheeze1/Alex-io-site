// app/api/admin/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Admin index: intentionally lightweight.
 * - Confirms /api/admin is wired (no more 404).
 * - Lists helpful internal checks (only links/notes; does not call external APIs here).
 * - Keeps Path-A: no changes to your existing auth/webhook files.
 */
export async function GET() {
  const now = new Date().toISOString();

  // If you already have /api/admin/whoami or other endpoints, keep them.
  // We just present commonly-used checks so you can click/cURL quickly.
  const endpoints = [
    { path: "/api/health", purpose: "Liveness check (200 OK)" },
    { path: "/api/admin", purpose: "This index (route exists)" },
    { path: "/api/admin/ping", purpose: "Optional no-op (add later if desired)" },
    { path: "/api/admin/whoami", purpose: "HubSpot portal check (if present in your repo)" },
    { path: "/api/hubspot/webhook", purpose: "Webhook receiver (POST from HubSpot)" },
    { path: "/api/auth/hubspot", purpose: "Start OAuth (if already implemented)" },
    { path: "/api/auth/hubspot/callback", purpose: "OAuth redirect URI (if already implemented)" },
  ];

  return NextResponse.json(
    {
      ok: true,
      service: "alex-io-site",
      time: now,
      notes:
        "This is a minimal /api/admin index to prove the route is wired. It doesn’t modify your auth/webhook code.",
      endpoints,
    },
    { status: 200 }
  );
}
