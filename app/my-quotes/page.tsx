// app/my-quotes/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";

type QuoteRow = {
  id: number; quote_no: string; customer_name: string | null;
  email: string | null; phone: string | null; status: string | null; created_at: string;
};

type PayoutRow = {
  id: number; period: string; quotes_total_usd: string; commission_pct: string;
  commission_usd: string; quote_count: number; paid_at: string | null; created_at: string;
};

type ApiResponse = {
  ok: boolean; quotes?: QuoteRow[]; error?: string;
  commission?: { pct: number | null; quotes_total_usd: number; commission_usd: number; quote_count: number; };
};

function fmt(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function classifyStatus(status: string | null | undefined) {
  const raw = (status || "").toLowerCase().trim();
  if (!raw) return { label: "Unlabeled", tone: "neutral" as const };
  if (["won", "accepted", "approved"].some((s) => raw.includes(s))) return { label: status!, tone: "success" as const };
  if (["lost", "declined", "cancelled", "canceled"].some((s) => raw.includes(s))) return { label: status!, tone: "danger" as const };
  if (["sent", "pending", "open", "review"].some((s) => raw.includes(s))) return { label: status!, tone: "warning" as const };
  return { label: status!, tone: "neutral" as const };
}

function statusClasses(tone: "success" | "danger" | "warning" | "neutral") {
  switch (tone) {
    case "success": return "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border-[var(--status-success-text)]/40";
    case "danger":  return "bg-[var(--attention-bg)] text-[var(--attention)] border-[var(--attention-border)]";
    case "warning": return "bg-[var(--status-pending-bg)] text-[var(--status-pending-text)] border-[var(--status-pending-text)]/40";
    default:        return "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border-[var(--border)]";
  }
}

export default function MyQuotesPage() {
  const [quotes, setQuotes] = React.useState<QuoteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [commission, setCommission] = React.useState<ApiResponse["commission"]>(undefined);
  const [payouts, setPayouts] = React.useState<PayoutRow[]>([]);
  const [payoutsLoading, setPayoutsLoading] = React.useState(true);
  const [showPayouts, setShowPayouts] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    async function loadAll() {
      try {
        setLoading(true);
        const res = await fetch("/api/my-quotes?limit=200", { cache: "no-store" });
        if (res.status === 401) { window.location.href = "/login?next=/my-quotes"; return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ApiResponse = await res.json();
        if (!active) return;
        if (!json.ok) throw new Error(json.error || "my-quotes API returned ok=false.");
        setQuotes(json.quotes || []);
        setCommission(json.commission);
        setError(null);
      } catch (err) {
        if (active) setError("Could not load your quotes. Please try again.");
      } finally {
        if (active) setLoading(false);
      }

      // Load payout history separately (non-blocking)
      try {
        const res = await fetch("/api/my-quotes/payouts", { cache: "no-store" });
        const json = await res.json();
        if (active && json.ok) setPayouts(json.payouts || []);
      } catch { /* silent */ }
      finally { if (active) setPayoutsLoading(false); }
    }

    loadAll();
    return () => { active = false; };
  }, []);

  const now = React.useMemo(() => new Date(), []);
  const total = quotes.length;
  const last7Days = quotes.filter((q) => {
    const diff = (now.getTime() - new Date(q.created_at).getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  }).length;
  const activeCount = quotes.filter((q) => {
    const { tone } = classifyStatus(q.status);
    return tone === "warning" || tone === "neutral";
  }).length;

  const unpaidPayouts = payouts.filter((p) => !p.paid_at);
  const unpaidTotal = unpaidPayouts.reduce((s, p) => s + Number(p.commission_usd), 0);

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 space-y-6">

        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">My quotes</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Quotes assigned to your seat. Older quotes without a sales rep set won&apos;t show here.
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <Link href="/quote/start?rep=sales-demo" className="rounded-md bg-[var(--action-primary)] px-3 py-1.5 font-medium text-white hover:bg-[var(--action-primary-hover)]">
              Start a new quote
            </Link>
            <Link href="/admin" className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]">
              Admin home
            </Link>
          </div>
        </header>

        {/* Summary tiles */}
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Total assigned</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{total}</p>
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">Quotes tagged to your seat</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Last 7 days</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{last7Days}</p>
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">Fresh quotes created this week</p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Active pipeline</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{activeCount}</p>
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">Open or unlabeled quotes</p>
          </div>
        </section>

        {/* Commission section */}
        {commission && commission.pct != null && (
          <section className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">Your commission</p>
              {payouts.length > 0 && (
                <button onClick={() => setShowPayouts((v) => !v)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                  {showPayouts ? "Hide history" : "View payout history"}
                  {unpaidPayouts.length > 0 && !showPayouts && (
                    <span className="ml-1.5 rounded-full bg-[var(--status-pending-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-pending-text)]">
                      {unpaidPayouts.length} unpaid
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Current totals */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">Rate</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{commission.pct}%</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">All-time RFM quotes total</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">${fmt(commission.quotes_total_usd)}</p>
                <p className="mt-0.5 text-[10px] text-[var(--text-faint)]">{commission.quote_count} quote{commission.quote_count !== 1 ? "s" : ""}</p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">All-time earned</p>
                <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">${fmt(commission.commission_usd)}</p>
              </div>
            </div>

            {/* Payout history table */}
            {showPayouts && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Payout history</p>
                {payoutsLoading && <p className="text-xs text-[var(--text-faint)]">Loading…</p>}
                {!payoutsLoading && payouts.length === 0 && (
                  <p className="text-xs text-[var(--text-faint)]">No closed periods yet. Your admin will close each month to record payouts.</p>
                )}
                {!payoutsLoading && payouts.length > 0 && (
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
                        {payouts.map((p) => (
                          <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                            <td className="py-2 px-3 font-medium text-[var(--text-primary)]">{formatPeriod(p.period)}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-muted)]">{p.quote_count}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">${fmt(p.quotes_total_usd)}</td>
                            <td className="py-2 pr-3 text-right text-[var(--text-secondary)]">{p.commission_pct}%</td>
                            <td className="py-2 pr-3 text-right font-semibold text-[var(--text-primary)]">${fmt(p.commission_usd)}</td>
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
                          <td className="py-2 pr-3 text-right font-semibold text-[var(--status-pending-text)]">${fmt(unpaidTotal)}</td>
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

        {/* Quotes table */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
          {loading && <p className="text-sm text-[var(--text-secondary)]">Loading your quotes…</p>}
          {error && !loading && <p className="text-sm text-[var(--attention)]">{error}</p>}
          {!loading && !error && total === 0 && (
            <div className="py-6 text-center text-sm text-[var(--text-secondary)]">
              <p className="mb-2">You don&apos;t have any quotes yet.</p>
              <p className="text-xs text-[var(--text-muted)]">When new quotes are created and assigned to your seat, they&apos;ll appear here automatically.</p>
            </div>
          )}
          {total > 0 && !loading && (
            <div className="mt-1 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2 pr-4">Quote #</th>
                    <th className="py-2 pr-4">Customer</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Follow-up</th>
                    <th className="py-2 pr-0"></th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => {
                    const info = classifyStatus(q.status);
                    const cls = statusClasses(info.tone);
                    const created = new Date(q.created_at);
                    const diffDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
                    const needsFollowUp = (info.tone === "warning" || info.tone === "neutral") && diffDays >= 3;
                    return (
                      <tr key={q.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)]">
                        <td className="py-2 pr-4 text-[var(--text-primary)]">{q.quote_no}</td>
                        <td className="py-2 pr-4 text-[var(--text-secondary)]">{q.customer_name || "—"}</td>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">{q.email || "—"}</td>
                        <td className="py-2 pr-4">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{info.label}</span>
                        </td>
                        <td className="py-2 pr-4 text-[var(--text-muted)]">
                          {created.toLocaleDateString()}{" "}
                          <span className="text-[10px] text-[var(--text-faint)]">{created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </td>
                        <td className="py-2 pr-4">
                          {needsFollowUp && (
                            <span className="inline-flex rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-[11px] text-[var(--status-pending-text)]">Follow up</span>
                          )}
                        </td>
                        <td className="py-2 pr-0 text-right">
                          <Link href={`/quote?quote_no=${encodeURIComponent(q.quote_no)}`} className="text-xs text-[var(--text-primary)] hover:underline">
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
