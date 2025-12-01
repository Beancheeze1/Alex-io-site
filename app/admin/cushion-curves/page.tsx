// app/admin/cushion-curves/page.tsx
//
// Cushion curves admin landing page.
// NEW FILE — read-only placeholder, no data access.

import Link from "next/link";

export default function AdminCushionCurvesPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Cushion curves
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Internal tools for viewing and maintaining cushion curve data that
              powers the foam advisor and recommendations.
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
            This area will let you:
          </p>
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-300 space-y-1">
            <li>Browse cushion curves per material and material family.</li>
            <li>Verify that the data behind the foam advisor is correct.</li>
            <li>Eventually: add/edit curve points safely (with tooling around it).</li>
          </ul>
          <p className="mt-4 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}
