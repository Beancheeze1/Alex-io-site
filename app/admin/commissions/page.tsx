// app/admin/commissions/page.tsx
//
// Admin commissions overview.
// Shows each sales rep with a sales_slug, their quote total, commission %, and earned amount.

"use client";

import * as React from "react";
import Link from "next/link";

type CommissionRow = {
  user_id: number;
  name: string;
  email: string;
  sales_slug: string;
  commission_pct: number | null;
  quote_count: number;
  quotes_total_usd: number;
  commission_usd: number;
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AdminCommissionsPage() {
  const [rows, setRows] = React.useState<CommissionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/commissions", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/login?next=/admin/commissions";
        return;
      }
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Unknown error");
      setRows(json.rows || []);
    } catch (err: any) {
      setError(err.message || "Failed to load commissions.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { load(); }, []);

  const totalQuotes = rows.reduce((s, r) => s + Number(r.quotes_total_usd), 0);
  const totalCommission = rows.reduce((s, r) => s + Number(r.commission_usd), 0);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto max-w-6xl px-4 py-8">

        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Commissions
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              Quote totals and commission amounts by sales rep.
              Set commission rates in{" "}
              <Link href="/admin" className="text-sky-400 hover:underline">
                Admin → Users
              </Link>.
            </p>
          </div>
          <button
            onClick={load}
            className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-800"
          >
            Refresh
          </button>
        </header>

        {/* Summary tiles */}
        {!loading && rows.length > 0 && (
          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-neutral-400">Reps tracked</p>
              <p className="mt-2 text-2xl font-semibold text-neutral-50">{rows.length}</p>
            </div>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-neutral-400">All-rep quotes total</p>
              <p className="mt-2 text-2xl font-semibold text-neutral-50">${fmt(totalQuotes)}</p>
            </div>
            <div className="rounded-2xl border border-sky-800/50 bg-sky-950/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-sky-400">Total commission owed</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-300">${fmt(totalCommission)}</p>
            </div>
          </section>
        )}

        {/* Table */}
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
          {loading && (
            <p className="text-sm text-neutral-400">Loading…</p>
          )}
          {error && !loading && (
            <p className="text-sm text-rose-300">{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="py-8 text-center text-sm text-neutral-400">
              No sales reps with a sales slug found, or none have quotes yet.
              <br />
              <span className="text-xs text-neutral-500">
                Assign sales slugs and commission rates in Admin → Users.
              </span>
            </div>
          )}
          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-neutral-800 text-neutral-400">
                  <tr>
                    <th className="py-2 pr-4">Rep</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Slug</th>
                    <th className="py-2 pr-4 text-right">Quotes</th>
                    <th className="py-2 pr-4 text-right">Quotes total</th>
                    <th className="py-2 pr-4 text-right">Commission %</th>
                    <th className="py-2 pr-0 text-right">Commission $</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.user_id}
                      className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/70"
                    >
                      <td className="py-2 pr-4 font-medium text-neutral-100">{r.name}</td>
                      <td className="py-2 pr-4 text-neutral-400">{r.email}</td>
                      <td className="py-2 pr-4">
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] text-neutral-300">
                          {r.sales_slug}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-neutral-300">{r.quote_count}</td>
                      <td className="py-2 pr-4 text-right text-neutral-100">${fmt(Number(r.quotes_total_usd))}</td>
                      <td className="py-2 pr-4 text-right">
                        {r.commission_pct != null ? (
                          <span className="text-sky-300">{r.commission_pct}%</span>
                        ) : (
                          <span className="text-neutral-600">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-0 text-right font-semibold text-emerald-300">
                        ${fmt(Number(r.commission_usd))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-neutral-700">
                  <tr>
                    <td colSpan={4} className="py-2 pr-4 text-[11px] text-neutral-500">Totals</td>
                    <td className="py-2 pr-4 text-right font-semibold text-neutral-100">${fmt(totalQuotes)}</td>
                    <td className="py-2 pr-4" />
                    <td className="py-2 pr-0 text-right font-semibold text-emerald-300">${fmt(totalCommission)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
