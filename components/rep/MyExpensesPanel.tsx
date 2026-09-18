// components/rep/MyExpensesPanel.tsx
//
// The logged-in user's own expense tracker: the Mileage/Meals/Supplies/
// Other entry form + table, the Misc/Special Items ledger, and a
// "Close a month" control with reimbursement history. Self-contained:
// fetches its own data from /api/my-expenses, /api/my-expenses/payouts,
// and /api/admin/mileage-rate -- the same rep-scoped endpoints this panel
// used when it lived inline on /admin/quotes.
//
// Unlike MyCommissionPanel, this always renders (no commission_pct gate --
// any employee can log expenses, not just active reps), so dropping it in
// unconditionally for the admin role means every admin now also sees their
// own expense entry form on /admin/expenses, alongside the admin controls.
// Not a special case -- same "admin role renders both blocks" rule as
// commissions.
//
// Used by:
//   - app/admin/expenses/page.tsx (both the sales-role trimmed view and
//     the admin view, per the role branch in that page)

"use client";

import * as React from "react";

type ExpenseRow = {
  id: number; expense_type: string; miles: string | null; amount_usd: string;
  notes: string | null; created_at: string;
  // Non-null once the row has been swept into a closed reimbursement period,
  // at which point it's locked (no Remove) -- same idea as a locked RFM quote.
  expense_payout_id: number | null;
  period: string | null;
  paid_at: string | null;
  locked: boolean;
};

type ExpensePayoutRow = {
  id: number; period: string; expense_total_usd: string;
  expense_count: number; paid_at: string | null; created_at: string;
};

const EXPENSE_TYPES = ["mileage", "meals", "supplies", "other"] as const;
function expenseTypeLabel(t: string) {
  switch (t) {
    case "mileage": return "Mileage";
    case "meals": return "Meals";
    case "supplies": return "Supplies";
    case "other": return "Other";
    case "misc": return "Misc";
    default: return t;
  }
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtUsd(n: number | string) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default function MyExpensesPanel() {
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
  const [expenseOkMsg, setExpenseOkMsg] = React.useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = React.useState<number | null>(null);

  // Totals come from the API aggregate (whole ledger), not from the page of
  // rows above -- so ?limit= can't silently change the headline number or
  // make it disagree with /admin/expenses.
  const [expensesTotal, setExpensesTotal] = React.useState(0);
  const [expensesOutstanding, setExpensesOutstanding] = React.useState(0);
  const [expensesOutstandingCount, setExpensesOutstandingCount] = React.useState(0);

  // Misc / Special Items -- description + amount only, no type, no miles.
  // Feeds the same expenses ledger (expense_type "misc").
  const [miscDescription, setMiscDescription] = React.useState("");
  const [miscAmount, setMiscAmount] = React.useState("");
  const [miscSubmitting, setMiscSubmitting] = React.useState(false);

  // Reimbursement periods for this rep.
  const [expensePayouts, setExpensePayouts] = React.useState<ExpensePayoutRow[]>([]);
  const [expensePayoutsLoading, setExpensePayoutsLoading] = React.useState(true);
  const [showExpensePayouts, setShowExpensePayouts] = React.useState(false);
  const [expensePeriod, setExpensePeriod] = React.useState(currentPeriod());
  const [closingExpensePeriod, setClosingExpensePeriod] = React.useState(false);

  const loadExpenses = React.useCallback(async () => {
    try {
      const res = await fetch("/api/my-expenses?limit=200", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        setExpenses(json.expenses || []);
        setExpensesTotal(Number(json.total_usd) || 0);
        setExpensesOutstanding(Number(json.outstanding_usd) || 0);
        setExpensesOutstandingCount(Number(json.outstanding_count) || 0);
      }
    } catch { /* silent */ }
    finally { setExpensesLoading(false); }
  }, []);

  const loadExpensePayouts = React.useCallback(async () => {
    try {
      const res = await fetch("/api/my-expenses/payouts", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (json?.ok) setExpensePayouts(json.payouts || []);
    } catch { /* silent */ }
    finally { setExpensePayoutsLoading(false); }
  }, []);

  React.useEffect(() => {
    let active = true;
    loadExpenses();
    loadExpensePayouts();
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
  }, [loadExpenses, loadExpensePayouts]);

  const expenseMilesCalc = Number(expenseMiles);
  const expenseMileageCalcUsd =
    expenseType === "mileage" && Number.isFinite(expenseMilesCalc) && expenseMilesCalc > 0
      ? Math.round(expenseMilesCalc * mileageRate * 100) / 100
      : null;

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setExpenseError(null);
    setExpenseOkMsg(null);

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

  // Misc / Special Items -- description + amount, nothing else. Same ledger,
  // same period close, same admin rollup as every other expense.
  async function submitMiscExpense(e: React.FormEvent) {
    e.preventDefault();
    setExpenseError(null);
    setExpenseOkMsg(null);

    const description = miscDescription.trim();
    if (!description) { setExpenseError("Description is required."); return; }

    setMiscSubmitting(true);
    try {
      const res = await fetch("/api/my-expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expense_type: "misc",
          description,
          amount_usd: Number(miscAmount),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || "Failed to add item.");
      }
      setMiscDescription("");
      setMiscAmount("");
      await loadExpenses();
    } catch (err: any) {
      setExpenseError(err?.message || "Failed to add item.");
    } finally {
      setMiscSubmitting(false);
    }
  }

  async function deleteExpense(id: number) {
    setDeletingExpenseId(id);
    setExpenseOkMsg(null);
    try {
      const res = await fetch(`/api/my-expenses?id=${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Delete failed");
      await loadExpenses();
    } catch (err: any) {
      setExpenseError(err?.message || "Failed to delete expense.");
      // A 409 means the row got locked by a close in another tab -- resync so
      // the stale Remove button disappears.
      await loadExpenses();
    } finally {
      setDeletingExpenseId(null);
    }
  }

  // Closes a reimbursement period for this rep: captures every expense not
  // already in a closed period, whatever month it was logged in.
  async function closeExpensePeriod() {
    if (!/^\d{4}-\d{2}$/.test(expensePeriod)) { setExpenseError("Invalid period."); return; }
    setClosingExpensePeriod(true);
    setExpenseError(null);
    setExpenseOkMsg(null);
    try {
      const res = await fetch("/api/my-expenses/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: expensePeriod }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.message || "Close failed");
      setExpenseOkMsg(
        `Closed ${formatPeriod(expensePeriod)} — ${json.result?.swept ?? 0} expense(s) captured, ` +
        `$${fmtUsd(json.result?.expense_total_usd ?? 0)} submitted for reimbursement.`,
      );
      setShowExpensePayouts(true);
      await Promise.all([loadExpenses(), loadExpensePayouts()]);
    } catch (err: any) {
      setExpenseError(err?.message || "Failed to close period.");
    } finally {
      setClosingExpensePeriod(false);
    }
  }

  const miscExpenses = expenses.filter((e) => e.expense_type === "misc");
  const standardExpenses = expenses.filter((e) => e.expense_type !== "misc");
  const unreimbursedExpensePayouts = expensePayouts.filter((p) => !p.paid_at);
  const unreimbursedExpenseTotal = unreimbursedExpensePayouts.reduce(
    (s, p) => s + Number(p.expense_total_usd), 0,
  );

  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">Expenses</p>
        <div className="flex items-center gap-4">
          <p className="text-[11px] text-[var(--text-faint)]">
            Not yet submitted: <span className="font-semibold text-[var(--text-primary)]">${fmtUsd(expensesOutstanding)}</span>
            {expensesOutstandingCount > 0 && <span> · {expensesOutstandingCount} item{expensesOutstandingCount !== 1 ? "s" : ""}</span>}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">
            Total: <span className="font-semibold text-[var(--text-primary)]">${fmtUsd(expensesTotal)}</span>
          </p>
        </div>
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
      {expenseOkMsg && (
        <p className="mb-3 text-xs text-[var(--status-success-text)]">{expenseOkMsg}</p>
      )}

      {expensesLoading ? (
        <p className="text-xs text-[var(--text-faint)]">Loading…</p>
      ) : standardExpenses.length === 0 ? (
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
              {standardExpenses.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2 px-3 text-[var(--text-muted)]">{new Date(e.created_at).toLocaleDateString()}</td>
                  <td className="py-2 pr-3 text-[var(--text-primary)]">{expenseTypeLabel(e.expense_type)}</td>
                  <td className="py-2 pr-3 text-[var(--text-secondary)]">{e.notes || "—"}</td>
                  <td className="py-2 pr-3 text-right text-[var(--text-muted)]">{e.miles != null ? Number(e.miles).toFixed(1) : "—"}</td>
                  <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">${fmtUsd(e.amount_usd)}</td>
                  <td className="py-2 pr-0 text-right">
                    {e.locked ? (
                      <span
                        className="text-[11px] text-[var(--text-faint)]"
                        title={`Submitted in ${e.period ? formatPeriod(e.period) : "a closed period"} — locked`}
                      >
                        🔒 {e.paid_at ? "Reimbursed" : "Submitted"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => deleteExpense(e.id)}
                        disabled={deletingExpenseId === e.id}
                        className="text-[11px] text-[var(--text-faint)] hover:text-[var(--attention)] disabled:opacity-50"
                      >
                        {deletingExpenseId === e.id ? "…" : "Remove"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Misc / Special Items -- separate entry form and mini-table, but
          the same ledger underneath: these amounts count toward the total
          above, the same period close, and the same admin rollup. */}
      <div className="mt-6 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] p-4">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">Misc / Special Items</p>
        <p className="mb-3 text-[11px] text-[var(--text-faint)]">
          One-off items that don&apos;t fit a type. Counts toward the same total and the same reimbursement period.
        </p>

        <form onSubmit={submitMiscExpense} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="block flex-1 min-w-[8rem]">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Description</div>
            <input
              type="text"
              value={miscDescription}
              onChange={(e) => setMiscDescription(e.target.value)}
              placeholder="e.g. replacement sample case"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
            />
          </label>

          <label className="block">
            <div className="mb-1 text-[11px] text-[var(--text-muted)]">Amount ($)</div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={miscAmount}
              onChange={(e) => setMiscAmount(e.target.value)}
              placeholder="0.00"
              className="w-24 rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
            />
          </label>

          <button
            type="submit"
            disabled={miscSubmitting}
            className="inline-flex items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {miscSubmitting ? "Adding…" : "Add item"}
          </button>
        </form>

        {expensesLoading ? (
          <p className="text-xs text-[var(--text-faint)]">Loading…</p>
        ) : miscExpenses.length === 0 ? (
          <p className="text-xs text-[var(--text-faint)]">No misc items yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface-card)]">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
                <tr>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-0"></th>
                </tr>
              </thead>
              <tbody>
                {miscExpenses.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 px-3 text-[var(--text-muted)]">{new Date(e.created_at).toLocaleDateString()}</td>
                    <td className="py-2 pr-3 text-[var(--text-secondary)]">{e.notes || "—"}</td>
                    <td className="py-2 pr-3 text-right font-medium text-[var(--text-primary)]">${fmtUsd(e.amount_usd)}</td>
                    <td className="py-2 pr-0 text-right">
                      {e.locked ? (
                        <span
                          className="text-[11px] text-[var(--text-faint)]"
                          title={`Submitted in ${e.period ? formatPeriod(e.period) : "a closed period"} — locked`}
                        >
                          🔒 {e.paid_at ? "Reimbursed" : "Submitted"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => deleteExpense(e.id)}
                          disabled={deletingExpenseId === e.id}
                          className="text-[11px] text-[var(--text-faint)] hover:text-[var(--attention)] disabled:opacity-50"
                        >
                          {deletingExpenseId === e.id ? "…" : "Remove"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Close a month -- captures everything outstanding, whatever month
          it was logged in, and locks those line items. */}
      <div className="mt-6 border-t border-[var(--border)] pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-widest text-[var(--text-muted)]">Close a month</p>
          {expensePayouts.length > 0 && (
            <button
              type="button"
              onClick={() => setShowExpensePayouts((v) => !v)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              {showExpensePayouts ? "Hide history" : "View reimbursement history"}
              {unreimbursedExpensePayouts.length > 0 && !showExpensePayouts && (
                <span className="ml-1.5 rounded-full bg-[var(--status-pending-bg)] px-1.5 py-0.5 text-[10px] text-[var(--status-pending-text)]">
                  {unreimbursedExpensePayouts.length} unreimbursed
                </span>
              )}
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Submits every expense above that isn&apos;t already in a closed period — including misc items, and
          whatever month each one was logged in. Those line items lock once submitted.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={expensePeriod}
            onChange={(e) => setExpensePeriod(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
          />
          <button
            type="button"
            onClick={closeExpensePeriod}
            disabled={closingExpensePeriod || expensesOutstandingCount === 0}
            className="inline-flex items-center justify-center rounded-md bg-[var(--action-primary)] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {closingExpensePeriod ? "Closing…" : `Close ${formatPeriod(expensePeriod)}`}
          </button>
          {expensesOutstandingCount === 0 && (
            <span className="text-[11px] text-[var(--text-faint)]">Nothing outstanding to submit.</span>
          )}
        </div>

        {showExpensePayouts && (
          <div className="mt-4">
            {expensePayoutsLoading && <p className="text-xs text-[var(--text-faint)]">Loading…</p>}
            {!expensePayoutsLoading && expensePayouts.length === 0 && (
              <p className="text-xs text-[var(--text-faint)]">No closed periods yet.</p>
            )}
            {!expensePayoutsLoading && expensePayouts.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-[var(--border)] text-[var(--text-faint)]">
                    <tr>
                      <th className="py-2 px-3">Period</th>
                      <th className="py-2 pr-3 text-right">Expenses</th>
                      <th className="py-2 pr-3 text-right">Total</th>
                      <th className="py-2 pr-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expensePayouts.map((p) => (
                      <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 px-3 font-medium text-[var(--text-primary)]">{formatPeriod(p.period)}</td>
                        <td className="py-2 pr-3 text-right text-[var(--text-muted)]">{p.expense_count}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-[var(--text-primary)]">${fmtUsd(p.expense_total_usd)}</td>
                        <td className="py-2 pr-3 text-right">
                          {p.paid_at
                            ? <span className="text-[var(--status-success-text)]">Reimbursed ✓ <span className="text-[var(--text-faint)]">{new Date(p.paid_at).toLocaleDateString()}</span></span>
                            : <span className="text-[var(--status-pending-text)]">Unreimbursed</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-[var(--border-strong)]">
                    <tr>
                      <td colSpan={2} className="py-2 px-3 text-[11px] text-[var(--text-faint)]">Awaiting reimbursement</td>
                      <td className="py-2 pr-3 text-right font-semibold text-[var(--status-pending-text)]">${fmtUsd(unreimbursedExpenseTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
