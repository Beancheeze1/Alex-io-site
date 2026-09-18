// app/admin/expenses/page.tsx
//
// Admin-wide expense reimbursement view -- mirrors /admin/commissions.
// Live outstanding rollup, close-a-period control, and period history
// grouped by period with a reimbursed/unreimbursed toggle.
//
// Note the wording throughout: a period captures everything outstanding as
// of the moment it's closed, not a calendar-month slice. Back-dated or
// skipped-month expenses are still picked up by the next close.
"use client";

import * as React from "react";
import Link from "next/link";

type LiveRow = {
  user_id: number; name: string; email: string; sales_slug: string;
  outstanding_count: number; outstanding_usd: number;
  all_time_count: number; all_time_usd: number;
};

type PayoutRow = {
  id: number; user_id: number; name: string; email: string; sales_slug: string;
  period: string; expense_total_usd: string; expense_count: number;
  paid_at: string | null; paid_by_name: string | null; notes: string | null; created_at: string;
};

function fmt(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function AdminExpensesPage() {
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
      const res = await fetch("/api/admin/expenses", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/login?next=/admin/expenses"; return; }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load live data");
      setLiveRows(json.rows || []);
    } catch (err: any) { setError(err.message); }
    finally { setLiveLoading(false); }
  }

  async function loadPayouts() {
    setPayoutsLoading(true);
    try {
      const res = await fetch("/api/admin/expenses/payouts", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load reimbursement periods");
      setPayouts(json.payouts || []);
    } catch (err: any) { setError(err.message); }
    finally { setPayoutsLoading(false); }
  }

  React.useEffect(() => { loadLive(); loadPayouts(); }, []);

  async function closeMonth() {
    if (!selectedPeriod || !/^\d{4}-\d{2}$/.test(selectedPeriod)) { setError("Invalid period."); return; }
    setClosingMonth(true); setError(null); setOkMsg(null);
    try {
      const res = await fetch("/api/admin/expenses/payouts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: selectedPeriod }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || json.error || "Close failed");
      setOkMsg(
        `Closed ${formatPeriod(selectedPeriod)} — ${json.closed_count ?? 0} rep(s), ` +
        `${json.swept_count ?? 0} outstanding expense(s) captured.`,
      );
      await Promise.all([loadPayouts(), loadLive()]);
    } catch (err: any) { setError(err.message); }
    finally { setClosingMonth(false); }
  }

  async function markPaid(id: number, unpay = false) {
    setMarkingPaidId(id); setError(null); setOkMsg(null);
    try {
      const res = await fetch("/api/admin/expenses/payouts", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, unpay }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || json.error || "Update failed");
      setOkMsg(unpay ? "Marked as unreimbursed." : "Marked as reimbursed ✓");
      await loadPayouts();
    } catch (err: any) { setError(err.message); }
    finally { setMarkingPaidId(null); }
  }

  const outstandingTotal = liveRows.reduce((s, r) => s + Number(r.outstanding_usd), 0);
  const outstandingCount = liveRows.reduce((s, r) => s + Number(r.outstanding_count), 0);
  const unpaidPayouts = payouts.filter((p) => !p.paid_at);
  const paidPayouts = payouts.filter((p) => p.paid_at);
  const unpaidTotal = unpaidPayouts.reduce((s, p) => s + Number(p.expense_total_usd), 0);

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
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">Expenses</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Mileage, meals, supplies, other and misc items across all reps. Reps log them on{" "}
              <Link href="/admin/quotes" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline">Quotes</Link>.
            </p>
          </div>
          <button onClick={() => { loadLive(); loadPayouts(); }}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]">
            Refresh
          </button>
        </header>

        {error && <p className="rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-2 text-sm text-[var(--attention)]">{error}</p>}
        {okMsg && <p className="rounded-lg border border-[var(--status-success-text)]/30 bg-[var(--status-success-bg)] px-4 py-2 text-sm text-[var(--status-success-text)]">{okMsg}</p>}

        {/* Live section */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">Live — outstanding expenses</h2>
          {!liveLoading && liveRows.length > 0 && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Reps tracked</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{liveRows.length}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Outstanding items</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{outstandingCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Total outstanding</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">${fmt(outstandingTotal)}</p>
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
                      <th className="py-2 pr-4 text-right">Outstanding items</th>
                      <th className="py-2 pr-4 text-right">Outstanding</th>
                      <th className="py-2 pr-4 text-right">All-time items</th>
                      <th className="py-2 pr-0 text-right">All-time total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveRows.map((r) => (
                      <tr key={r.user_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)]">
                        <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">{r.name}</td>
                        <td className="py-2 pr-4"><span className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{r.sales_slug}</span></td>
                        <td className="py-2 pr-4 text-right text-[var(--text-secondary)]">{r.outstanding_count}</td>
                        <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">${fmt(r.outstanding_usd)}</td>
                        <td className="py-2 pr-4 text-right text-[var(--text-muted)]">{r.all_time_count}</td>
                        <td className="py-2 pr-0 text-right text-[var(--text-secondary)]">${fmt(r.all_time_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)]">
                    <tr>
                      <td colSpan={2} className="py-2 text-[11px] text-[var(--text-faint)]">Totals</td>
                      <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">{outstandingCount}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">${fmt(outstandingTotal)}</td>
                      <td className="py-2 pr-4 text-right text-[var(--text-muted)]">{liveRows.reduce((s, r) => s + r.all_time_count, 0)}</td>
                      <td className="py-2 pr-0 text-right text-[var(--text-secondary)]">${fmt(liveRows.reduce((s, r) => s + Number(r.all_time_usd), 0))}</td>
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
          <p className="mb-4 text-sm text-[var(--text-muted)]">
            Captures every rep&apos;s outstanding expenses — everything not already in a closed period, whatever
            month it was logged in — and locks those line items. Already-reimbursed periods won&apos;t be overwritten.
          </p>
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
                  {unpaidPayouts.length} unreimbursed · ${fmt(unpaidTotal)} owed
                </span>
              )}
            </h2>
            <button onClick={() => setShowPaid((v) => !v)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
              {showPaid ? "Hide reimbursed" : `Show reimbursed history${paidPayouts.length > 0 ? ` (${paidPayouts.length})` : ""}`}
            </button>
          </div>

          {payoutsLoading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

          {!payoutsLoading && periodGroups.length === 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-center text-sm text-[var(--text-faint)]">
              No closed periods yet. Use &quot;Close a month&quot; above to create the first one.
            </div>
          )}

          {!payoutsLoading && periodGroups.map(([period, rows]) => {
            const periodTotal = rows.reduce((s, r) => s + Number(r.expense_total_usd), 0);
            const periodCount = rows.reduce((s, r) => s + Number(r.expense_count), 0);
            const allPaid = rows.every((r) => r.paid_at);
            return (
              <div key={period} className="mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-card)]">
                <div className={`flex items-center justify-between px-4 py-2 ${allPaid ? "bg-[var(--status-success-bg)]" : "bg-[var(--surface-subtle)]"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-[var(--text-primary)]">{formatPeriod(period)}</span>
                    {allPaid
                      ? <span className="rounded-full bg-[var(--status-success-bg)] border border-[var(--status-success-text)]/30 px-2 py-0.5 text-[10px] text-[var(--status-success-text)]">All reimbursed</span>
                      : <span className="rounded-full bg-[var(--status-pending-bg)] px-2 py-0.5 text-[10px] text-[var(--status-pending-text)]">Unreimbursed</span>}
                    <span className="text-[11px] text-[var(--text-faint)]">{periodCount} item{periodCount !== 1 ? "s" : ""}</span>
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">${fmt(periodTotal)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
                      <tr>
                        <th className="py-2 px-4">Rep</th>
                        <th className="py-2 pr-4 text-right">Expenses</th>
                        <th className="py-2 pr-4 text-right">Total</th>
                        <th className="py-2 pr-4 text-right">Status</th>
                        <th className="py-2 pr-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-subtle)]">
                          <td className="py-2 px-4 font-medium text-[var(--text-primary)]">{p.name}</td>
                          <td className="py-2 pr-4 text-right text-[var(--text-muted)]">{p.expense_count}</td>
                          <td className="py-2 pr-4 text-right font-semibold text-[var(--text-primary)]">${fmt(p.expense_total_usd)}</td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <span className="text-[11px] text-[var(--status-success-text)]">Reimbursed {new Date(p.paid_at).toLocaleDateString()}{p.paid_by_name && <span className="text-[var(--text-faint)]"> · {p.paid_by_name}</span>}</span>
                              : <span className="text-[11px] text-[var(--status-pending-text)]">Unreimbursed</span>}
                          </td>
                          <td className="py-2 pr-4 text-right">
                            {p.paid_at
                              ? <button onClick={() => markPaid(p.id, true)} disabled={markingPaidId === p.id} className="text-[11px] text-[var(--text-faint)] underline hover:text-[var(--text-secondary)] disabled:opacity-40">{markingPaidId === p.id ? "…" : "Undo"}</button>
                              : <button onClick={() => markPaid(p.id)} disabled={markingPaidId === p.id} className="rounded bg-[var(--status-success-bg)] px-2 py-0.5 text-[11px] text-[var(--status-success-text)] hover:opacity-80 disabled:opacity-40">{markingPaidId === p.id ? "…" : "Mark reimbursed"}</button>}
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
