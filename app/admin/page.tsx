// app/admin/page.tsx
//
// Admin home dashboard (read-only navigation hub).
// Path A / Straight Path safe.
// - No changes to parsing, pricing, quote print, or layout editor.
// - Read-only: no data writes, just navigation + placeholder labels.
//
// Sections:
//  - Header: "Alex-IO Admin" + subtitle
//  - At-a-glance sample metrics (static)
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
        <header className="mb-6 border-b border-slate-800 pb-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-sky-300">
                Alex-IO Admin
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                Internal tools for quotes, layouts, pricing &amp; foam data.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 md:text-right">
              <div>Admin cockpit • Read-only preview</div>
              <div>Sample counts only – production wiring coming soon.</div>
            </div>
          </div>
        </header>

        {/* At-a-glance sample metrics */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            At a glance (sample data)
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Quotes
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-50">
                128
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Sample: total quotes tracked by Alex-IO.
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Active materials
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-50">
                18
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Sample: materials available for quoting.
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Webhook events
              </div>
              <div className="mt-2 text-2xl font-semibold text-slate-50">
                42
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Sample: recent events from HubSpot &amp; email.
              </div>
            </div>
          </div>
        </section>

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
                Tests coming soon (DB connectivity &amp; migrations).
              </div>
            </div>

            {/* HubSpot card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                HubSpot
              </div>
              <div className="text-sm text-slate-100">Status: Unknown</div>
              <div className="mt-1 text-xs text-slate-400">
                Tests coming soon (webhooks &amp; Conversations).
              </div>
            </div>

            {/* Email (Graph) card */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                Email (Graph)
              </div>
              <div className="text-sm text-slate-100">Status: Unknown</div>
              <div className="mt-1 text-xs text-slate-400">
                Tests coming soon (send, receive &amp; loop protection).
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
              sampleDetail="Sample: 18 active materials."
            />

            {/* Cushion curves */}
            <NavCard
              href="/admin/cushion-curves"
              title="Cushion curves"
              description="Review and maintain cushion curve data that powers the foam advisor and recommendations."
              sampleDetail="Sample: 12 materials with curves."
            />

            {/* Pricing / price books */}
            <NavCard
              href="/admin/pricing"
              title="Pricing & price books"
              description="View price books and run pricing sandbox tests without affecting real quotes."
              sampleDetail="Sample: 3 price books configured."
            />

            {/* Quotes & layouts */}
            <NavCard
              href="/admin/quotes"
              title="Quotes & layouts"
              description="Engineering view of quotes, layouts, and CAD exports for internal review."
              sampleDetail="Sample: 8 recent quotes in queue."
            />

            {/* Logs */}
            <NavCard
              href="/admin/logs"
              title="Logs & events"
              description="Inspect webhook events, error logs, and other system diagnostics."
              sampleDetail="Sample: 4 recent error events."
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
  sampleDetail: string;
};

function NavCard({ href, title, description, sampleDetail }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm transition hover:border-sky-400/70 hover:bg-slate-900"
    >
      <div className="mb-1 text-sm font-semibold text-slate-100 group-hover:text-sky-300">
        {title}
      </div>
      <p className="text-xs text-slate-300">{description}</p>
      <div className="mt-2 text-[11px] text-slate-400">{sampleDetail}</div>
      <div className="mt-3 text-[11px] text-slate-500">
        Admin only – not visible to customers.
      </div>
    </Link>
  );
}
