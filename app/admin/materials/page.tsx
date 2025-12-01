// app/admin/materials/page.tsx
//
// Materials & densities admin landing page.
// Path A / Straight Path safe: UI-only, read-only.
// - No DB calls, no writes.
// - Static sample data + layout to demonstrate the catalog.
//
// IMPORTANT:
//  - Polyethylene and Expanded Polyethylene are shown as separate families,
//    matching the real rule used elsewhere in the system.

import Link from "next/link";

export default function AdminMaterialsPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-10">
        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sky-300">
              Materials &amp; densities
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Internal catalog of foam materials, families, densities, and
              active status used for quoting.
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
          {/* Families summary (sample) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Material families (sample)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">
                  Polyethylene
                </span>{" "}
                — standard closed-cell PE blocks &amp; trays.
              </li>
              <li>
                <span className="font-semibold text-slate-100">
                  Expanded Polyethylene
                </span>{" "}
                — lighter EPE grades, separate family.
              </li>
              <li>
                <span className="font-semibold text-slate-100">
                  Polyurethane Foam
                </span>{" "}
                — open-cell PU for delicate or cosmetic parts.
              </li>
              <li>
                <span className="font-semibold text-slate-100">
                  Other families
                </span>{" "}
                — honeycomb, corrugated, and future materials.
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Counts below are static placeholders for demo purposes.
            </p>
          </div>

          {/* Totals & notes */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Catalog overview (sample)
            </div>
            <ul className="space-y-1 text-xs text-slate-300">
              <li>
                <span className="font-semibold text-slate-100">18</span> active
                materials.
              </li>
              <li>
                <span className="font-semibold text-slate-100">4</span> material
                families in use.
              </li>
              <li>
                <span className="font-semibold text-slate-100">3</span>{" "}
                materials currently inactive (legacy / deprecated).
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-500">
              Future: filters by family, density, and active status; inline
              edit controls guarded behind admin roles.
            </p>
          </div>
        </section>

        {/* Materials table (sample) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Materials catalog (sample rows)
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Static sample entries showing how materials, families, densities
                and active status will be displayed.
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              Future: search, filters, and pagination.
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-800/80 bg-slate-950/40">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-semibold">Material name</th>
                  <th className="px-3 py-2 font-semibold">Family</th>
                  <th className="px-3 py-2 font-semibold">Density</th>
                  <th className="px-3 py-2 font-semibold">Active</th>
                  <th className="px-3 py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {sampleMaterials.map((m) => (
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
                          m.isActive
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                            : "bg-slate-500/20 text-slate-200 border border-slate-500/40"
                        }`}
                      >
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-400">
                      {m.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Rows above mirror the structure we&apos;ll use when wiring this page
            to the real{" "}
            <span className="font-mono text-[11px] text-sky-300">
              materials
            </span>{" "}
            table in the database. Edits will remain admin-only.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}

type SampleMaterial = {
  materialName: string;
  materialFamily: string;
  density: string;
  isActive: boolean;
  notes: string;
};

const sampleMaterials: SampleMaterial[] = [
  {
    materialName: "1.7# Black PE",
    materialFamily: "Polyethylene",
    density: "1.7 pcf",
    isActive: true,
    notes: "Workhorse closed-cell PE for general packaging.",
  },
  {
    materialName: "2.2# White PE",
    materialFamily: "Polyethylene",
    density: "2.2 pcf",
    isActive: true,
    notes: "Higher density PE for heavier components.",
  },
  {
    materialName: "EPE Type III",
    materialFamily: "Expanded Polyethylene",
    density: "approx. 1.9 pcf",
    isActive: true,
    notes: "Expanded Polyethylene — separate family from PE.",
  },
  {
    materialName: "1030 Char",
    materialFamily: "Polyurethane Foam",
    density: "nominal PU",
    isActive: true,
    notes: "Charcoal PU, good for instrument cases.",
  },
  {
    materialName: "Retired PE Grade X",
    materialFamily: "Polyethylene",
    density: "2.0 pcf",
    isActive: false,
    notes: "Inactive legacy material kept for historical quotes.",
  },
];
