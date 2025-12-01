// app/admin/quotes/page.tsx
//
// Quotes & layouts admin landing page.
// NEW FILE — read-only placeholder. No DB calls, no CAD yet.

import Link from "next/link";

export default function AdminQuotesPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Quotes &amp; layouts
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Engineering-focused view of quotes, foam layouts, and CAD
              downloads for internal use.
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
            In the next phases, this section will:
          </p>
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-300 space-y-1">
            <li>List recent quotes with quick filters and search.</li>
            <li>Open an internal quote detail view with layout previews.</li>
            <li>Provide CAD downloads (DXF / STEP) for engineering.</li>
          </ul>
          <p className="mt-4 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}
