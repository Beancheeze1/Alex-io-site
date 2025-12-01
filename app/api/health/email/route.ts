// app/api/health/email/route.ts
//
// Email (Microsoft Graph) health (config-level).
// Path A safe:
//  - NO outbound Graph calls.
//  - Only inspects env vars to confirm send path is wired.
//
// Future: deep check that exercises the token + send mail flow.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requiredEnv = [
    "MS_TENANT_ID",
    "MS_CLIENT_ID",
    "MS_CLIENT_SECRET",
    "MS_MAILBOX_FROM",
  ];
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
        ? "Core Microsoft Graph env vars are present."
        : "One or more required email/Graph env vars are missing.",
    },
    { status: configured ? 200 : 500 },
  );
}
