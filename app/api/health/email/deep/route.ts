// app/api/health/email/deep/route.ts
//
// Email (Microsoft Graph) deep health check.
// Path A / Straight Path safe:
//  - NEW FILE ONLY.
//  - Calls Microsoft identity platform token endpoint using client credentials.
//  - Confirms we can acquire an access token for Graph.
//  - Does NOT send any email or touch existing send paths.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();

  const tenantId = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    const latency_ms = Date.now() - started;
    return NextResponse.json(
      {
        ok: false,
        status: "missing_env",
        latency_ms,
        error: "missing_env",
        message:
          "One or more required Graph env vars (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET) are missing.",
      },
      { status: 500 },
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    tenantId,
  )}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const latency_ms = Date.now() - started;
    const json: any = await res.json().catch(() => null);

    if (res.ok && json && typeof json.access_token === "string") {
      return NextResponse.json(
        {
          ok: true,
          status: "ok",
          latency_ms,
          detail:
            "Successfully acquired Microsoft Graph access token using client credentials.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        status: "error",
        latency_ms,
        error: "token_failed",
        message:
          "Graph token endpoint did not return an access token. Check client credentials / scopes.",
        http_status: res.status,
      },
      { status: 500 },
    );
  } catch (err) {
    const latency_ms = Date.now() - started;
    console.error("GET /api/health/email/deep failed:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "exception",
        latency_ms,
        error: "exception",
        message:
          "Unexpected error while calling Microsoft Graph token endpoint.",
      },
      { status: 500 },
    );
  }
}
