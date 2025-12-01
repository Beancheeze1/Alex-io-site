// app/admin/logs/page.tsx
//
// Logs & events admin landing page.
// Path A / Straight Path safe:
//  - Client-side fetch to /api/admin/logs (read-only).
//  - No writes, no changes to pricing, parsing, or layout/editor behavior.
//  - If the DB table doesn't exist yet, shows a synthetic "backend not wired"
//    log entry from the API.
//
// Route: /admin/logs

"use client";

import * as React from "react";
import Link from "next/link";

type LogEntry = {
  id: number | string;
  created_at: string;
  level: string;
  source: string;
  summary: string;
  detail?: string;
};

type LogsResponse = {
  ok: boolean;
  source: "db" | "fallback" | string;
  logs: LogEntry[];
};

export default function AdminLogsPage() {
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [source, setSource] = React.useState<string>("unknown");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | number | null>(
    null,
  );

  React.useEffect(() => {
    let active = true;

    async function loadLogs() {
      try {
        const res = await fetch("/api/admin/logs", { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json: LogsResponse = await res.json();
        if (!active) return;

        if (!json.ok) {
          throw new Error("Logs API returned ok=false.");
        }

        setLogs(json.logs || []);
        setSource(json.source || "unknown");
        setError(null);
      } catch (err) {
        console.error("Failed to load admin logs:", err);
        if (!active) return;
        setError("Unable to load logs.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadLogs();

    return () => {
      active = false;
    };
  }, []);

  const hasLogs = logs && logs.length > 0;
  const isFallback = source === "fallback";

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Logs &amp; events
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Central place to inspect webhook calls, errors, and other system
              diagnostics.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Summary / status */}
        <section className="mb-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
          {(loading || error) && (
            <>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Logs overview
              </div>
              {loading && (
                <p className="text-xs text-slate-300">
                  Loading logs from the backend…
                </p>
              )}
              {error && !loading && (
                <p className="text-xs text-rose-300">{error}</p>
              )}
            </>
          )}

          {!loading && !error && (
            <>
              <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Logs overview
              </div>
              <p className="text-xs text-slate-300">
                Showing{" "}
                <span className="font-semibold text-slate-100">
                  {hasLogs ? logs.length : 0}
                </span>{" "}
                event{hasLogs && logs.length !== 1 ? "s" : ""} from{" "}
                <span className="font-mono text-[11px] text-sky-300">
                  {source === "db" ? "event_logs (database)" : source}
                </span>
                .
              </p>
              {isFallback && (
                <p className="mt-2 text-[11px] text-amber-300">
                  Backend note: the{" "}
                  <span className="font-mono text-[11px] text-sky-300">
                    event_logs
                  </span>{" "}
                  table is not wired yet. The entry below is a synthetic
                  placeholder. Once the table exists, this view will switch to
                  real webhook/error events automatically.
                </p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Admin only – not visible to customers.
              </p>
            </>
          )}
        </section>

        {/* Logs table */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent events
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Read-only view of recent events: webhooks, errors, and system
                diagnostics. Click a row to expand full details.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Future: filters by level, source, and date range.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Level</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody>
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-xs text-slate-400"
                    >
                      Loading logs…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-xs text-rose-300"
                    >
                      Unable to load logs.
                    </td>
                  </tr>
                )}

                {!loading && !error && !hasLogs && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-xs text-slate-400"
                    >
                      No logs available.
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  hasLogs &&
                  logs.map((log) => {
                    const isExpanded = expandedId === log.id;
                    const dt = formatDateTime(log.created_at);
                    const levelChip = chipForLevel(log.level);

                    return (
                      <React.Fragment key={log.id}>
                        <tr
                          className="cursor-pointer border-t border-slate-800/60 hover:bg-slate-900/70"
                          onClick={() =>
                            setExpandedId(
                              isExpanded ? null : (log.id as string | number),
                            )
                          }
                        >
                          <td className="px-3 py-2 text-[11px] text-slate-400">
                            {dt}
                          </td>
                          <td className="px-3 py-2 text-[11px]">
                            <span className={levelChip.className}>
                              {levelChip.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {log.source}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-100">
                            {log.summary}
                          </td>
                        </tr>
                        {isExpanded && log.detail && (
                          <tr className="border-t border-slate-800/60 bg-slate-950/70">
                            <td
                              colSpan={4}
                              className="px-3 py-3 text-[11px] text-slate-300"
                            >
                              <div className="mb-1 font-semibold text-slate-200">
                                Details
                              </div>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-900/80 p-2 text-[11px] text-slate-200">
                                {log.detail}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function chipForLevel(levelRaw: string | null | undefined) {
  const level = (levelRaw || "info").toLowerCase();
  if (level === "error") {
    return {
      label: "ERROR",
      className:
        "inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300",
    };
  }
  if (level === "warn" || level === "warning") {
    return {
      label: "WARN",
      className:
        "inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-200",
    };
  }
  return {
    label: "INFO",
    className:
      "inline-flex items-center rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200",
  };
}
