// components/admin/TodayPanel.tsx
//
// Step 38D: "Needs you today" on the admin Home: review queue counts, new
// spec requests and the latest quotes. Data comes from the server
// (app/lib/admin-today.ts); this only draws it.

import Link from "next/link";
import type { AdminToday } from "@/app/lib/admin-today";

const TILES: { key: "new" | "to_confirm" | "reapprove" | "proofs" | "needs_review"; label: string }[] = [
  { key: "new", label: "New quotes, not opened" },
  { key: "to_confirm", label: "Accepted, waiting for you to confirm" },
  { key: "reapprove", label: "Price changed since the buyer accepted" },
  { key: "proofs", label: "Proofs: changes requested or waiting" },
  { key: "needs_review", label: "Needs review" },
];

function statusText(status: string | null, locked: boolean): string {
  if (locked) return "Released";
  const s = String(status || "").toLowerCase().trim();
  if (!s) return "Draft";
  if (s === "engineering" || s === "in_progress") return "Engineering";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TodayPanel({ today }: { today: AdminToday }) {
  const tiles = [
    ...TILES.map((t) => ({ href: "/admin/review", label: t.label, n: today.queue ? today.queue[t.key] : null })),
    { href: "/admin/spec-requests", label: "New spec requests (files to quote)", n: today.newSpecRequests },
  ];
  const waiting = tiles.filter((t) => (t.n ?? 0) > 0);
  const unknown = today.queue === null && today.newSpecRequests === null;

  return (
    <section className="mb-10" data-today>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">Needs you today</h2>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-today-queue>
          {unknown ? (
            <p className="text-xs text-[var(--text-secondary)]">
              Couldn&apos;t load the queue right now. <Link href="/admin/review" className="text-[var(--action-primary)] hover:underline">Open the Review queue</Link>
            </p>
          ) : waiting.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Nothing waiting on you. You&apos;re caught up.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {waiting.map((t) => (
                <li key={t.label}>
                  <Link
                    href={t.href}
                    className="flex items-center justify-between gap-3 py-2 text-sm text-[var(--text-primary)] hover:text-[var(--action-primary)]"
                  >
                    <span>{t.label}</span>
                    <span className="rounded-full bg-[var(--attention)] px-2 py-0.5 text-xs font-semibold text-white" data-today-count>
                      {t.n}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-4 border-t border-[var(--border)] pt-3 text-xs">
            <Link href="/admin/review" className="font-medium text-[var(--action-primary)] hover:underline">
              Review queue →
            </Link>
            <Link href="/admin/spec-requests" className="font-medium text-[var(--action-primary)] hover:underline">
              Spec requests →
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-today-latest>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-faint)]">Latest quotes</div>
          {today.latest === null ? (
            <p className="text-xs text-[var(--text-secondary)]">Couldn&apos;t load quotes right now.</p>
          ) : today.latest.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary)]">No quotes yet. They&apos;ll show here as buyers start them.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {today.latest.map((r) => (
                <li key={r.quote_no}>
                  <Link
                    href={`/admin/quotes/${encodeURIComponent(r.quote_no)}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2 text-xs hover:text-[var(--action-primary)]"
                  >
                    <span className="truncate">
                      <span className="font-mono text-[var(--text-primary)]">{r.quote_no}</span>
                      <span className="text-[var(--text-secondary)]"> · {r.customer_name || "No name yet"}</span>
                    </span>
                    <span className="text-right text-[var(--text-muted)]">
                      {statusText(r.status, r.locked)} · {shortDate(r.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-[var(--border)] pt-3 text-xs">
            <Link href="/admin/quotes" className="font-medium text-[var(--action-primary)] hover:underline">
              All quotes →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
