// app/admin/cushion-curves/page.tsx
//
// Cushion curves admin landing page.
// Wired to /api/cushion-curves for live data.
//
// Path A / Straight Path safe:
//  - Read-only, admin-only.
//  - Does NOT touch foam advisor logic, pricing, or quotes.

"use client";

import * as React from "react";
import Link from "next/link";

type MaterialRow = {
  material_id: number;
  material_name: string;
  material_family: string | null;
  // Comes back from JSON as number | string | null
  density_lb_ft3: number | string | null;
  has_curve: boolean;
  point_count: number;
};

type CushionCurvesResponse = {
  ok: boolean;
  materials: MaterialRow[];
  stats: {
    materials_with_curves: number;
    materials_missing_curves: number;
    distinct_families_with_curves: number;
  };
};

function formatDensity(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const n =
    typeof value === "number"
      ? value
      : Number(value);
  if (Number.isNaN(n)) return null;
  return n.toFixed(2);
}

export default function AdminCushionCurvesPage() {
  const [materials, setMaterials] = React.useState<MaterialRow[]>([]);
  const [stats, setStats] = React.useState<
    CushionCurvesResponse["stats"] | null
  >(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/cushion-curves", {
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json: CushionCurvesResponse = await res.json();

        if (!active) return;

        if (!json.ok) {
          throw new Error("API returned ok=false");
        }

        setMaterials(json.materials || []);
        setStats(json.stats || null);
      } catch (err: any) {
        console.error("Admin cushion-curves load error:", err);
        if (!active) return;
        setError(String(err?.message || "Unable to load cushion curves."));
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

  const hasData = materials.length > 0;

  return (
    <main className="min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              Cushion curves
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Internal tools for viewing and maintaining cushion curve data that
              powers the foam advisor and recommendations.
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
          {/* Coverage summary */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Curve coverage
            </div>

            {loading && !error && (
              <p className="text-xs text-[var(--text-secondary)]">
                Loading cushion curve coverage…
              </p>
            )}

            {error && (
              <p className="text-xs text-[var(--attention)]">
                Error loading coverage:{" "}
                <span className="font-mono text-[11px]">{error}</span>
              </p>
            )}

            {!loading && !error && stats && (
              <>
                <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.materials_with_curves}
                    </span>{" "}
                    materials with cushion curves loaded.
                  </li>
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.materials_missing_curves}
                    </span>{" "}
                    materials missing curves (advisor will skip them).
                  </li>
                  <li>
                    <span className="font-medium text-[var(--text-primary)]">
                      {stats.distinct_families_with_curves}
                    </span>{" "}
                    distinct material families covered.
                  </li>
                </ul>
                <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                  Counts above come from{" "}
                  <span className="font-mono text-[var(--text-secondary)]">
                    materials
                  </span>{" "}
                  +{" "}
                  <span className="font-mono text-[var(--text-secondary)]">
                    cushion_curves
                  </span>
                  . Polyethylene and Expanded Polyethylene stay separate here,
                  matching the main quoting engine rules.
                </p>
              </>
            )}

            {!loading && !error && !stats && (
              <p className="text-xs text-[var(--text-secondary)]">
                No curve coverage stats available yet.
              </p>
            )}
          </div>

          {/* Advisor notes */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Foam advisor notes
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              The foam advisor relies on well-formed cushion curves per
              material. For each curve, the advisor needs:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-[var(--text-secondary)]">
              <li>Static load ranges (psi) the material can support.</li>
              <li>Recommended deflection percentages for optimum G-levels.</li>
              <li>
                A clear flag for which ranges are &quot;green&quot; (good),
                &quot;yellow&quot; (borderline), and &quot;red&quot; (avoid).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Future: one-click jump from a quote into the curve used by the
              advisor for that recommendation.
            </p>
          </div>
        </section>

        {/* Main content: materials + selected curve copy */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Materials with curves */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-sm text-[var(--text-secondary)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  Materials &amp; curve coverage
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Live list of active materials and whether cushion curves are
                  connected. Click a material name to open its full curve
                  viewer.
                </p>
              </div>
              <div className="text-[11px] text-[var(--text-faint)]">
                Future: filters, search &amp; &quot;missing curves&quot; view.
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-page)]">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 font-medium">Family</th>
                    <th className="px-3 py-2 font-medium">Density</th>
                    <th className="px-3 py-2 font-medium">Curve status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !error && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                      >
                        Loading materials…
                      </td>
                    </tr>
                  )}

                  {!loading && error && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-[var(--attention)]"
                      >
                        Unable to load materials.
                      </td>
                    </tr>
                  )}

                  {!loading && !error && !hasData && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-[var(--text-muted)]"
                      >
                        No active materials found.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    !error &&
                    hasData &&
                    materials.map((m) => {
                      const formattedDensity = formatDensity(
                        m.density_lb_ft3,
                      );

                      return (
                        <tr
                          key={m.material_id}
                          className="border-t border-[var(--border)] hover:bg-[var(--surface-subtle)]"
                        >
                          <td className="px-3 py-2 text-xs text-[var(--text-primary)]">
                            <Link
                              href={`/admin/cushion-curves/${m.material_id}`}
                              className="underline-offset-2 hover:underline text-[var(--text-primary)]"
                            >
                              {m.material_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                            {m.material_family || (
                              <span className="text-[var(--text-faint)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                            {formattedDensity ? (
                              <span>{formattedDensity} pcf</span>
                            ) : (
                              <span className="text-[var(--text-faint)]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                                m.has_curve
                                  ? "bg-[var(--status-success-bg)] text-[var(--status-success-text)] border border-[var(--status-success-text)]/30"
                                  : "bg-[var(--attention-bg)] text-[var(--attention)] border border-[var(--attention-border)]"
                              }`}
                            >
                              {m.has_curve
                                ? `${m.point_count} pt curve`
                                : "Missing curve"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Polyethylene and Expanded Polyethylene are treated as separate
              families here, matching the main quoting engine rules.
            </p>
          </div>

          {/* Right-hand copy block stays descriptive for now */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5 text-sm text-[var(--text-secondary)]">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Selected curve (concept)
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Today this panel is just descriptive copy. In a follow-up step, it
              can show a curve preview for a selected material from the table —
              similar to the foam advisor, but admin-only.
            </p>

            <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-page)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-medium text-[var(--text-primary)]">
                  Example: 1.7# Black PE
                </div>
                <div className="text-[11px] text-[var(--text-faint)]">
                  Family:{" "}
                  <span className="font-medium text-[var(--text-secondary)]">
                    Polyethylene
                  </span>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Typical working range around{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  0.6–1.2 psi
                </span>{" "}
                at{" "}
                <span className="font-medium text-[var(--text-primary)]">
                  15–25% deflection
                </span>{" "}
                for many electronics and medical devices. The foam advisor will
                pick a point on this curve based on product weight, footprint,
                and desired drop height.
              </p>
              <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                Future: a straight-line chart behind this text with marked
                &quot;green&quot; operating zones and labels for key G-level
                thresholds.
              </p>
            </div>

            <p className="mt-4 text-[11px] text-[var(--text-faint)]">
              Admin only – not visible to customers. This is the sandbox to
              validate curve inputs before they drive live recommendations.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
