// app/admin/logs/page.tsx
//
// Logs & events admin landing page.
// Path A / Straight Path safe: UI-only, read-only.
// - No log queries, no writes.
// - Static sample event list for webhooks, orchestrator, and email.

import Link from "next/link";

export default function AdminLogsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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

        {/* Summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Status summary (sample) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Event overview (sample)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">42</span> recent
                events across all systems.
              </li>
              <li>
                <span className="font-semibold text-slate-100">37</span>{" "}
                succeeded,{" "}
                <span className="font-semibold text-slate-100">5</span> flagged
                with warnings or errors.
              </li>
              <li>
                Sources include HubSpot webhooks, AI orchestrator, and email
                (Graph).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Numbers shown here are static placeholders. In a later phase,
              this will connect to real log storage.
            </p>
          </div>

          {/* Debugging notes */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Debugging workflow
            </div>
            <p className="text-xs text-slate-300">
              This view is meant to be the first stop when something feels off:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-300">
              <li>Confirm HubSpot webhooks are arriving cleanly.</li>
              <li>
                Check AI orchestrator responses and any parsing or pricing
                errors.
              </li>
              <li>Verify outbound email (Graph) sends and loop protection.</li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Future: filters by source, status, and quote number to jump
              directly from logs into related quotes.
            </p>
          </div>
        </section>

        {/* Event list (sample) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Recent events (sample rows)
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Static example log entries for webhooks, orchestrator, and
                email send flow.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Future: time range picker &amp; advanced filters.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Source</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Quote #</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {sampleEvents.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-t border-slate-800/60 hover:bg-slate-900/70"
                  >
                    <td className="px-3 py-2 text-[11px] text-slate-400">
                      {ev.time}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {ev.source}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {ev.type}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-100">
                      {ev.quoteNo ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                          ev.status === "OK"
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                            : ev.status === "Warning"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : "bg-rose-500/15 text-rose-300 border border-rose-500/40"
                        }`}
                      >
                        {ev.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-300">
                      {ev.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            These rows show the structure we&apos;ll use when logs are wired to
            real storage. Each event will be linkable to deeper drill-downs
            (quote, webhook payload, orchestrator response, etc.).
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}

type SampleEvent = {
  id: string;
  time: string;
  source: string;
  type: string;
  quoteNo?: string;
  status: "OK" | "Warning" | "Error";
  details: string;
};

const sampleEvents: SampleEvent[] = [
  {
    id: "1",
    time: "Today • 3:24 PM",
    source: "HubSpot webhook",
    type: "New conversation",
    quoteNo: "2025-00123",
    status: "OK",
    details: "Inbound email parsed, quote created, layout editor ready.",
  },
  {
    id: "2",
    time: "Today • 3:25 PM",
    source: "AI orchestrator",
    type: "Quote pipeline",
    quoteNo: "2025-00123",
    status: "Warning",
    details: "Parsed dims with low confidence on cavity depth.",
  },
  {
    id: "3",
    time: "Today • 3:26 PM",
    source: "Email (Graph)",
    type: "Send reply",
    quoteNo: "2025-00123",
    status: "OK",
    details: "First-response quote email sent to customer.",
  },
  {
    id: "4",
    time: "Today • 2:02 PM",
    source: "Pricing engine",
    type: "Price calc",
    quoteNo: "2025-00121",
    status: "Error",
    details: "Material not found in active price book (sample error).",
  },
  {
    id: "5",
    time: "Yesterday • 5:18 PM",
    source: "HubSpot webhook",
    type: "Ping",
    status: "OK",
    details: "Test webhook received and acknowledged.",
  },
];
