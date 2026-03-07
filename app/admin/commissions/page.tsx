// app/admin/commissions/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";

type LiveRow = {
  user_id: number; name: string; email: string; sales_slug: string;
  commission_pct: number | null; quote_count: number;
  quotes_total_usd: number; commission_usd: number;
};

type PayoutRow = {
  id: number; user_id: number; name: string; email: string; sales_slug: string;
  period: string; quotes_total_usd: string; commission_pct: string;
  commission_usd: string; quote_count: number;
  paid_at: string | null; paid_by_name: string | null; notes: string | null; created_at: string;
};

function fmt(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function prevPeriod() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function AdminCommissionsPage() {
  const [liveRows, setLiveRows] = React.useState<LiveRow[]>([]);
  const [payouts, setPayouts] = React.useState<PayoutRow[]>([]);
  const [liveLoading, setLiveLoading] = React.useState(true);
  const [payoutsLoading, setPayoutsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [okMsg, setOkMsg] = React.useState<string | null>(null);
  const [closingMonth, setClosingMonth] = React.useState(false);
  const [markingPaidId, setMarkingPaidId] = React.useState<number | null>(null);
  const [showPaid, setShowPaid] = React.useState(false);
  const [selectedPeriod, setSelectedPeriod] = React.useState(prevPeriod());

  async function loadLive() {
    setLiveLoading(true);
    try {
      const res = await fetch("/api/admin/commissions", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/login?next=/admin/commissions"; return; }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load live data");
      setLiveRows(json.rows || []);
    } catch (err: any) { setError(err.message); }
    finally { setLiveLoading(false); }
  }

  async function loadPayouts() {
    setPayoutsLoading(true);
    try {
      const res = await fetch("/api/admin/commissions/payouts", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load payouts");
      setPayouts(json.payouts || []);
    } catch (err: any) { setError(err.message); }
    finally { setPayoutsLoading(false); }
  }

  React.useEffect(() => { loadLive(); loadPayouts(); }, []);

  async function closeMonth() {
    if (!selectedPeriod || !/^\d{4}-\d{2}$/.test(selectedPeriod)) { setError("Invalid period."); return; }
    setClosingMonth(true); setError(null); setOkMsg(null);
    try {
      const res = await fetch("/api/admin/commissions/payouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: selectedPeriod }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || json.error || "Close failed");
      setOkMsg(`Closed ${formatPeriod(selectedPeriod)} — ${json.results?.length ?? 0} rep(s) snapshotted.`);
      await loadPayouts();
    } catch (err: any) { setError(err.message); }
    finally { setClosingMonth(false); }
  }

  async function markPaid(id: number, unpay = false) {
    setMarkingPaidId(id); setError(null); setOkMsg(null);
    try {
      const res = await fetch("/api/admin/commissions/payouts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, unpay }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || json.error || "Update failed");
      setOkMsg(unpay ? "Marked as unpaid." : "Marked as paid ✓");
      await loadPayouts();
    } catch (err: any) { setError(err.message); }
    finally { setMarkingPaidId(null); }
  }

  const liveTotal = liveRows.reduce((s, r) => s + Number(r.quotes_total_usd), 0);
  const liveCommission = liveRows.reduce((s, r) => s + Number(r.commission_usd), 0);
  const unpaidPayouts = payouts.filter((p) => !p.paid_at);
  const paidPayouts = payouts.filter((p) => p.paid_at);
  const unpaidTotal = unpaidPayouts.reduce((s, p) => s + Number(p.commission_usd), 0);
  const lastMonth = prevPeriod();
  const lastMonthClosed = payouts.some((p) => p.period === lastMonth);
  const showReminder = !lastMonthClosed && !payoutsLoading;

  const periodGroups = React.useMemo(() => {
    const display = showPaid ? payouts : unpaidPayouts;
    const map = new Map<string, PayoutRow[]>();
    for (const p of display) {
      if (!map.has(p.period)) map.set(p.period, []);
      map.get(p.period)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [payouts, unpaidPayouts, showPaid]);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">

        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">Commissions</h1>
            <p className="mt-1 text-sm text-neutral-400">
              RFM quotes only. Set rates in{" "}
              <Link href="/admin" className="text-sky-400 hover:underline">Admin → Users</Link>.
            </p>
          </div>
          <button onClick={() => { loadLive(); loadPayouts(); }}
            className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800">
            Refresh
          </button>
        </header>

        {error && <p className="rounded-lg border border-rose-700/50 bg-rose-950/60 px-4 py-2 text-sm text-rose-300">{error}</p>}
        {okMsg && <p className="rounded-lg border border-emerald-700/50 bg-emerald-950/60 px-4 py-2 text-sm text-emerald-300">{okMsg}</p>}

        {showReminder && (
          <div className="flex items-center justify-between rounded-lg border border-amber-700/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">
            <span>⚠ {formatPeriod(lastMonth)} has not been closed yet.</span>
            <button onClick={() => setSelectedPeriod(lastMonth)} className="ml-4 text-xs underline hover:no-underline">Select it</button>
          </div>
        )}

        {/* Live section */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">Live — All-time RFM totals</h2>
          {!liveLoading && liveRows.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">Reps tracked</p>
                <p className="mt-2 text-2xl font-semibold">{liveRows.length}</p>
              </div>
              <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-neutral-400">RFM quotes total</p>
                <p className="mt-2 text-2xl font-semibold">${fmt(liveTotal)}</p>
              </div>
              <div className="rounded-2xl border border-sky-800/50 bg-sky-950/40 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-sky-400">Total commission</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-300">${fmt(liveCommission)}</p>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
            {liveLoading && <p className="text-sm text-neutral-400">Loading…</p>}
            {!liveLoading && liveRows.length === 0 && <p className="py-6 text-center text-sm text-neutral-500">No reps with a sales slug found.</p>}
            {!liveLoading && liveRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-neutral-800 text-neutral-400">
                    <tr>
                      <th className="py-2 pr-4">Rep</th>
                      <th className="py-2 pr-4">Slug</th>
                      <th className="py-2 pr-4 text-right">RFM quotes</th>
                      <th className="py-2 pr-4 text-right">Quotes total</th>
                      <th className="py-2 pr-4 text-right">Rate</th>
                      <th className="py-2 pr-0 text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveRows.map((r) => (
                      <tr key={r.user_id} className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/70">
                        <td className="py-2 pr-4 font-medium text-neutral-100">{r.name}</td>
                        <td className="py-2 pr-4"><span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">{r.sales_slug}</span></td>
                        <td className="py-2 pr-4 text-right text-neutral-300">{r.quote_count}</td>
                        <td className="py-2 pr-4 text-right text-neutral-100">${fmt(r.quotes_total_usd)}</td>
                        <td className="py-2 pr-4 text-right">{r.commission_pct != null ? <span className="text-sky-300">{r.commission_pct}%</span> : <span className="text-neutral-600">—</span>}</td>
                        <td className="py-2 pr-0 text-right font-semibold text-emerald-300">${fmt(r.commission_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-neutral-700">
                    <tr>
                      <td colSpan={3} className="py-2 text-[11px] text-neutral-500">Totals</td>
                      <td className="py-2 pr-4 text-right font-semibold text-neutral-100">${fmt(liveTotal)}</td>
                      <td />
                      <td className="py-2 pr-0 text-right font-semibold text-emerald-300">${fmt(liveCommission)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Close month */}
        <section className="rounded-2xl border border-neutral-700 bg-neutral-900/40 px-5 py-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400">Close a month</h2>
          <p className="mb-4 text-sm text-neutral-400">Snapshots each rep's RFM totals for the selected month. Already-paid periods won't be overwritten.</p>
          <div className="flex items-center gap-3">
            <input type="month" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500" />
            <button onClick={closeMonth} disabled={closingMonth}
              className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50">
              {closingMonth ? "Closing…" : `Close ${formatPeriod(selectedPeriod)}`}
            </button>
          </div>
        </section>

        {/* Payout history */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Payout history
              {unpaidPayouts.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-700/40 px-2 py-0.5 text-[10px] text-amber-300">
                  {unpaidPayouts.length} unpaid · ${fmt(unpaidTotal)} owed
                </span>
              )}
            </h2>
            <button onClick={() => setShowPaid((v) => !v)} className="text-xs text-neutral-500 hover:text-neutral-300">
              {showPaid ? "Hide paid" : "Show paid history"}
            </button>
          </div>

          {payoutsLoading && <p className="text-sm text-neutral-400">Loading…</p>}

          {!payoutsLoading && periodGroups.length === 0 && (
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 text-center text-sm text-neutral-500">
              No payout records yet. Use "Close a month" above to create the first snapshot.
            </div>
          )}

          {!payoutsLoading && periodGroups.map(([period, rows]) => {
            const periodTotal = rows.reduce((s, r) => s + Number(r.commission_usd), 0);
            const allPaid = rows.every((r) => r.paid_at);
            return (
              <div key={period} className="mb-4 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60">
                <div className={`flex items-center justify-between px-4 py-2 ${allPaid ? "bg-emerald-950/30" : "bg-neutral-900"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-neutral-100">{formatPeriod(period)}</span>
                    {allPaid
                      ? <span className="rounded-full bg-emerald-800/50 px-2 py-0.5 text-[10px] text-emerald-300">All paid</span>
                      : <span className="rounded-full bg-amber-800/40 px-2 py-0.5 text-[10px] text-amber-300">Unpaid</span>}
                  </div>
                  <span className="text-sm font-semibold text-emerald-300">${fmt(periodTotal)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="border-b border-neutral-800 text-neutral-500">
                      <tr>
                        <th className="py-2 px-4">Rep</th>
                        <th className="py-2 pr-4 text-right">Quotes</th>
                        <th className="py-2 pr-4 text-right">Quotes total</th>
                        <th className="py-2 pr-4 text-right">Rate</th>
                        <th className="py-2 pr-4 text-right">Commission</th>
                        <th className="py-2 pr-4 text-right">Status</th>
                        <th className="py-2 pr-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/70">
                          <td className="py-2 px-4 font-medium text-neutral-100">{p.name}</td>
                          <td className="py-2 pr-4 text-right text-neutral-400">{p.quote_count}</td>
                          <td className="py-2 pr-4 text-right text-neutral-200">${fmt(p.quotes_total_usd)}</td>
                          <td className="py-2 pr-4 text-right text-sky-300">{p.commission_pct}%</td>
                          <td className="py-2 pr-4 text-right font-semibold text-emerald-300">${fmt(p.commission_usd)}</td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <span className="text-[11px] text-emerald-400">Paid {new Date(p.paid_at).toLocaleDateString()}{p.paid_by_name && <span className="text-neutral-500"> · {p.paid_by_name}</span>}</span>
                              : <span className="text-[11px] text-amber-400">Unpaid</span>}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <button onClick={() => markPaid(p.id, true)} disabled={markingPaidId === p.id} className="text-[11px] text-neutral-500 underline hover:text-neutral-300 disabled:opacity-40">{markingPaidId === p.id ? "…" : "Undo"}</button>
                              : <button onClick={() => markPaid(p.id)} disabled={markingPaidId === p.id} className="rounded bg-emerald-700/40 px-2 py-0.5 text-[11px] text-emerald-200 hover:bg-emerald-700/60 disabled:opacity-40">{markingPaidId === p.id ? "…" : "Mark paid"}</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>

      </div>
    </main>
  );
}
