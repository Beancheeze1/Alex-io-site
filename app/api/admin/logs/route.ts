// app/api/admin/logs/route.ts
//
// Logs & events admin API.
// URL: /api/admin/logs
//
// Path A safe:
//  - Read-only SELECT from event_logs.
//  - On error / missing table, returns the same-style synthetic fallback
//    entry your admin/logs page already understands.
//
// Does NOT change any quoting, pricing, or advisor logic.

import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EventLogRow = {
  id: number;
  created_at: string;
  level: string | null;
  source: string | null;
  summary: string | null;
  detail: string | null;
};

function ok(extra: Record<string, any> = {}, status = 200) {
  return NextResponse.json({ ok: true, ...extra }, { status });
}

export async function GET(_req: NextRequest) {
  try {
    const rows = await q<EventLogRow>(
      `
      SELECT
        id,
        created_at,
        level,
        source,
        summary,
        detail
      FROM event_logs
      ORDER BY created_at DESC, id DESC
      LIMIT 50;
      `,
      [],
    );

    const logs = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      level: (r.level || "info").toLowerCase(),
      source: r.source || "SYSTEM",
      summary: r.summary || "",
      detail: r.detail || "",
    }));

    return ok({
      source: "db",
      logs,
    });
  } catch (err: any) {
    console.error("admin logs GET error, using fallback:", err);

    // Preserve the existing "fallback" behavior so the UI keeps working
    // even if the table isn't ready yet.
    const now = new Date().toISOString();

    return ok({
      source: "fallback",
      logs: [
        {
          id: "fallback-1",
          created_at: now,
          level: "info",
          source: "SYSTEM",
          summary:
            "event_logs table not found or not ready yet. Once created, this view will show real webhook / error events.",
          detail: String(err?.message || err),
        },
      ],
    });
  }
}
