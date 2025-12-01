// app/api/health/db/route.ts
//
// Database health check (read-only).
// Path A / Straight Path safe:
//  - SELECT-only probe (no writes).
//  - Used by /admin System Health row + PowerShell curl.exe probes.

import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();

  try {
    await q("select 1 as ok");
    const latencyMs = Date.now() - started;

    return NextResponse.json(
      {
        ok: true,
        status: "up",
        latency_ms: latencyMs,
        detail: "Database connection OK; simple SELECT succeeded.",
      },
      { status: 200 },
    );
  } catch (err) {
    const latencyMs = Date.now() - started;
    console.error("GET /api/health/db failed:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "down",
        latency_ms: latencyMs,
        error: "db_unreachable",
        message: "Database health check failed.",
      },
      { status: 500 },
    );
  }
}
