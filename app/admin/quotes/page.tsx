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
//  - "Your sales link" + "Your commission" (below) are the logged-in
//    user's own data from /api/my-quotes + /api/my-quotes/payouts --
//    this used to live on a separate /my-quotes page, folded in here so
//    reps have one page instead of two nearly-identical ones.

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RepStartQuoteModal from "@/components/start-quote/RepStartQuoteModal";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string | null;
  customer_id?: number | null;
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

type FilterKey = "all" | "sent" | "rfm" | `sales:${string}`;

type MaterialUsage = {
  name: string;
  count: number;
};

type MyCommission = {
  pct: number | null;
  quotes_total_usd: number;
  commission_usd: number;
  quote_count: number;
};

type PayoutRow = {
  id: number; period: string; quotes_total_usd: string; commission_pct: string;
  commission_usd: string; quote_count: number; paid_at: string | null; created_at: string;
};

type ExpenseRow = {
  id: number; expense_type: string; miles: string | null; amount_usd: string;
  notes: string | null; created_at: string;
};

const EXPENSE_TYPES = ["mileage", "meals", "supplies", "other"] as const;
function expenseTypeLabel(t: string) {
  switch (t) {
    case "mileage": return "Mileage";
    case "meals": return "Meals";
    case "supplies": return "Supplies";
    case "other": return "Other";
    default: return t;
  }
}

function fmtUsd(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

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
  const [showStartModal, setShowStartModal] = React.useState(false);

  // "Your sales link" + "Your commission" -- the logged-in user's own data,
  // formerly on a separate /my-quotes page.
  const [mySalesSlug, setMySalesSlug] = React.useState<string | null>(null);
  const [myCommission, setMyCommission] = React.useState<MyCommission | null>(null);
  const [myPayouts, setMyPayouts] = React.useState<PayoutRow[]>([]);
  const [myPayoutsLoading, setMyPayoutsLoading] = React.useState(true);
  const [showMyPayouts, setShowMyPayouts] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);

  // Expense tracker -- own expenses only, mileage auto-calculated from the
  // tenant-wide rate set in the main admin area (Users & Roles card).
  const [expenses, setExpenses] = React.useState<ExpenseRow[]>([]);
  const [expensesLoading, setExpensesLoading] = React.useState(true);
  const [mileageRate, setMileageRate] = React.useState<number>(0.67);
  const [expenseType, setExpenseType] = React.useState<string>("mileage");
  const [expenseMiles, setExpenseMiles] = React.useState("");
  const [expenseAmount, setExpenseAmount] = React.useState("");
  const [expenseNotes, setExpenseNotes] = React.useState("");
  const [expenseSubmitting, setExpenseSubmitting] = React.useState(false);
  const [expenseError, setExpenseError] = React.useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = React.useState<number | null>(null);

  const loadExpenses = React.useCallback(async () => {
    try {
      const res = await fetch("/api/my-expenses?limit=100", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) setExpenses(json.expenses || []);
    } catch { /* silent */ }
    finally { setExpensesLoading(false); }
  }, []);

  React.useEffect(() => {
    let active = true;
    loadExpenses();
    (async () => {
      try {
        const res = await fetch("/api/admin/mileage-rate", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (active && json?.ok && typeof json.mileage_rate_usd === "number") {
          setMileageRate(json.mileage_rate_usd);
        }
      } catch { /* silent -- form falls back to the default rate */ }
    })();
    return () => { active = false; };
  }, [loadExpenses]);

  const expenseMilesCalc = Number(expenseMiles);
  const expenseMileageCalcUsd =
    expenseType === "mileage" && Number.isFinite(expenseMilesCalc) && expenseMilesCalc > 0
      ? Math.round(expenseMilesCalc * mileageRate * 100) / 100
      : null;

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setExpenseError(null);

    const body: any = { expense_type: expenseType, notes: expenseNotes.trim() || undefined };
    if (expenseType === "mileage") {
      body.miles = Number(expenseMiles);
    } else {
      body.amount_usd = Number(expenseAmount);
    }

    setExpenseSubmitting(true);
    try {
      const res = await fetch("/api/my-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || "Failed to add expense.");
      }
      setExpenseMiles("");
      setExpenseAmount("");
      setExpenseNotes("");
      await loadExpenses();
    } catch (err: any) {
      setExpenseError(err?.message || "Failed to add expense.");
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function deleteExpense(id: number) {
    setDeletingExpenseId(id);
    try {
      const res = await fetch(`/api/my-expenses?id=${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Delete failed");
      setExpenses((prev) => prev.filter((x) => x.id !== id));
    } catch (err: any) {
      setExpenseError(err?.message || "Failed to delete expense.");
    } finally {
      setDeletingExpenseId(null);
    }
  }

  const expensesTotal = expenses.reduce((s, e) => s + Number(e.amount_usd), 0);

  React.useEffect(() => {
    let active = true;

    async function loadMine() {
      try {
        const res = await fetch("/api/my-quotes?limit=1", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (active && json?.ok) {
          setMySalesSlug(json.sales_slug ?? null);
          setMyCommission(json.commission ?? null);
        }
      } catch { /* silent -- this section is supplemental, not the main page */ }

      try {
        const res = await fetch("/api/my-quotes/payouts", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (active && json?.ok) setMyPayouts(json.payouts || []);
      } catch { /* silent */ }
      finally { if (active) setMyPayoutsLoading(false); }
    }

    loadMine();
    return () => { active = false; };
  }, []);

  const mySalesLink =
    mySalesSlug && typeof window !== "undefined"
      ? `${window.location.origin}/q/${encodeURIComponent(mySalesSlug)}`
      : null;

  async function copyMySalesLink() {
    if (!mySalesLink) return;
    try {
      await navigator.clipboard.writeText(mySalesLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; fail silently (no regressions)
    }
  }

  const myUnpaidPayouts = myPayouts.filter((p) => !p.paid_at);
  const myUnpaidTotal = myUnpaidPayouts.reduce((s, p) => s + Number(p.commission_usd), 0);

  // Internal notes — expandable per row, lazy-loaded from the existing
  // staff-only /api/admin/quotes/internal-notes route (same one the detail
  // page already uses) so this list never has to carry internal_notes text
  // for all 200 rows up front.
  const [expandedNotes, setExpandedNotes] = React.useState<Record<string, boolean>>({});
  const [notesByQuote, setNotesByQuote] = React.useState<Record<string, string | null>>({});
  const [notesLoading, setNotesLoading] = React.useState<Record<string, boolean>>({});
  const [notesError, setNotesError] = React.useState<Record<string, string | null>>({});

  const toggleNotes = React.useCallback(async (quoteNo: string) => {
    setExpandedNotes((prev) => ({ ...prev, [quoteNo]: !prev[quoteNo] }));

    // Already loaded (or in flight) — nothing more to do.
    if (quoteNo in notesByQuote || notesLoading[quoteNo]) return;

    setNotesLoading((prev) => ({ ...prev, [quoteNo]: true }));
    setNotesError((prev) => ({ ...prev, [quoteNo]: null }));

    try {
      const res = await fetch(
        `/api/admin/quotes/internal-notes?quote_no=${encodeURIComponent(quoteNo)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setNotesError((prev) => ({ ...prev, [quoteNo]: "Unable to load internal notes." }));
        return;
      }
      setNotesByQuote((prev) => ({ ...prev, [quoteNo]: json.internal_notes ?? null }));
    } catch {
      setNotesError((prev) => ({ ...prev, [quoteNo]: "Unable to load internal notes." }));
    } finally {
      setNotesLoading((prev) => ({ ...prev, [quoteNo]: false }));
    }
  }, [notesByQuote, notesLoading]);


  // Client-side filters
  const [filterKey, setFilterKey] = React.useState<FilterKey>("all");
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
        const res = await fetch("/api/quotes?limit=200", {
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
      const refreshed = await fetch("/api/quotes?limit=200", { cache: "no-store" });
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

  async function handleReviseQuote(quoteNo: string, isLocked: boolean) {
    // If Released for Mfg, Revise should unlock + open editor. Every Apply now
    // bumps its own staging revision unconditionally, so there's nothing to arm.
    if (isLocked) {
      await setQuoteLock(quoteNo, false);
    }

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

  // NEW: derive unique salesperson pills from live rows (q.sales_rep_name)
  const salesPills = React.useMemo(() => {
    const set = new Set<string>();
    (quotes ?? []).forEach((q) => {
      const v = (q.sales_rep_name || "").trim();
      if (v) set.add(v);
    });
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [quotes]);

  // Filtered list for the table (status + text search)
  const filteredQuotes: QuoteRow[] = React.useMemo(() => {
    if (!quotes) return [];

    const term = searchTerm.trim().toLowerCase();
    const hasSearch = term.length > 0;

    return quotes.filter((q) => {
      // Filter pills
      if (filterKey === "sent") {
        const s = normalizeStatus(q.status);
        if (s !== "sent") return false;
      } else if (filterKey === "rfm") {
        if (!q.locked) return false;
      } else if (filterKey.startsWith("sales:")) {
        const want = filterKey.slice("sales:".length).trim();
        const have = (q.sales_rep_name || "").trim();
        if (!want || have !== want) return false;
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
  }, [quotes, filterKey, searchTerm]);

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
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Quotes &amp; layouts
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Engineering-focused view of quotes, foam layouts, and CAD
              downloads for internal use.
            </p>
          </div>

          <div className="flex items-center gap-4">
                        <button
              type="button"
              onClick={() => setShowStartModal(true)}
              disabled={creating}
              className="inline-flex items-center justify-center rounded-md bg-[var(--action-primary)] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:opacity-60"

            >
              Start new quote
            </button>
            <button
              type="button"
              onClick={createNewQuoteAndOpenEditor}
              disabled={creating}
              className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition hover:bg-[var(--surface-subtle)] disabled:opacity-60"
            >
              {creating ? "Starting…" : "Skip to blank editor"}
            </button>
            {isAdmin && (
  <Link
    href="/admin"
    className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
  >
    &larr; Back to admin home
  </Link>
)}

          </div>
        </header>

        {/* Your sales link */}
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
          <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Your sales link
          </div>
          {mySalesLink ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]">
                {mySalesLink}
              </code>
              <button
                type="button"
                onClick={copyMySalesLink}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border-strong)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
              >
                {linkCopied ? "Copied!" : "Copy link"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-faint)]">
              You don&apos;t have a sales link set up yet. Ask an admin to assign you one from the Users page.
            </p>
          )}
          <p className="mt-2 text-[11px] text-[var(--text-faint)]">
            Share this link with prospects. Quotes started from it are automatically credited to your seat.
          </p>
        </section>

        {/* Your commission */}
        {myCommission && myCommission.pct != null && (
          <section className="mb-6 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-5 py-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">Your commission</p>
              {myPayouts.length > 0 && (
                <button onClick={() => setShowMyPayouts((v) => !v)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                  {showMyPayouts ? "Hide history" : "View payout history"}
                  {myUnpaidPayouts.length > 0 && !showMyPayouts && (
                    <span className="ml-1.5 rounded-full bg-[var(--status-pending-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-pending-text)]">
                      {myUnpaidPayouts.length} unpaid
                    </span>
                  )}
                </button>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">Rate</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{myCommission.pct}%</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">All-time RFM quotes total</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">${fmtUsd(myCommission.quotes_total_usd)}</p>
                <p className="mt-0.5 text-[10px] text-[var(--text-faint)]">{myCommission.quote_count} quote{myCommission.quote_count !== 1 ? "s" : ""}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">All-time earned</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">${fmtUsd(myCommission.commission_usd)}</p>
              </div>
            </div>

            {showMyPayouts && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Payout history</p>
                {myPayoutsLoading && <p className="text-xs text-[var(--text-faint)]">Loading…</p>}
                {!myPayoutsLoading && myPayouts.length === 0 && (
                  <p className="text-xs text-[var(--text-faint)]">No closed periods yet. Your admin will close each month to record payouts.</p>
                )}
                {!myPayoutsLoading && myPayouts.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                    <table className="min-w-full text-left text-xs">
                      <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
                        <tr>
                          <th className="py-2 px-3">Period</th>
                          <th className="py-2 pr-3 text-right">Quotes</th>
                          <th className="py-2 pr-3 text-right">Quotes total</th>
                          <th className="py-2 pr-3 text-right">Rate</th>
                          <th className="py-2 pr-3 text-right">Earned</th>
                          <th className="py-2 pr-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myPayouts.map((p) => (
                          <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-2 px-3 font-medium text-[var(--text-primary)]">{formatPeriod(p.period)}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-muted)]">{p.quote_count}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">${fmtUsd(p.quotes_total_usd)}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{p.commission_pct}%</td>
                            <td className="py-2 pr-3 text-right font-semibold text-[var(--text-primary)]">${fmtUsd(p.commission_usd)}</td>
                            <td className="py-2 pr-3 text-right">
                              {p.paid_at
                                ? <span className="text-[var(--status-success-text)]">Paid ✓ <span className="text-[var(--text-faint)]">{new Date(p.paid_at).toLocaleDateString()}</span></span>
                                : <span className="text-[var(--status-pending-text)]">Unpaid</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-[var(--border-strong)]">
                        <tr>
                          <td colSpan={4} className="py-2 px-3 text-[11px] text-[var(--text-faint)]">
                            Unpaid balance
                          </td>
                          <td className="py-2 pr-3 text-right font-semibold text-[var(--status-pending-text)]">${fmtUsd(myUnpaidTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Expenses */}
        <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">Expenses</p>
            <p className="text-[11px] text-[var(--text-faint)]">
              Total: <span className="font-semibold text-[var(--text-primary)]">${fmtUsd(expensesTotal)}</span>
            </p>
          </div>

          <form onSubmit={submitExpense} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block">
              <div className="mb-1 text-[11px] text-[var(--text-muted)]">Type</div>
              <select
                value={expenseType}
                onChange={(e) => setExpenseType(e.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
              >
                {EXPENSE_TYPES.map((t) => (
                  <option key={t} value={t}>{expenseTypeLabel(t)}</option>
                ))}
              </select>
            </label>

            {expenseType === "mileage" ? (
              <label className="block">
                <div className="mb-1 text-[11px] text-[var(--text-muted)]">Miles</div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={expenseMiles}
                  onChange={(e) => setExpenseMiles(e.target.value)}
                  placeholder="0"
                  className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                />
              </label>
            ) : (
              <label className="block">
                <div className="mb-1 text-[11px] text-[var(--text-muted)]">Amount ($)</div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                />
              </label>
            )}

            <label className="block flex-1 min-w-[8rem]">
              <div className="mb-1 text-[11px] text-[var(--text-muted)]">Notes (optional)</div>
              <input
                type="text"
                value={expenseNotes}
                onChange={(e) => setExpenseNotes(e.target.value)}
                placeholder="e.g. client visit"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
              />
            </label>

            {expenseType === "mileage" && (
              <div className="text-[11px] text-[var(--text-faint)] sm:pb-2">
                {expenseMileageCalcUsd != null
                  ? `= $${fmtUsd(expenseMileageCalcUsd)} at $${fmtUsd(mileageRate)}/mi`
                  : `$${fmtUsd(mileageRate)}/mi`}
              </div>
            )}

            <button
              type="submit"
              disabled={expenseSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {expenseSubmitting ? "Adding…" : "Add expense"}
            </button>
          </form>

          {expenseError && (
            <p className="mb-3 text-xs text-[var(--attention)]">{expenseError}</p>
          )}

          {expensesLoading ? (
            <p className="text-xs text-[var(--text-faint)]">Loading…</p>
          ) : expenses.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">No expenses logged yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
                  <tr>
                    <th className="py-2 px-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Notes</th>
                    <th className="py-2 pr-3 text-right">Miles</th>
                    <th className="py-2 pr-3 text-right">Amount</th>
                    <th className="py-2 pr-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 px-3 text-[var(--text-muted)]">{new Date(e.created_at).toLocaleDateString()}</td>
                      <td className="py-2 pr-3 text-[var(--text-primary)]">{expenseTypeLabel(e.expense_type)}</td>
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">{e.notes || "—"}</td>
                      <td className="py-2 pr-3 text-right text-[var(--text-muted)]">{e.miles != null ? Number(e.miles).toFixed(1) : "—"}</td>
                      <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">${fmtUsd(e.amount_usd)}</td>
                      <td className="py-2 pr-0 text-right">
                        <button
                          type="button"
                          onClick={() => deleteExpense(e.id)}
                          disabled={deletingExpenseId === e.id}
                          className="text-[11px] text-[var(--text-faint)] hover:text-[var(--attention)] disabled:opacity-50"
                        >
                          {deletingExpenseId === e.id ? "…" : "Remove"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Jump to quote + summary */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Jump to quote */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Jump to quote
            </div>
            <p className="mb-3 text-xs text-[var(--text-secondary)]">
              Type a quote number to open its internal engineering view
              (layouts + CAD) at{" "}
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
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
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none ring-0 placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[var(--action-primary)] px-4 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)]"
              >
                Go
              </button>
            </form>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Admin only – not visible to customers.
            </p>
          </div>

          {/* Summary card (live counts) */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Summary
            </div>

            {error ? (
              <p className="text-xs text-[var(--attention)]">{error}</p>
            ) : (
              <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                <li>
                  <span className="font-medium text-[var(--text-primary)]">
                    {loading ? "…" : totalCount}
                  </span>{" "}
                  quotes returned (latest from{" "}
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                    /api/quotes
                  </span>
                  ).
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">
                    {loading ? "…" : recentCount}
                  </span>{" "}
                  updated in the last 24 hours.
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">
                    {loading ? "…" : engineeringCount}
                  </span>{" "}
                  marked as engineering / in-progress.
                </li>
              </ul>
            )}

            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Live data source:{" "}
              <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                /api/quotes?limit=200
              </span>
              . This view is read-only; status changes still flow through your
              existing pipelines.
            </p>
          </div>
        </section>

        {/* Recent quotes section (filters + materials widget + table) */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5 text-sm text-[var(--text-secondary)]">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Recent quotes
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Live quote list from the database. Use the filters and search to
                focus on specific statuses or customers.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {/* Filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <StatusChip
                  label="All"
                  active={filterKey === "all"}
                  onClick={() => setFilterKey("all")}
                />
                <StatusChip
                  label="RFM"
                  active={filterKey === "rfm"}
                  onClick={() => setFilterKey("rfm")}
                />
                <StatusChip
                  label="Sent"
                  active={filterKey === "sent"}
                  onClick={() => setFilterKey("sent")}
                />

                {salesPills.map((name) => {
                  const key: FilterKey = `sales:${name}`;
                  return (
                    <StatusChip
                      key={key}
                      label={name}
                      active={filterKey === key}
                      onClick={() => setFilterKey(key)}
                    />
                  );
                })}
              </div>

              {/* Text search */}
              <div className="w-full sm:w-48">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search quotes..."
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2.5 py-1.5 text-[11px] text-[var(--text-primary)] outline-none ring-0 placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)]"
                />
                <div className="mt-0.5 text-[10px] text-[var(--text-faint)] text-right">
                  Showing {loading ? "…" : showingCount} of{" "}
                  {loading ? "…" : totalCount}
                </div>
              </div>
            </div>
          </div>

          {/* Materials used recently widget */}
          <div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-xs text-[var(--text-secondary)]">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Materials used recently
            </div>
            {materialStatsLoading && (
              <p className="text-[11px] text-[var(--text-muted)]">
                Analyzing the latest quotes…
              </p>
            )}
            {!materialStatsLoading && materialStatsError && (
              <p className="text-[11px] text-[var(--attention)]">
                {materialStatsError}
              </p>
            )}
            {!materialStatsLoading &&
              !materialStatsError &&
              materialStats &&
              materialStats.length === 0 && (
                <p className="text-[11px] text-[var(--text-muted)]">
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
                      <span className="truncate text-[11px] text-[var(--text-primary)]">
                        {m.name}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {m.count} quote{m.count === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            <p className="mt-2 text-[10px] text-[var(--text-faint)]">
              Sample based on the latest quotes returned by{" "}
              <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                /api/quote/print
              </span>{" "}
              for a small batch of recent quote numbers.
            </p>
          </div>

          <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-card)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Quote #</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Email / Phone</th>
                 <th className="px-3 py-2 font-medium text-right">
  Updated
</th>
<th className="px-3 py-2 font-medium text-right">
  Review
</th>

                </tr>
              </thead>
              <tbody>
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                    >
                      Loading quotes…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-4 text-center text-xs text-[var(--attention)]"
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
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                      >
                        No quotes match the current filters.
                      </td>
                    </tr>
                  )}

                {!loading &&
                  !error &&
                  filteredQuotes &&
                  filteredQuotes.map((q) => {
                    const updated = formatDateTime(
                      q.updated_at || q.created_at,
                    );

                    return (
                      <React.Fragment key={q.id}>
                      <tr
                        className="border-t border-[var(--border)] hover:bg-[var(--surface-subtle)]"
                      >
                        <td className="px-3 py-2 font-mono text-[11px]">
                          <Link
                            href={`/admin/quotes/${encodeURIComponent(
                              q.quote_no,
                            )}`}
                            className="text-[var(--text-primary)] hover:underline underline-offset-2"
                          >
                            {q.quote_no}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs text-[var(--text-primary)]">
                          {q.customer_id ? (
                            <Link
                              href={`/admin/customers/${q.customer_id}`}
                              className="hover:underline"
                              title="View all quotes from this customer"
                            >
                              {q.customer_name || "Unnamed customer"}
                            </Link>
                          ) : (
                            q.customer_name || (
                              <span className="text-[var(--text-faint)]">Unknown</span>
                            )
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-[var(--text-secondary)]">
                          {q.email && (
                            <span className="block truncate">
                              {q.email}
                            </span>
                          )}
                          {q.phone && (
                            <span className="block text-[var(--text-muted)]">
                              {q.phone}
                            </span>
                          )}
                          {!q.email && !q.phone && (
                            <span className="text-[var(--text-faint)]">
                              No contact info
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[11px] text-[var(--text-muted)]">
  {updated}
</td>

                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            {q.revision && (
                              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--status-neutral-bg)] px-2 py-1 text-[10px] font-medium text-[var(--status-neutral-text)]">
                                {q.revision}
                              </span>
                            )}

                            {q.sales_rep_name && (
                              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--status-neutral-bg)] px-2 py-1 text-[10px] font-medium text-[var(--status-neutral-text)]">
                                {q.sales_rep_name}
                              </span>
                            )}
                            {q.locked ? (
                              <span className="inline-flex items-center rounded-full border border-[var(--status-success-text)]/40 bg-[var(--status-success-bg)] px-2 py-1 text-[10px] font-medium text-[var(--status-success-text)]">
                                Released for Mfg
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--status-neutral-bg)] px-2 py-1 text-[10px] font-medium text-[var(--status-neutral-text)]">
                                Editable
                              </span>
                            )}

                            <button
                              type="button"
                              disabled={!!rowBusy[q.quote_no] || !!q.locked}
                              onClick={() => setQuoteLock(q.quote_no, true)}
                              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-primary)] transition hover:border-[var(--action-primary)] disabled:opacity-60"
                              title={q.locked ? "Locked (use Revise to start a new revision)" : "Lock for production"}
                            >
                              {rowBusy[q.quote_no] ? "" : q.locked ? "Locked" : "RFM"}
                            </button>
                            <button
                              onClick={() => handleReviseQuote(q.quote_no, !!q.locked)}
                              style={{
                                marginLeft: 8,
                                padding: "4px 8px",
                                fontSize: 12,
                                fontWeight: 500,
                                borderRadius: 6,
                                background: "var(--action-primary)",
                                color: "white",
                                border: "1px solid var(--action-primary)",
                                cursor: "pointer",
                              }}
                              title="Unlock and open the layout editor"
                            >
                              Revise
                            </button>

                            <Link
                              href={`/quote?quote_no=${encodeURIComponent(q.quote_no)}`}
                              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                            >
                              Review
                            </Link>

                            <button
                              type="button"
                              onClick={() => toggleNotes(q.quote_no)}
                              className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                              aria-expanded={!!expandedNotes[q.quote_no]}
                              title="View internal notes without opening the full quote"
                            >
                              {expandedNotes[q.quote_no] ? "Hide notes ▲" : "Notes ▼"}
                            </button>
                          </div>
                        </td>

                      </tr>
                      {expandedNotes[q.quote_no] && (
                        <tr className="border-t border-[var(--border)] bg-[var(--surface-subtle)]">
                          <td colSpan={5} className="px-3 py-3">
                            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                              Internal notes
                            </div>
                            <div className="mb-1 text-[11px] text-[var(--text-faint)]">
                              Not visible to customer
                            </div>
                            {notesLoading[q.quote_no] ? (
                              <div className="text-xs text-[var(--text-muted)]">Loading…</div>
                            ) : notesError[q.quote_no] ? (
                              <div className="text-xs text-[var(--attention)]">{notesError[q.quote_no]}</div>
                            ) : notesByQuote[q.quote_no] ? (
                              <div className="whitespace-pre-wrap text-xs text-[var(--text-primary)]">
                                {notesByQuote[q.quote_no]}
                              </div>
                            ) : (
                              <div className="text-xs text-[var(--text-faint)]">No internal notes for this quote.</div>
                            )}
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-[var(--text-faint)]">
            All rows above are live from the{" "}
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              quotes
            </span>{" "}
            table via{" "}
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              /api/quotes
            </span>
            . This view remains read-only; any status changes still flow
            through your existing pipelines.
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>

      <RepStartQuoteModal open={showStartModal} onClose={() => setShowStartModal(false)} />
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
    return "bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] border border-[var(--status-pending-text)]/40";
  }
  if (s === "sent" || s === "approved") {
    return "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-text)]/40";
  }
  if (s === "rejected") {
    return "bg-[var(--attention-bg)] text-[var(--attention)] border border-[var(--attention-border)]";
  }
  if (s === "draft") {
    return "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--border)]";
  }
  return "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--border)]";
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
          ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
          : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
      }`}
    >
      {label}
    </button>
  );
}


