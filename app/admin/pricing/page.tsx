// app/admin/pricing/page.tsx
//
// Pricing / price books admin landing page.
// Now wired to /api/admin/price-books for live data.
//
// Path A / Straight Path safe:
//  - Read-only, admin-only.
//  - Does NOT change any pricing math or live quote behavior.

"use client";

import * as React from "react";
import Link from "next/link";

type PriceBook = {
  id: number;
  name: string;
  scope: string;
  isActive: boolean;
  breaks: string;
  effective: string;
};

type PriceBooksResponse = {
  ok: boolean;
  priceBooks: {
    id: number;
    name: string;
    version: string;
    currency: string;
    created_at: string;
    notes: string | null;
    isActive: boolean;
    scope: string;
    breaks: string;
  }[];
  stats: {
    total: number;
    active: number;
    archived: number;
  };
};

export default function AdminPricingPage() {
  const [priceBooks, setPriceBooks] = React.useState<PriceBook[]>([]);
  const [stats, setStats] = React.useState<
    PriceBooksResponse["stats"] | null
  >(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/admin/price-books", {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json: PriceBooksResponse = await res.json();

        if (!active) return;

        if (!json.ok) {
          throw new Error("API returned ok=false");
        }

        const mapped: PriceBook[] = (json.priceBooks || []).map((pb) => {
          const created = pb.created_at
            ? new Date(pb.created_at)
            : null;

          const effective =
            created && !Number.isNaN(created.getTime())
              ? created.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "—";

          return {
            id: pb.id,
            name: pb.name,
            scope: pb.scope,
            isActive: pb.isActive,
            breaks: pb.breaks,
            effective,
          };
        });

        setPriceBooks(mapped);
        setStats(json.stats || null);
      } catch (err: any) {
        console.error("Admin pricing load error:", err);
        if (!active) return;
        setError(String(err?.message || "Unable to load price books."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const hasBooks = priceBooks.length > 0;

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Pricing &amp; price books
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Internal view of price books, volume breaks, and a future sandbox
              for testing pricing scenarios.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
          >
            &larr; Back to admin home
          </Link>
        </header>

        {/* Summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Price books summary */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Price books
            </div>

            {loading && !error && (
              <p className="text-xs text-[var(--text-secondary)]">
                Loading price book summary…
              </p>
            )}

            {error && (
              <p className="text-xs text-[var(--attention)]">
                Error loading price books:{" "}
                <span className="font-mono text-[11px]">{error}</span>
              </p>
            )}

            {!loading && !error && stats && (
              <>
                <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.total}
                    </span>{" "}
                    price book{stats.total === 1 ? "" : "s"} configured.
                  </li>
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.active}
                    </span>{" "}
                    active for quoting;{" "}
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.archived}
                    </span>{" "}
                    archived.
                  </li>
                  <li>
                    Breaks by order volume and density remain handled inside the
                    pricing engine (not touched here).
                  </li>
                </ul>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Counts above are pulled directly from{" "}
                  <span className="font-mono text-[var(--text-secondary)]">
                    price_books
                  </span>
                  . Actual price-per-cubic-inch math stays in the existing
                  engine.
                </p>
              </>
            )}

            {!loading && !error && !stats && (
              <p className="text-xs text-[var(--text-secondary)]">
                No price book summary is available yet.
              </p>
            )}
          </div>

          {/* Sandbox notes */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Pricing sandbox (future)
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              This area will give you a safe sandbox to test pricing scenarios
              without modifying live quotes:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[var(--text-secondary)]">
              <li>Compare pricing across materials and densities.</li>
              <li>Test different order quantities and waste factors.</li>
              <li>
                Validate min charges and price breaks before rolling changes
                into production.
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Pricing math continues to live in the existing engine; this page
              will only orchestrate inputs &amp; display results.
            </p>
          </div>
        </section>

        {/* Price books table */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-sm text-[var(--text-secondary)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Price books
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Live entries showing how price books and their scopes are
                displayed. This is metadata only; pricing calculations stay in
                the engine.
              </p>
            </div>
            <div className="text-[11px] text-[var(--text-faint)]">
              Future: effective dates, cloning, and change history.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-page)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Volume breaks</th>
                  <th className="px-3 py-2 font-medium text-right">
                    Effective
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                    >
                      Loading price books…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-[var(--attention)]"
                    >
                      Unable to load price books.
                    </td>
                  </tr>
                )}

                {!loading && !error && !hasBooks && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                    >
                      No price books configured yet.
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  hasBooks &&
                  priceBooks.map((pb) => (
                    <tr
                      key={pb.id}
                      className="border-t border-[var(--border)] hover:bg-[var(--surface-subtle)]"
                    >
                      <td className="px-3 py-2 text-xs text-[var(--text-primary)]">
                        {pb.name}
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                        {pb.scope}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                            pb.isActive
                              ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-text)]/30"
                              : "bg-[var(--status-neutral-bg)] text-[var(--status-neutral-text)] border border-[var(--border-strong)]"
                          }`}
                        >
                          {pb.isActive ? "Active" : "Archived"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                        {pb.breaks}
                      </td>
                      <td className="px-3 py-2 text-right text-[11px] text-[var(--text-faint)]">
                        {pb.effective}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-[var(--text-faint)]">
            These rows represent how we&apos;re surfacing price book metadata.
            Actual price-per-cubic-inch calculations stay in the existing
            pricing engine.
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}
