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

function currentPeriod() {
  const d = new Date();
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
  const [selectedPeriod, setSelectedPeriod] = React.useState(currentPeriod());

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
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">

        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Commissions</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              RFM quotes only. Set rates in{" "}
              <Link href="/admin" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline">Admin → Users</Link>.
            </p>
          </div>
          <button onClick={() => { loadLive(); loadPayouts(); }}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]">
            Refresh
          </button>
        </header>

        {error && <p className="rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-2 text-sm text-[var(--attention)]">{error}</p>}
        {okMsg && <p className="rounded-lg border border-[var(--status-success-text)]/30 bg-[var(--status-success-bg)] px-4 py-2 text-sm text-[var(--status-success-text)]">{okMsg}</p>}

        {showReminder && (
          <div className="flex items-center justify-between rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-3 text-sm text-[var(--attention)]">
            <span>⚠ {formatPeriod(lastMonth)} has not been closed yet.</span>
            <button onClick={() => setSelectedPeriod(lastMonth)} className="ml-4 text-xs underline hover:no-underline">Select it</button>
          </div>
        )}

        {/* Live section */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">Live — All-time RFM totals</h2>
          {!liveLoading && liveRows.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Reps tracked</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{liveRows.length}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">RFM quotes total</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">${fmt(liveTotal)}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Total commission</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">${fmt(liveCommission)}</p>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
            {liveLoading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
            {!liveLoading && liveRows.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-faint)]">No reps with a sales slug found.</p>}
            {!liveLoading && liveRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
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
                      <tr key={r.user_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)]">
                        <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">{r.name}</td>
                        <td className="py-2 pr-4"><span className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{r.sales_slug}</span></td>
                        <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{r.quote_count}</td>
                        <td className="py-2 pr-4 text-right text-[var(--text-primary)]">${fmt(r.quotes_total_usd)}</td>
                        <td className="py-2 pr-4 text-right">{r.commission_pct != null ? <span className="text-[var(--text-secondary)]">{r.commission_pct}%</span> : <span className="text-[var(--text-faint)]">—</span>}</td>
                        <td className="py-2 pr-0 text-right font-semibold text-[var(--text-primary)]">${fmt(r.commission_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)]">
                    <tr>
                      <td colSpan={3} className="py-2 text-[11px] text-[var(--text-faint)]">Totals</td>
                      <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">${fmt(liveTotal)}</td>
                      <td />
                      <td className="py-2 pr-0 text-right font-semibold text-[var(--text-primary)]">${fmt(liveCommission)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Close month */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-5 py-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">Close a month</h2>
          <p className="mb-4 text-sm text-[var(--text-muted)]">Snapshots each rep's RFM totals for the selected month. Already-paid periods won't be overwritten.</p>
          <div className="flex items-center gap-3">
            <input type="month" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]" />
            <button onClick={closeMonth} disabled={closingMonth}
              className="rounded-md bg-[var(--action-primary)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-50">
              {closingMonth ? "Closing…" : `Close ${formatPeriod(selectedPeriod)}`}
            </button>
          </div>
        </section>

        {/* Payout history */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
              Payout history
              {unpaidPayouts.length > 0 && (
                <span className="ml-2 rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-[10px] text-[var(--status-pending-text)]">
                  {unpaidPayouts.length} unpaid · ${fmt(unpaidTotal)} owed
                </span>
              )}
            </h2>
            <button onClick={() => setShowPaid((v) => !v)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              {showPaid ? "Hide paid" : "Show paid history"}
            </button>
          </div>

          {payoutsLoading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

          {!payoutsLoading && periodGroups.length === 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-center text-sm text-[var(--text-faint)]">
              No payout records yet. Use "Close a month" above to create the first snapshot.
            </div>
          )}

          {!payoutsLoading && periodGroups.map(([period, rows]) => {
            const periodTotal = rows.reduce((s, r) => s + Number(r.commission_usd), 0);
            const allPaid = rows.every((r) => r.paid_at);
            return (
              <div key={period} className="mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-card)]">
                <div className={`flex items-center justify-between px-4 py-2 ${allPaid ? "bg-[var(--status-success-bg)]" : "bg-[var(--surface-subtle)]"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{formatPeriod(period)}</span>
                    {allPaid
                      ? <span className="rounded-full bg-[var(--status-success-bg)] border border-[var(--status-success-text)]/30 px-2 py-0.5 text-[10px] text-[var(--status-success-text)]">All paid</span>
                      : <span className="rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-[10px] text-[var(--status-pending-text)]">Unpaid</span>}
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">${fmt(periodTotal)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
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
                        <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)]">
                          <td className="py-2 px-4 font-medium text-[var(--text-primary)]">{p.name}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-muted)]">{p.quote_count}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">${fmt(p.quotes_total_usd)}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{p.commission_pct}%</td>
                          <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">${fmt(p.commission_usd)}</td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <span className="text-[11px] text-[var(--status-success-text)]">Paid {new Date(p.paid_at).toLocaleDateString()}{p.paid_by_name && <span className="text-[var(--text-faint)]"> · {p.paid_by_name}</span>}</span>
                              : <span className="text-[11px] text-[var(--status-pending-text)]">Unpaid</span>}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <button onClick={() => markPaid(p.id, true)} disabled={markingPaidId === p.id} className="text-[11px] text-[var(--text-faint)] underline hover:text-[var(--text-secondary)] disabled:opacity-40">{markingPaidId === p.id ? "…" : "Undo"}</button>
                              : <button onClick={() => markPaid(p.id)} disabled={markingPaidId === p.id} className="rounded bg-[var(--status-success-bg)] px-2 py-0.5 text-[11px] text-[var(--status-success-text)] hover:opacity-80 disabled:opacity-40">{markingPaidId === p.id ? "…" : "Mark paid"}</button>}
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
