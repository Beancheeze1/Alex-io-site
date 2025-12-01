// app/api/health/hubspot/route.ts
//
// HubSpot health (config-level check).
// Path A safe:
//  - NO outbound calls to HubSpot.
//  - Only inspects env vars to confirm OAuth/refresh is wired.
//
// Future: optional "deep" check that calls /api/hubspot/refresh.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requiredEnv = ["HUBSPOT_REFRESH_TOKEN"];
  const missing: string[] = [];

  for (const key of requiredEnv) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  const configured = missing.length === 0;

  return NextResponse.json(
    {
      ok: configured,
      status: configured ? "configured" : "missing_env",
      configured,
      missing_env: missing,
      detail: configured
        ? "Core HubSpot OAuth env vars are present."
        : "One or more required HubSpot env vars are missing.",
    },
    { status: configured ? 200 : 500 },
  );
}
