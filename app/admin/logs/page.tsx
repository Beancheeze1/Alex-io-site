// app/admin/logs/page.tsx
//
// Logs & events admin landing page.
// NEW FILE — read-only placeholder. No log queries yet.

import Link from "next/link";

export default function AdminLogsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Logs &amp; events
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Central place to inspect webhook calls, errors, and other system
              diagnostics.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Placeholder content */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <p>
            This page will become the cockpit for:
          </p>
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-300 space-y-1">
            <li>Viewing recent webhook events and their status.</li>
            <li>Inspecting error logs for orchestrator, pricing, and email.</li>
            <li>Eventually: targeted filters and quick drill-ins for debugging.</li>
          </ul>
          <p className="mt-4 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}
