// app/api/admin/logs/test/route.ts
//
// Tiny admin-only test endpoint to write a log entry into event_logs.
// URL: POST /api/admin/logs/test
//
// Path A safe:
//  - Uses safeLogEvent helper.
//  - No impact on pricing, quoting, or customer flows.

import { NextRequest, NextResponse } from "next/server";
import { safeLogEvent } from "../../../../lib/adminLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(
  code: string,
  extra: Record<string, any> = {},
  status = 500,
) {
  return NextResponse.json(
    { ok: false, error: code, ...extra },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) ?? {};
    const now = new Date().toISOString();

    const level = (body.level || "info").toString();
    const source = (body.source || "ADMIN").toString();
    const summary =
      body.summary ||
      `Test log from /api/admin/logs/test at ${now}`;
    const detail =
      body.detail ||
      JSON.stringify(
        {
          hint: "Created by /api/admin/logs/test",
          at: now,
        },
        null,
        2,
      );

    await safeLogEvent({
      level: level as any,
      source,
      summary,
      detail,
    });

    return ok({
      created_at: now,
      level,
      source,
      summary,
    });
  } catch (err: any) {
    console.error("admin logs test error:", err);
    return bad("admin_logs_test_exception", {
      message: String(err?.message || err),
    });
  }
}
