// app/admin/pricing/page.tsx
//
// Pricing / price books admin landing page.
// Path A / Straight Path safe: UI-only, read-only.
// - No DB calls, no writes.
// - Static sample data + layout for price books & sandbox.
//
// NOTE: This does NOT touch any live pricing math. Purely a shell.

import Link from "next/link";

export default function AdminPricingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Pricing &amp; price books
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Internal view of price books, volume breaks, and a future sandbox
              for testing pricing scenarios.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Price books summary (sample) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Price books (sample)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">3</span> sample
                price books configured.
              </li>
              <li>
                <span className="font-semibold text-slate-100">2</span> active
                for quoting;{" "}
                <span className="font-semibold text-slate-100">1</span> legacy /
                archived.
              </li>
              <li>
                Breaks by order volume and density handled inside the pricing
                engine (not touched here).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Counts above are static placeholders to illustrate how this page
              will summarize pricing configuration.
            </p>
          </div>

          {/* Sandbox notes */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Pricing sandbox (future)
            </div>
            <p className="text-xs text-slate-300">
              This area will give you a safe sandbox to test pricing scenarios
              without modifying live quotes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-300">
              <li>Compare pricing across materials and densities.</li>
              <li>Test different order quantities and waste factors.</li>
              <li>
                Validate min charges and price breaks before rolling changes
                into production.
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Pricing math continues to live in the existing engine; this page
              will only orchestrate inputs &amp; display results.
            </p>
          </div>
        </section>

        {/* Price books table (sample) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Price books (sample rows)
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Static sample entries showing how price books and their scopes
                will be displayed.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Future: effective dates, cloning, and change history.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Scope</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Volume breaks</th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Effective
                  </th>
                </tr>
              </thead>
              <tbody>
                {samplePriceBooks.map((pb) => (
                  <tr
                    key={pb.name}
                    className="border-t border-slate-800/60 hover:bg-slate-900/70"
                  >
                    <td className="px-3 py-2 text-xs text-slate-100">
                      {pb.name}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {pb.scope}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                          pb.isActive
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                            : "bg-slate-500/20 text-slate-200 border border-slate-500/40"
                        }`}
                      >
                        {pb.isActive ? "Active" : "Archived"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {pb.breaks}
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] text-slate-400">
                      {pb.effective}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            These rows represent how we&apos;ll surface price book metadata.
            Actual price-per-cubic-inch calculations stay in the existing
            pricing engine.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}

type SamplePriceBook = {
  name: string;
  scope: string;
  isActive: boolean;
  breaks: string;
  effective: string;
};

const samplePriceBooks: SamplePriceBook[] = [
  {
    name: "Standard Foam Price Book",
    scope: "PE, EPE, PU — standard jobs",
    isActive: true,
    breaks: "≤ 500 pcs, 501–2,500, 2,501+",
    effective: "Jan 1, 2025",
  },
  {
    name: "Medical / Cleanroom",
    scope: "PE & PU — medical accounts",
    isActive: true,
    breaks: "≤ 250 pcs, 251–1,000, 1,001+",
    effective: "Mar 15, 2025",
  },
  {
    name: "Legacy 2023 Price Book",
    scope: "Archived – historical quotes only",
    isActive: false,
    breaks: "Mixed legacy breaks",
    effective: "Jan 1, 2023",
  },
];
