// app/admin/cushion-curves/page.tsx
//
// Cushion curves admin landing page.
// Path A / Straight Path safe: UI-only, read-only.
// - No DB calls, no writes.
// - Static sample data to show how curve coverage + details will appear.

import Link from "next/link";

export default function AdminCushionCurvesPage() {
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
              Curve coverage (sample)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">12</span>{" "}
                materials with cushion curves loaded.
              </li>
              <li>
                <span className="font-semibold text-slate-100">3</span>{" "}
                materials missing curves (advisor will skip them).
              </li>
              <li>
                <span className="font-semibold text-slate-100">4</span> distinct
                material families covered (PE, EPE, PU, others).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Counts above are static examples. This page will eventually
              connect to real curve data and highlight any gaps.
            </p>
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

        {/* Main content: materials + selected curve */}
        <section className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Materials with curves */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Materials with curves (sample rows)
                </div>
                <p className="mt-1 text-xs text-slate-300">
                  Static example list showing which materials have cushion
                  curves connected and how coverage looks at a glance.
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
                  {sampleCurveMaterials.map((m) => (
                    <tr
                      key={m.materialName}
                      className="border-t border-slate-800/60 hover:bg-slate-900/70"
                    >
                      <td className="px-3 py-2 text-xs text-slate-100">
                        {m.materialName}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {m.materialFamily}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {m.density}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                            m.hasCurve
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                              : "bg-rose-500/15 text-rose-300 border border-rose-500/40"
                          }`}
                        >
                          {m.hasCurve ? "Curve loaded" : "Missing curve"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] text-slate-500">
              Polyethylene and Expanded Polyethylene are treated as separate
              families here, matching the main quoting engine rules.
            </p>
          </div>

          {/* Selected curve (sample) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Selected curve (sample)
            </div>
            <p className="text-xs text-slate-300">
              Imagine this panel showing a curve preview for a selected
              material from the table — similar to the foam advisor:
            </p>

            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-xs font-semibold text-slate-100">
                  1.7# Black PE
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
                Future: straight-line chart behind this text with marked
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

type SampleCurveMaterial = {
  materialName: string;
  materialFamily: string;
  density: string;
  hasCurve: boolean;
};

const sampleCurveMaterials: SampleCurveMaterial[] = [
  {
    materialName: "1.7# Black PE",
    materialFamily: "Polyethylene",
    density: "1.7 pcf",
    hasCurve: true,
  },
  {
    materialName: "2.2# White PE",
    materialFamily: "Polyethylene",
    density: "2.2 pcf",
    hasCurve: true,
  },
  {
    materialName: "EPE Type III",
    materialFamily: "Expanded Polyethylene",
    density: "approx. 1.9 pcf",
    hasCurve: true,
  },
  {
    materialName: "1030 Char",
    materialFamily: "Polyurethane Foam",
    density: "nominal PU",
    hasCurve: false,
  },
];
