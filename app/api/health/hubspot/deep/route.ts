// app/api/health/hubspot/deep/route.ts
//
// HubSpot deep health check.
// Path A / Straight Path safe:
//  - NEW FILE ONLY.
//  - Calls existing /api/hubspot/refresh to verify OAuth refresh works.
//  - No changes to parsing, pricing, or layout behavior.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  try {
    const res = await fetch(
      `${base}/api/hubspot/refresh?t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const latency_ms = Date.now() - started;
    const json: any = await res.json().catch(() => null);

    // Expect /api/hubspot/refresh to return { ok: true, ... } on success.
    if (res.ok && json && json.ok) {
      return NextResponse.json(
        {
          ok: true,
          status: "ok",
          latency_ms,
          detail: "HubSpot refresh succeeded; OAuth token path is healthy.",
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        status: "error",
        latency_ms,
        error: "refresh_failed",
        message:
          "HubSpot refresh endpoint did not return ok. Check logs for details.",
        http_status: res.status,
      },
      { status: 500 },
    );
  } catch (err) {
    const latency_ms = Date.now() - started;
    console.error("GET /api/health/hubspot/deep failed:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "exception",
        latency_ms,
        error: "exception",
        message:
          "Unexpected error while calling HubSpot refresh for deep health check.",
      },
      { status: 500 },
    );
  }
}
