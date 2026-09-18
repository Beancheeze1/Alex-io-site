// components/rep/MyCommissionPanel.tsx
//
// "Your commission" -- the logged-in user's own commission rate, all-time
// RFM totals, and payout history. Self-contained: fetches its own data from
// /api/my-quotes (for the commission summary) and /api/my-quotes/payouts
// (for period history), the same rep-scoped endpoints the panel used when
// it lived inline on /admin/quotes.
//
// Renders nothing if the current user has no commission_pct configured
// (i.e. isn't an active rep) -- same gate as before the move, which is what
// makes this safe to drop into /admin/commissions unconditionally for every
// admin: an admin who also happens to be a rep (e.g. Chuck) sees it, an
// admin who isn't a rep sees nothing extra. Not a special case -- the
// component just decides for itself whether it has anything to show.
//
// Used by:
//   - app/admin/commissions/page.tsx (both the sales-role trimmed view and
//     the admin view, per the role branch in that page)

"use client";

import * as React from "react";

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

function fmtUsd(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function MyCommissionPanel() {
  const [myCommission, setMyCommission] = React.useState<MyCommission | null>(null);
  const [myPayouts, setMyPayouts] = React.useState<PayoutRow[]>([]);
  const [myPayoutsLoading, setMyPayoutsLoading] = React.useState(true);
  const [showMyPayouts, setShowMyPayouts] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    async function loadMine() {
      try {
        const res = await fetch("/api/my-quotes?limit=1", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (active && json?.ok) {
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

  const myUnpaidPayouts = myPayouts.filter((p) => !p.paid_at);
  const myUnpaidTotal = myUnpaidPayouts.reduce((s, p) => s + Number(p.commission_usd), 0);

  if (!myCommission || myCommission.pct == null) return null;

  return (
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
  );
}
