// app/admin/page.tsx
//
// Admin home dashboard (read-only navigation hub).
// Path A / Straight Path safe: NEW FILE ONLY.
// - No changes to parsing, pricing, quote print, or layout editor.
// - Read-only: no data writes, just navigation + placeholder labels.
//
// Sections:
//  - Header: "Alex-IO Admin" + subtitle
//  - System health row: Database / HubSpot / Email (Graph)
//  - Main tiles: links to key admin areas
//
// Style:
//  - Dark slate background, sky accents
//  - Simple, clean cards aligned with existing brand tone

import Link from "next/link";

export default function AdminHomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-8 border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-sky-300">
            Alex-IO Admin
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Internal tools for quotes, layouts, pricing &amp; foam data.
          </p>
        </header>

        {/* System health row */}
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            System Health
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Database card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Database
              </div>
              <div className="text-sm text-slate-100">Status: Unknown</div>
              <div className="mt-1 text-xs text-slate-400">
                Tests coming soon.
              </div>
            </div>

            {/* HubSpot card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                HubSpot
              </div>
              <div className="text-sm text-slate-100">Status: Unknown</div>
              <div className="mt-1 text-xs text-slate-400">
                Tests coming soon.
              </div>
            </div>

            {/* Email (Graph) card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Email (Graph)
              </div>
              <div className="text-sm text-slate-100">Status: Unknown</div>
              <div className="mt-1 text-xs text-slate-400">
                Tests coming soon.
              </div>
            </div>
          </div>
        </section>

        {/* Main navigation tiles */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Admin Areas
          </h2>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Materials & densities */}
            <NavCard
              href="/admin/materials"
              title="Materials & densities"
              description="Manage foam materials, families, densities, and active status used for quoting."
            />

            {/* Cushion curves */}
            <NavCard
              href="/admin/cushion-curves"
              title="Cushion curves"
              description="Review and maintain cushion curve data that powers the foam advisor and recommendations."
            />

            {/* Pricing / price books */}
            <NavCard
              href="/admin/pricing"
              title="Pricing & price books"
              description="View price books and run pricing sandbox tests without affecting real quotes."
            />

            {/* Quotes & layouts */}
            <NavCard
              href="/admin/quotes"
              title="Quotes & layouts"
              description="Engineering view of quotes, layouts, and CAD exports for internal review."
            />

            {/* Logs */}
            <NavCard
              href="/admin/logs"
              title="Logs & events"
              description="Inspect webhook events, error logs, and other system diagnostics."
            />
          </div>
        </section>
      </div>
    </main>
  );
}

type NavCardProps = {
  href: string;
  title: string;
  description: string;
};

function NavCard({ href, title, description }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm transition hover:border-sky-400/70 hover:bg-slate-900"
    >
      <div className="mb-2 text-sm font-semibold text-slate-100 group-hover:text-sky-300">
        {title}
      </div>
      <p className="flex-1 text-xs text-slate-300">{description}</p>
      <div className="mt-3 text-[11px] text-slate-500">
        Admin only – not visible to customers.
      </div>
    </Link>
  );
}
