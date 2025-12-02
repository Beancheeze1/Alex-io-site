// app/api/admin/logs/test/route.ts
//
// Test-only logging endpoint.
// URL: /api/admin/logs/test
//
// Path A safe:
//  - POST-only helper for creating a single event_logs row via safeLogEvent.
//  - Does NOT change any quoting, pricing, advisor, or layout logic.
//
// Usage:
//  - Send POST with optional JSON body:
//        { "summary": "...", "level": "info", "source": "whatever", "detail": {...} }
//  - If omitted, uses a default test payload.

import { NextRequest, NextResponse } from "next/server";
import { safeLogEvent } from "../../../../lib/adminLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

function bad(extra: Record<string, any> = {}, status = 400) {
  return NextResponse.json({ ok: false, ...extra }, { status });
}

export async function POST(req: NextRequest) {
  let body: any = null;

  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = await req.json();
    }
  } catch (err) {
    // If JSON parsing fails, we still fall back to defaults.
    console.warn("admin/logs/test: failed to parse JSON body, using defaults:", err);
  }

  const now = new Date().toISOString();

  const summary: string =
    (body?.summary && String(body.summary)) ||
    "Test log from /api/admin/logs/test";

  if (!summary.trim()) {
    return bad({ error: "summary is required" }, 400);
  }

  const level: string = (body?.level && String(body.level)) || "info";
  const source: string =
    (body?.source && String(body.source)) || "admin.logs.test";

  const detail =
    body?.detail ??
    {
      note: "This is a test log entry created via /api/admin/logs/test.",
      createdAt: now,
    };

  await safeLogEvent({
    level,
    source,
    summary,
    detail,
  });

  return ok({
    source: "admin.logs.test",
    summary,
    level,
    createdAt: now,
  });
}

// Optional: reject GET explicitly so it’s clear how to use this endpoint.
export async function GET() {
  return bad(
    {
      error: "Use POST to create a test log entry.",
      hint: "Send a POST with JSON body: { summary, level, source, detail }",
    },
    405,
  );
}
