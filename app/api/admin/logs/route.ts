// app/api/admin/logs/route.ts
//
// Admin logs API (read-only).
// Path A / Straight Path safe:
//  - NEW FILE ONLY.
//  - Attempts to read from an event_logs table.
//  - On any DB error (including table not existing), falls back to a
//    synthetic "backend not wired" log entry so the UI still works.
//
// Expected (optional) DB table shape:
//
//   create table event_logs (
//     id          serial primary key,
//     created_at  timestamptz not null default now(),
//     source      text,
//     level       text,          -- e.g. info, warn, error
//     event_type  text,          -- e.g. webhook, health, email
//     status_code integer,
//     message     text
//   );
//
// If this table isn't present yet, the fallback path will be used.

import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DbLogRow = {
  id: number;
  created_at: string;
  source: string | null;
  level: string | null;
  event_type: string | null;
  status_code: number | null;
  message: string | null;
};

type LogEntry = {
  id: number | string;
  created_at: string;
  level: string;
  source: string;
  summary: string;
  detail?: string;
};

export async function GET() {
  try {
    const rows = await q<DbLogRow>(`
      select
        id,
        created_at,
        source,
        level,
        event_type,
        status_code,
        message
      from event_logs
      order by created_at desc
      limit 50;
    `);

    const logs: LogEntry[] = rows.map((row) => {
      const level = (row.level || "info").toLowerCase();
      const source =
        row.source ||
        (row.event_type ? row.event_type.toUpperCase() : "SYSTEM");

      const statusSuffix =
        row.status_code != null ? ` [${row.status_code}]` : "";

      const summary =
        row.message && row.message.length > 120
          ? row.message.slice(0, 120) + "…"
          : row.message || "Log entry";

      return {
        id: row.id,
        created_at: row.created_at,
        level,
        source,
        summary: summary + statusSuffix,
        detail: row.message || undefined,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        logs,
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("GET /api/admin/logs failed – using fallback:", err);

    const nowIso = new Date().toISOString();
    const logs: LogEntry[] = [
      {
        id: "fallback-1",
        created_at: nowIso,
        level: "info",
        source: "SYSTEM",
        summary:
          "Logs backend not wired yet – event_logs table missing or query failed.",
        detail:
          "Once an event_logs table is in place, this endpoint will start returning real webhook/error events. Current error: " +
          String(err?.message ?? err),
      },
    ];

    return NextResponse.json(
      {
        ok: true,
        source: "fallback",
        logs,
      },
      { status: 200 },
    );
  }
}
