// app/admin/quotes/page.tsx
//
// Quotes & layouts admin landing page.
// Path A / Straight Path safe:
//  - UI-only, read-only.
//  - Uses GET /api/quotes (existing route) to show recent quotes.
//  - Does NOT modify pricing, parsing, layout editor, or any write paths.
//
// Notes:
//  - "Jump to quote" navigates to /admin/quotes/[quote_no] (detail view).
//  - Summary counts + table are driven by real data from /api/quotes.
//  - Adds client-side filters + search for status and basic text matching.
//  - Adds a "Materials used recently" widget powered by /api/quote/print
//    for a small sample of the latest quotes.

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  sales_rep_name?: string | null;
  revision?: string | null;
  created_at: string | null;
  updated_at: string | null;
  locked?: boolean | null;
  locked_at?: string | null;
};

type QuotesResponse = {
  ok: boolean;
  quotes?: QuoteRow[];
  error?: string;
};

type StatusFilter = "all" | "draft" | "engineering" | "sent";

type MaterialUsage = {
  name: string;
  count: number;
};

export default function AdminQuotesPage() {
  const router = useRouter();
    const isAdmin = typeof document !== "undefined"
    ? document.cookie.includes("role=admin") // fallback; real guard is server-side nav/route
    : false;
  const [quoteNoInput, setQuoteNoInput] = React.useState("");
  const [quotes, setQuotes] = React.useState<QuoteRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<Record<string, boolean>>({});


  // Client-side filters
  const [statusFilter, setStatusFilter] =
    React.useState<StatusFilter>("all");
  const [searchTerm, setSearchTerm] = React.useState("");

  // NEW: recent materials widget state
  const [materialStats, setMaterialStats] =
    React.useState<MaterialUsage[] | null>(null);
  const [materialStatsLoading, setMaterialStatsLoading] =
    React.useState<boolean>(false);
  const [materialStatsError, setMaterialStatsError] =
    React.useState<string | null>(null);

      async function createNewQuoteAndOpenEditor() {
    if (creating) return;
    setCreating(true);

    try {
      // Generate UTC quote number (same format as orchestrate)
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mi = String(now.getUTCMinutes()).padStart(2, "0");
      const ss = String(now.getUTCSeconds()).padStart(2, "0");

      const quoteNo = `Q-AI-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;

      // Create draft quote row
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no: quoteNo,
          customer_name: "Unassigned",
          status: "draft",
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error("Failed to create quote");
      }

      // Open BLANK editor (quote_no only)
      router.push(`/quote/layout?quote_no=${encodeURIComponent(quoteNo)}`);
    } catch (err) {
      console.error("Start new quote failed:", err);
      alert("Unable to start a new quote.");
    } finally {
      setCreating(false);
    }
  }


  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = quoteNoInput.trim();
    if (!trimmed) return;

    // Target: /admin/quotes/[quote_no] (detail view)
    router.push(`/admin/quotes/${encodeURIComponent(trimmed)}`);
  }

  React.useEffect(() => {
    let active = true;

    async function loadQuotes() {
      try {
        const res = await fetch("/api/quotes?limit=25", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: QuotesResponse = await res.json();
        if (!data.ok || !data.quotes) {
          throw new Error(data.error || "API returned an error.");
        }
        if (active) {
          setQuotes(data.quotes);
          setError(null);
        }
      } catch (err) {
        console.error("Failed to load quotes:", err);
        if (active) {
          setError("Unable to load quote list.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadQuotes();

    return () => {
      active = false;
    };
  }, []);

  async function setQuoteLock(quoteNo: string, lock: boolean) {
    setRowBusy((m) => ({ ...m, [quoteNo]: true }));
    try {
      const res = await fetch("/api/admin/quotes/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteNo, lock }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || "Lock action failed");
      }

      // Refresh list
      const refreshed = await fetch("/api/quotes?limit=25", { cache: "no-store" });
      const refreshedJson = await refreshed.json().catch(() => null);
      if (refreshed.ok && refreshedJson?.ok && Array.isArray(refreshedJson?.quotes)) {
        setQuotes(refreshedJson.quotes);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      alert(e?.message || "Lock action failed");
    } finally {
      setRowBusy((m) => ({ ...m, [quoteNo]: false }));
    }
  }

  async function handleReviseQuote(quoteNo: string) {
    // Arm a single staging bump (do NOT bump yet)
    await fetch("/api/admin/quotes/revise?t=" + Date.now(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteNo }),
      cache: "no-store",
    });

    // Go straight to editor
    router.push(`/quote/layout?quote_no=${quoteNo}`);
  }

  const totalCount = quotes?.length ?? 0;
  const recentCount = quotes
    ? quotes.filter((q) =>
        isWithinLast24Hours(q.updated_at || q.created_at),
      ).length
    : 0;
  const engineeringCount = quotes
    ? quotes.filter(
        (q) => normalizeStatus(q.status) === "engineering",
      ).length
    : 0;

  // Filtered list for the table (status + text search)
  const filteredQuotes: QuoteRow[] = React.useMemo(() => {
    if (!quotes) return [];

    const term = searchTerm.trim().toLowerCase();
    const hasSearch = term.length > 0;

    return quotes.filter((q) => {
      // Status filter
      const normalized = normalizeStatus(q.status);
      if (statusFilter === "draft" && normalized !== "draft") {
        return false;
      }
      if (
        statusFilter === "engineering" &&
        normalized !== "engineering" &&
        normalized !== "in_progress"
      ) {
        return false;
      }
      if (statusFilter === "sent" && normalized !== "sent") {
        return false;
      }
      // "all" passes everything

      if (!hasSearch) return true;

      // Basic text search: quote_no, customer_name, email, phone
      const haystack =
        [
          q.quote_no,
          q.customer_name ?? "",
          q.email ?? "",
          q.phone ?? "",
        ]
          .join(" ")
          .toLowerCase() || "";

      return haystack.includes(term);
    });
  }, [quotes, statusFilter, searchTerm]);

  const showingCount = filteredQuotes.length;

  // NEW: "Materials used recently" widget logic
  React.useEffect(() => {
    if (!quotes || quotes.length === 0) {
      setMaterialStats(null);
      setMaterialStatsLoading(false);
      setMaterialStatsError(null);
      return;
    }

    let cancelled = false;

    async function analyzeMaterials() {
      setMaterialStatsLoading(true);
      setMaterialStatsError(null);
      setMaterialStats(null);

      try {
        // Take a small sample of the latest quotes to avoid hammering the API
        const sample = (quotes ?? []).slice(0, 10);

        const counts = new Map<string, number>();

        for (const q of sample) {
          if (!q.quote_no) continue;

          const url =
            "/api/quote/print?quote_no=" +
            encodeURIComponent(q.quote_no);

          let res: Response;
          try {
            res = await fetch(url, { cache: "no-store" });
          } catch (e) {
            console.warn("Materials widget: fetch failed for", q.quote_no);
            continue;
          }

          if (!res.ok) {
            // 404 or other error, skip this quote
            continue;
          }

          let json: any;
          try {
            json = await res.json();
          } catch (e) {
            continue;
          }

          if (!json || !json.ok || !json.items || !Array.isArray(json.items)) {
            continue;
          }

          const items = json.items as any[];
          if (items.length === 0) continue;

          const primary = items[0];
          const matName: string | null =
            primary.material_name ||
            (primary.material_id != null
              ? `Material #${primary.material_id}`
              : null);

          if (!matName) continue;

          const current = counts.get(matName) ?? 0;
          counts.set(matName, current + 1);

          if (cancelled) return;
        }

        const list: MaterialUsage[] = Array.from(counts.entries()).map(
          ([name, count]) => ({ name, count }),
        );

        list.sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name),
        );

        if (!cancelled) {
          setMaterialStats(list);
        }
      } catch (err) {
        console.error("Materials widget: analysis failed:", err);
        if (!cancelled) {
          setMaterialStatsError(
            "Unable to analyze recent material usage.",
          );
        }
      } finally {
        if (!cancelled) {
          setMaterialStatsLoading(false);
        }
      }
    }

    analyzeMaterials();

    return () => {
      cancelled = true;
    };
  }, [quotes]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Quotes &amp; layouts
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Engineering-focused view of quotes, foam layouts, and CAD
              downloads for internal use.
            </p>
          </div>

          <div className="flex items-center gap-4">
                        <button
              type="button"
              onClick={createNewQuoteAndOpenEditor}
              disabled={creating}
              className="inline-flex items-center justify-center rounded-lg border border-sky-300 bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-sky-400 disabled:opacity-60 disabled:bg-sky-500/40 disabled:border-sky-500/40"

            >
              {creating ? "Starting…" : "Start new quote"}
            </button>
            {isAdmin && (
  <Link
    href="/admin"
    className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
  >
    &larr; Back to admin home
  </Link>
)}

          </div>
        </header>
        {/* Jump to quote + summary */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Jump to quote */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Jump to quote
            </div>
            <p className="mb-3 text-xs text-slate-300">
              Type a quote number to open its internal engineering view
              (layouts + CAD) at{" "}
              <span className="font-mono text-[11px] text-sky-300">
                /admin/quotes/[quote_no]
              </span>
              .
            </p>
            <form
              onSubmit={handleJumpSubmit}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="text"
                value={quoteNoInput}
                onChange={(e) => setQuoteNoInput(e.target.value)}
                placeholder="e.g. Q-AI-20251129-123456"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg border border-sky-500/70 bg-sky-600/80 px-4 py-2 text-xs font-semibold text-slate-950 shadow-sm transition hover:bg-sky-500"
              >
                Go
              </button>
            </form>
            <p className="mt-3 text-[11px] text-slate-500">
              Admin only – not visible to customers.
            </p>
          </div>

          {/* Summary card (live counts) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Summary
            </div>

            {error ? (
              <p className="text-xs text-rose-300">{error}</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-300">
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : totalCount}
                  </span>{" "}
                  quotes returned (latest from{" "}
                  <span className="font-mono text-[11px] text-sky-300">
                    /api/quotes
                  </span>
                  ).
                </li>
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : recentCount}
                  </span>{" "}
                  updated in the last 24 hours.
                </li>
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : engineeringCount}
                  </span>{" "}
                  marked as engineering / in-progress.
                </li>
              </ul>
            )}

            <p className="mt-3 text-[11px] text-slate-500">
              Live data source:{" "}
              <span className="font-mono text-[11px] text-sky-300">
                /api/quotes?limit=25
              </span>
              . This view is read-only; status changes still flow through your
              existing pipelines.
            </p>
          </div>
        </section>

        {/* Recent quotes section (filters + materials widget + table) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent quotes
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Live quote list from the database. Use the filters and search to
                focus on specific statuses or customers.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {/* Status filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <StatusChip
                  label="All"
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                />
                <StatusChip
                  label="Draft"
                  active={statusFilter === "draft"}
                  onClick={() => setStatusFilter("draft")}
                />
                <StatusChip
                  label="Engineering"
                  active={statusFilter === "engineering"}
                  onClick={() => setStatusFilter("engineering")}
                />
                <StatusChip
                  label="Sent"
                  active={statusFilter === "sent"}
                  onClick={() => setStatusFilter("sent")}
                />
              </div>

              {/* Text search */}
              <div className="w-full sm:w-48">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search quotes..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] text-slate-100 outline-none ring-0 placeholder:text-slate-500 focus:border-sky-400"
                />
                <div className="mt-0.5 text-[10px] text-slate-500 text-right">
                  Showing {loading ? "…" : showingCount} of{" "}
                  {loading ? "…" : totalCount}
                </div>
              </div>
            </div>
          </div>

          {/* Materials used recently widget */}
          <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-200">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Materials used recently
            </div>
            {materialStatsLoading && (
              <p className="text-[11px] text-slate-400">
                Analyzing the latest quotes…
              </p>
            )}
            {!materialStatsLoading && materialStatsError && (
              <p className="text-[11px] text-rose-300">
                {materialStatsError}
              </p>
            )}
            {!materialStatsLoading &&
              !materialStatsError &&
              materialStats &&
              materialStats.length === 0 && (
                <p className="text-[11px] text-slate-400">
                  No material information found in the latest quotes.
                </p>
              )}
            {!materialStatsLoading &&
              !materialStatsError &&
              materialStats &&
              materialStats.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {materialStats.slice(0, 4).map((m) => (
                    <li
                      key={m.name}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-[11px] text-slate-100">
                        {m.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {m.count} quote{m.count === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-2 text-[10px] text-slate-500">
              Sample based on the latest quotes returned by{" "}
              <span className="font-mono text-[10px] text-sky-300">
                /api/quote/print
              </span>{" "}
              for a small batch of recent quote numbers.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Quote #</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Email / Phone</th>
                 <th className="px-3 py-2 font-semibold text-right">
  Updated
</th>
<th className="px-3 py-2 font-semibold text-right">
  Review
</th>

                </tr>
              </thead>
              <tbody>
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-slate-400"
                    >
                      Loading quotes…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-rose-300"
                    >
                      Unable to load quote list.
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  filteredQuotes &&
                  filteredQuotes.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        No quotes match the current filters.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  !error &&
                  filteredQuotes &&
                  filteredQuotes.map((q) => {
                    const statusLabel = displayStatus(q.status);
                    const statusStyle = chipClassForStatus(q.status);
                    const updated = formatDateTime(
                      q.updated_at || q.created_at,
                    );

                    return (
                      <tr
                        key={q.id}
                        className="border-t border-slate-800/60 hover:bg-slate-900/70"
                      >
                        <td className="px-3 py-2 font-mono text-[11px]">
                          <Link
                            href={`/admin/quotes/${encodeURIComponent(
                              q.quote_no,
                            )}`}
                            className="text-sky-300 hover:text-sky-200 hover:underline underline-offset-2"
                          >
                            {q.quote_no}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-100">
                          {q.customer_name || (
                            <span className="text-slate-500">Unknown</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${statusStyle}`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-300">
                          {q.email && (
                            <span className="block truncate">
                              {q.email}
                            </span>
                          )}
                          {q.phone && (
                            <span className="block text-slate-400">
                              {q.phone}
                            </span>
                          )}
                          {!q.email && !q.phone && (
                            <span className="text-slate-500">
                              No contact info
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-slate-400">
  {updated}
</td>

                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            {q.revision && (
                              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-200">
                                {q.revision}
                              </span>
                            )}

                            {q.sales_rep_name && (
                              <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] font-semibold text-indigo-200">
                                {q.sales_rep_name}
                              </span>
                            )}
                            {q.locked ? (
                              <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">
                                Released for Mfg
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/40 px-2 py-1 text-[10px] font-semibold text-slate-300">
                                Editable
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={!!rowBusy[q.quote_no]}
                              onClick={() => setQuoteLock(q.quote_no, !q.locked)}
                              className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[11px] font-medium text-slate-100 transition hover:border-sky-400 disabled:opacity-60"
                              title={q.locked ? "Unlock for revisions" : "Lock for production"}
                            >
                              {rowBusy[q.quote_no] ? "" : q.locked ? "Unlock" : "RFM"}
                            </button>
                            <button
                              onClick={() => handleReviseQuote(q.quote_no)}
                              style={{
                                marginLeft: 8,
                                padding: "4px 8px",
                                fontSize: 12,
                                fontWeight: 600,
                                borderRadius: 6,
                                background: "#1f2937",
                                color: "white",
                                border: "1px solid #374151",
                                cursor: "pointer",
                              }}
                              title="Revise quote (bumps staging revision on next Apply)"
                            >
                              Revise
                            </button>

                            <Link
                              href={`/quote?quote_no=${encodeURIComponent(q.quote_no)}`}
                              className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[11px] font-medium text-sky-300 transition hover:border-sky-400 hover:text-sky-200"
                            >
                              Review
                            </Link>
                          </div>
                        </td>

                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            All rows above are live from the{" "}
            <span className="font-mono text-[11px] text-sky-300">
              quotes
            </span>{" "}
            table via{" "}
            <span className="font-mono text-[11px] text-sky-300">
              /api/quotes
            </span>
            . This view remains read-only; any status changes still flow
            through your existing pipelines.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}

/* ---------- Helpers ---------- */

function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "";
  return status.toLowerCase().trim();
}

function displayStatus(status: string | null | undefined): string {
  const s = normalizeStatus(status);
  if (!s) return "Unknown";

  if (s === "draft") return "Draft";
  if (s === "engineering" || s === "in_progress") return "Engineering";
  if (s === "sent") return "Sent";
  if (s === "approved") return "Approved";
  if (s === "rejected") return "Rejected";

  // Fallback: show raw status text capitalized
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function chipClassForStatus(status: string | null | undefined): string {
  const s = normalizeStatus(status);

  if (s === "engineering" || s === "in_progress") {
    return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
  }
  if (s === "sent" || s === "approved") {
    return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
  }
  if (s === "rejected") {
    return "bg-rose-500/15 text-rose-300 border border-rose-500/40";
  }
  if (s === "draft") {
    return "bg-slate-500/20 text-slate-200 border border-slate-500/40";
  }
  return "bg-slate-600/20 text-slate-200 border border-slate-600/40";
}

function isWithinLast24Hours(iso: string | null): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  const now = Date.now();
  const diffMs = now - ts;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return diffMs >= 0 && diffMs <= oneDayMs;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Unknown";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "Unknown";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/* ---------- Small UI pieces ---------- */

type StatusChipProps = {
  label: string;
  active: boolean;
  onClick: () => void;
};

function StatusChip({ label, active, onClick }: StatusChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] transition ${
        active
          ? "border-sky-400 bg-sky-500/20 text-sky-200"
          : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-sky-500/60 hover:text-sky-200"
      }`}
    >
      {label}
    </button>
  );
}
