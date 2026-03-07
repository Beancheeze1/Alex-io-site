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
    case "success": return "bg-emerald-900/40 text-emerald-200 border-emerald-700/60";
    case "danger":  return "bg-rose-900/40 text-rose-200 border-rose-700/60";
    case "warning": return "bg-amber-900/40 text-amber-200 border-amber-700/60";
    default:        return "bg-neutral-900/60 text-neutral-200 border-neutral-700/60";
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
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10 space-y-6">

        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">My quotes</h1>
            <p className="mt-2 text-sm text-neutral-300">
              Quotes assigned to your seat. Older quotes without a sales rep set won&apos;t show here.
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <Link href="/quote/start?rep=sales-demo" className="rounded-full bg-sky-500 px-3 py-1.5 font-medium text-white hover:bg-sky-400">
              Start a new quote
            </Link>
            <Link href="/admin" className="rounded-full border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-900">
              Admin home
            </Link>
          </div>
        </header>

        {/* Summary tiles */}
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Total assigned</p>
            <p className="mt-2 text-2xl font-semibold">{total}</p>
            <p className="mt-1 text-[11px] text-neutral-500">Quotes tagged to your seat</p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Last 7 days</p>
            <p className="mt-2 text-2xl font-semibold">{last7Days}</p>
            <p className="mt-1 text-[11px] text-neutral-500">Fresh quotes created this week</p>
          </div>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-neutral-400">Active pipeline</p>
            <p className="mt-2 text-2xl font-semibold">{activeCount}</p>
            <p className="mt-1 text-[11px] text-neutral-500">Open or unlabeled quotes</p>
          </div>
        </section>

        {/* Commission section */}
        {commission && commission.pct != null && (
          <section className="rounded-2xl border border-sky-800/50 bg-sky-950/40 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-sky-400">Your commission</p>
              {payouts.length > 0 && (
                <button onClick={() => setShowPayouts((v) => !v)} className="text-xs text-neutral-500 hover:text-neutral-300">
                  {showPayouts ? "Hide history" : "View payout history"}
                  {unpaidPayouts.length > 0 && !showPayouts && (
                    <span className="ml-1.5 rounded-full bg-amber-700/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                      {unpaidPayouts.length} unpaid
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Current totals */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-neutral-400">Rate</p>
                <p className="mt-1 text-2xl font-semibold text-sky-300">{commission.pct}%</p>
              </div>
              <div>
                <p className="text-[11px] text-neutral-400">All-time RFM quotes total</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-100">${fmt(commission.quotes_total_usd)}</p>
                <p className="mt-0.5 text-[10px] text-neutral-500">{commission.quote_count} quote{commission.quote_count !== 1 ? "s" : ""}</p>
              </div>
              <div>
                <p className="text-[11px] text-neutral-400">All-time earned</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-300">${fmt(commission.commission_usd)}</p>
              </div>
            </div>

            {/* Payout history table */}
            {showPayouts && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Payout history</p>
                {payoutsLoading && <p className="text-xs text-neutral-500">Loading…</p>}
                {!payoutsLoading && payouts.length === 0 && (
                  <p className="text-xs text-neutral-500">No closed periods yet. Your admin will close each month to record payouts.</p>
                )}
                {!payoutsLoading && payouts.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-neutral-700/50">
                    <table className="min-w-full text-left text-xs">
                      <thead className="border-b border-neutral-700/50 text-neutral-500">
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
                          <tr key={p.id} className="border-b border-neutral-800/50 last:border-0">
                            <td className="py-2 px-3 font-medium text-neutral-200">{formatPeriod(p.period)}</td>
                            <td className="py-2 pr-3 text-right text-neutral-400">{p.quote_count}</td>
                            <td className="py-2 pr-3 text-right text-neutral-300">${fmt(p.quotes_total_usd)}</td>
                            <td className="py-2 pr-3 text-right text-sky-300">{p.commission_pct}%</td>
                            <td className="py-2 pr-3 text-right font-semibold text-emerald-300">${fmt(p.commission_usd)}</td>
                            <td className="py-2 pr-3 text-right">
                              {p.paid_at
                                ? <span className="text-emerald-400">Paid ✓ <span className="text-neutral-500">{new Date(p.paid_at).toLocaleDateString()}</span></span>
                                : <span className="text-amber-400">Unpaid</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-neutral-700/50">
                        <tr>
                          <td colSpan={4} className="py-2 px-3 text-[11px] text-neutral-500">
                            Unpaid balance
                          </td>
                          <td className="py-2 pr-3 text-right font-semibold text-amber-300">${fmt(unpaidTotal)}</td>
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
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4 shadow-md">
          {loading && <p className="text-sm text-neutral-300">Loading your quotes…</p>}
          {error && !loading && <p className="text-sm text-rose-300">{error}</p>}
          {!loading && !error && total === 0 && (
            <div className="py-6 text-center text-sm text-neutral-300">
              <p className="mb-2">You don&apos;t have any quotes yet.</p>
              <p className="text-xs text-neutral-400">When new quotes are created and assigned to your seat, they&apos;ll appear here automatically.</p>
            </div>
          )}
          {total > 0 && !loading && (
            <div className="mt-1 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-neutral-800 text-neutral-400">
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
                      <tr key={q.id} className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/70">
                        <td className="py-2 pr-4 text-neutral-50">{q.quote_no}</td>
                        <td className="py-2 pr-4 text-neutral-200">{q.customer_name || "—"}</td>
                        <td className="py-2 pr-4 text-neutral-300">{q.email || "—"}</td>
                        <td className="py-2 pr-4">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${cls}`}>{info.label}</span>
                        </td>
                        <td className="py-2 pr-4 text-neutral-400">
                          {created.toLocaleDateString()}{" "}
                          <span className="text-[10px] text-neutral-500">{created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </td>
                        <td className="py-2 pr-4">
                          {needsFollowUp && (
                            <span className="inline-flex rounded-full bg-amber-900/50 px-2 py-0.5 text-[11px] text-amber-200">Follow up</span>
                          )}
                        </td>
                        <td className="py-2 pr-0 text-right">
                          <Link href={`/quote?quote_no=${encodeURIComponent(q.quote_no)}`} className="text-xs text-sky-300 hover:text-sky-200 hover:underline">
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
