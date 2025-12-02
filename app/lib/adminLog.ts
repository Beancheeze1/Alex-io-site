// app/lib/adminLog.ts
//
// Small helper for writing to event_logs in a Path A safe way.
// - Swallows its own errors (logging must never break main flows).
// - Intended for use by admin-only / diagnostic routes and internal
//   server-side code (webhooks, orchestrator, Graph send, etc.).
//
// Usage (server-side only):
//   await safeLogEvent({ level: "info", source: "WEBHOOK", summary: "..." });

import { q } from "@/lib/db";

export type LogLevel = "info" | "warn" | "error";

export type LogSource =
  | "SYSTEM"
  | "WEBHOOK"
  | "ORCHESTRATE"
  | "GRAPH"
  | "ADMIN"
  | string;

type LogOptions = {
  level?: LogLevel;
  source?: LogSource;
  summary: string;
  detail?: string | null;
};

/**
 * Path A safe logger:
 *  - No throws (ever).
 *  - Best effort insert into event_logs.
 */
export async function safeLogEvent(opts: LogOptions): Promise<void> {
  const { summary } = opts;
  if (!summary || !summary.trim()) {
    // Nothing to log; silently ignore.
    return;
  }

  const level: LogLevel = (opts.level || "info") as LogLevel;
  const source: string = (opts.source || "SYSTEM").toString();
  const detail: string | null =
    opts.detail != null ? String(opts.detail) : null;

  try {
    await q(
      `
      INSERT INTO event_logs (level, source, summary, detail)
      VALUES ($1, $2, $3, $4);
      `,
      [level, source, summary.trim(), detail],
    );
  } catch (err: any) {
    // Logging must never break the main flow.
    console.error("safeLogEvent insert failed (ignored):", err);
  }
}
