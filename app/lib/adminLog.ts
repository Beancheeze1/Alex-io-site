// app/lib/adminLog.ts
//
// Path A / Straight Path safe logging helper.
//
// - Writes to event_logs using the same q() DB helper as /api/admin/logs.
// - NEVER throws: errors are caught and only logged to console.
// - Minimal, generic shape so it can be used from webhook/orchestrate/Graph
//   without pulling in any quoting or pricing logic.

import { q } from "@/lib/db";

export type LogLevel = "info" | "warn" | "warning" | "error";

export type SafeLogEventInput = {
  level?: LogLevel | string | null;
  source?: string | null;
  summary: string;
  detail?: unknown;
};

function normalizeLevel(raw: LogLevel | string | null | undefined): string {
  const level = (raw || "info").toString().toLowerCase();
  if (level === "warning") return "warn";
  if (level !== "info" && level !== "warn" && level !== "error") {
    return "info";
  }
  return level;
}

function normalizeSource(raw: string | null | undefined): string {
  const src = (raw || "SYSTEM").toString();
  // Keep it short-ish so it fits nicely in the UI.
  return src.length > 64 ? src.slice(0, 64) : src;
}

function toDetailText(detail: unknown): string | null {
  if (detail == null) return null;

  if (typeof detail === "string") {
    return detail;
  }

  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    try {
      // Last resort: toString
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      return String(detail);
    } catch {
      return "Unserializable detail payload";
    }
  }
}

/**
 * Safe, non-throwing log writer.
 *
 * Usage:
 *   await safeLogEvent({
 *     level: "info",
 *     source: "hubspot.webhook",
 *     summary: "Received HubSpot webhook",
 *     detail: { headers, bodyPreview },
 *   });
 */
export async function safeLogEvent(input: SafeLogEventInput): Promise<void> {
  const level = normalizeLevel(input.level);
  const source = normalizeSource(input.source);
  const summary = input.summary || "";

  const detailText = toDetailText(input.detail);

  // Hard stop: don't log completely empty summaries.
  if (!summary.trim()) {
    return;
  }

  try {
    await q(
      `
      INSERT INTO event_logs (level, source, summary, detail)
      VALUES ($1, $2, $3, $4);
      `,
      [level, source, summary, detailText],
    );
  } catch (err) {
    // Never throw – logging is best-effort only.
    console.error("safeLogEvent failed (non-fatal):", err);
  }
}
