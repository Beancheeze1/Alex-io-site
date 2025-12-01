// app/admin/quotes/page.tsx
//
// Quotes & layouts admin landing page.
// Path A / Straight Path safe: UI-only, read-only.
// - No DB calls, no pricing changes, no layout/editor changes.
// - Static sample data + navigation shell for future wiring.

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminQuotesPage() {
  const router = useRouter();
  const [quoteNoInput, setQuoteNoInput] = React.useState("");

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = quoteNoInput.trim();
    if (!trimmed) return;

    // Future target: /admin/quotes/[quote_no]
    router.push(`/admin/quotes/${encodeURIComponent(trimmed)}`);
  }

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
            <Link
              href="/admin"
              className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
            >
              &larr; Back to admin home
            </Link>
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
              (layouts + CAD). This is a shell for the upcoming
              <span className="font-mono text-[11px] text-sky-300">
                {" "}
                /admin/quotes/[quote_no]
              </span>{" "}
              page.
            </p>
            <form
              onSubmit={handleJumpSubmit}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="text"
                value={quoteNoInput}
                onChange={(e) => setQuoteNoInput(e.target.value)}
                placeholder="e.g. 2025-00123"
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

          {/* Summary card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Summary (sample data)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">128</span>{" "}
                quotes total (sample).
              </li>
              <li>
                <span className="font-semibold text-slate-100">8</span> quotes
                updated in the last 24 hours (sample).
              </li>
              <li>
                <span className="font-semibold text-slate-100">3</span> quotes
                awaiting engineering review (sample).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              All counts are static placeholders for now — wiring to real data
              will come later.
            </p>
          </div>
        </section>

        {/* Recent quotes (sample table) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent quotes (sample)
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Static sample rows to show how the internal quotes list will
                look once connected.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Future: filters, search &amp; status chips.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Quote #</th>
                  <th className="px-3 py-2 font-semibold">Customer</th>
                  <th className="px-3 py-2 font-semibold">Job</th>
                  <th className="px-3 py-2 font-semibold">Material</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {sampleQuotes.map((q) => (
                  <tr
                    key={q.quoteNo}
                    className="border-t border-slate-800/60 hover:bg-slate-900/70"
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-sky-300">
                      {q.quoteNo}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-100">
                      {q.customer}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {q.job}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {q.material}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                          q.status === "Engineering"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : q.status === "Sent"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                            : "bg-slate-500/20 text-slate-200 border border-slate-500/40"
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-slate-400">
                      {q.updated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Rows above are static examples only. In a later phase, this table
            will be backed by real quote data, with filters, search, and direct
            links into engineering layouts &amp; CAD downloads.
          </p>
        </section>
      </div>
    </main>
  );
}

type SampleQuote = {
  quoteNo: string;
  customer: string;
  job: string;
  material: string;
  status: "Draft" | "Engineering" | "Sent";
  updated: string;
};

const sampleQuotes: SampleQuote[] = [
  {
    quoteNo: "2025-00123",
    customer: "Acme Medical Devices",
    job: '10" x 10" x 3" PE set',
    material: '1.7# Black Polyethylene',
    status: "Engineering",
    updated: "Today • 3:24 PM",
  },
  {
    quoteNo: "2025-00122",
    customer: "Riverstone Electronics",
    job: "Foam tray for sensor module",
    material: "EPE Type III",
    status: "Sent",
    updated: "Today • 10:41 AM",
  },
  {
    quoteNo: "2025-00121",
    customer: "Summit Instruments",
    job: "Reusable shipping set",
    material: "1030 Char Polyurethane",
    status: "Draft",
    updated: "Yesterday • 4:12 PM",
  },
  {
    quoteNo: "2025-00120",
    customer: "Northline Packaging",
    job: "Corner blocks for crate",
    material: "2.2# White Polyethylene",
    status: "Sent",
    updated: "Yesterday • 9:05 AM",
  },
];
