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
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
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

        {/* Summary row */}
        <section className="mb-6 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          {/* Coverage summary */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Curve coverage
            </div>

            {loading && !error && (
              <p className="text-xs text-slate-300">
                Loading cushion curve coverage…
              </p>
            )}

            {error && (
              <p className="text-xs text-rose-300">
                Error loading coverage:{" "}
                <span className="font-mono text-[11px]">{error}</span>
              </p>
            )}

            {!loading && !error && stats && (
              <>
                <ul className="space-y-1 text-xs text-slate-300">
                  <li>
                    <span className="font-semibold text-slate-100">
                      {stats.materials_with_curves}
                    </span>{" "}
                    materials with cushion curves loaded.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-100">
                      {stats.materials_missing_curves}
                    </span>{" "}
                    materials missing curves (advisor will skip them).
                  </li>
                  <li>
                    <span className="font-semibold text-slate-100">
                      {stats.distinct_families_with_curves}
                    </span>{" "}
                    distinct material families covered.
                  </li>
                </ul>
                <p className="mt-3 text-[11px] text-slate-500">
                  Counts above come from{" "}
                  <span className="font-mono text-sky-300">
                    materials
                  </span>{" "}
                  +{" "}
                  <span className="font-mono text-sky-300">
                    cushion_curves
                  </span>
                  . Polyethylene and Expanded Polyethylene stay separate here,
                  matching the main quoting engine rules.
                </p>
              </>
            )}

            {!loading && !error && !stats && (
              <p className="text-xs text-slate-300">
                No curve coverage stats available yet.
              </p>
            )}
          </div>

          {/* Advisor notes */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Foam advisor notes
            </div>
            <p className="text-xs text-slate-300">
              The foam advisor relies on well-formed cushion curves per
              material. For each curve, the advisor needs:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-slate-300">
              <li>Static load ranges (psi) the material can support.</li>
              <li>Recommended deflection percentages for optimum G-levels.</li>
              <li>
                A clear flag for which ranges are &quot;green&quot; (good),
                &quot;yellow&quot; (borderline), and &quot;red&quot; (avoid).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Future: one-click jump from a quote into the curve used by the
              advisor for that recommendation.
            </p>
          </div>
        </section>

        {/* Main content: materials + selected curve copy */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Materials with curves */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Materials &amp; curve coverage
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Live list of active materials and whether cushion curves are
                  connected. Click a material name to open its full curve
                  viewer.
                </p>
              </div>
              <div className="text-[11px] text-slate-500">
                Future: filters, search &amp; &quot;missing curves&quot; view.
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Material</th>
                    <th className="px-3 py-2 font-semibold">Family</th>
                    <th className="px-3 py-2 font-semibold">Density</th>
                    <th className="px-3 py-2 font-semibold">Curve status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !error && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        Loading materials…
                      </td>
                    </tr>
                  )}

                  {!loading && error && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-rose-300"
                      >
                        Unable to load materials.
                      </td>
                    </tr>
                  )}

                  {!loading && !error && !hasData && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-xs text-slate-400"
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
                          className="border-t border-slate-800/60 hover:bg-slate-900/70"
                        >
                          <td className="px-3 py-2 text-xs text-slate-100">
                            <Link
                              href={`/admin/cushion/curves/${m.material_id}`}
                              className="underline-offset-2 hover:underline text-sky-300"
                            >
                              {m.material_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {m.material_family || (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-200">
                            {formattedDensity ? (
                              <span>{formattedDensity} pcf</span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                                m.has_curve
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                                  : "bg-rose-500/15 text-rose-300 border border-rose-500/40"
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

            <p className="mt-3 text-[11px] text-slate-500">
              Polyethylene and Expanded Polyethylene are treated as separate
              families here, matching the main quoting engine rules.
            </p>
          </div>

          {/* Right-hand copy block stays descriptive for now */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Selected curve (concept)
            </div>
            <p className="text-xs text-slate-300">
              Today this panel is just descriptive copy. In a follow-up step, it
              can show a curve preview for a selected material from the table —
              similar to the foam advisor, but admin-only.
            </p>

            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-slate-100">
                  Example: 1.7# Black PE
                </div>
                <div className="text-[11px] text-slate-400">
                  Family:{" "}
                  <span className="font-medium text-slate-200">
                    Polyethylene
                  </span>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-300">
                Typical working range around{" "}
                <span className="font-semibold text-slate-100">
                  0.6–1.2 psi
                </span>{" "}
                at{" "}
                <span className="font-semibold text-slate-100">
                  15–25% deflection
                </span>{" "}
                for many electronics and medical devices. The foam advisor will
                pick a point on this curve based on product weight, footprint,
                and desired drop height.
              </p>
              <p className="mt-2 text-[11px] text-slate-500">
                Future: a straight-line chart behind this text with marked
                &quot;green&quot; operating zones and labels for key G-level
                thresholds.
              </p>
            </div>

            <p className="mt-4 text-[11px] text-slate-500">
              Admin only – not visible to customers. This is the sandbox to
              validate curve inputs before they drive live recommendations.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
