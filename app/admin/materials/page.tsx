// app/admin/materials/page.tsx
//
// Materials & densities admin landing page.
// Path A / Straight Path safe:
//  - UI-only, read-only.
//  - Uses GET /api/materials to show live materials.
//  - No writes, no pricing or layout changes.
//
// IMPORTANT:
//  - Polyethylene and Expanded Polyethylene are shown as separate families,
//    matching the real rule used elsewhere in the system.

"use client";

import * as React from "react";
import Link from "next/link";

type MaterialRow = {
  id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean | null;
};

type MaterialsResponse = {
  ok: boolean;
  materials?: MaterialRow[];
  error?: string;
  message?: string;
};

export default function AdminMaterialsPage() {
  const [materials, setMaterials] = React.useState<MaterialRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    async function loadMaterials() {
      try {
        const res = await fetch("/api/materials", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: MaterialsResponse = await res.json();
        if (!data.ok || !data.materials) {
          throw new Error(data.message || "API returned an error.");
        }
        if (active) {
          setMaterials(data.materials);
          setError(null);
        }
      } catch (err) {
        console.error("Failed to load materials:", err);
        if (active) {
          setError("Unable to load materials list.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadMaterials();

    return () => {
      active = false;
    };
  }, []);

  const totalCount = materials?.length ?? 0;
  const activeCount = materials?.filter((m) => m.is_active)?.length ?? 0;
  const familyCount = materials
    ? new Set(
        materials.map((m) => (m.material_family ? m.material_family : "Unassigned")),
      ).size
    : 0;

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
          {/* Families summary */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Material families
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
              Family labels are driven directly from the{" "}
              <span className="font-mono text-[11px] text-sky-300">
                material_family
              </span>{" "}
              column in the database.
            </p>
          </div>

          {/* Totals & notes (live counts) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-200">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Catalog overview
            </div>

            {error ? (
              <p className="text-xs text-rose-300">{error}</p>
            ) : (
              <ul className="space-y-1 text-xs text-slate-300">
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : totalCount}
                  </span>{" "}
                  materials in the catalog.
                </li>
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : activeCount}
                  </span>{" "}
                  marked active for quoting.
                </li>
                <li>
                  <span className="font-semibold text-slate-100">
                    {loading ? "…" : familyCount}
                  </span>{" "}
                  material families (including &quot;Unassigned&quot;).
                </li>
              </ul>
            )}

            <p className="mt-3 text-[11px] text-slate-500">
              Data above is live from the{" "}
              <span className="font-mono text-[11px] text-sky-300">
                materials
              </span>{" "}
              table via <span className="font-mono text-[11px] text-sky-300">/api/materials</span>. Edits will
              remain admin-only in future phases.
            </p>
          </div>
        </section>

        {/* Materials table (live data) */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-200">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Materials catalog
              </div>
              <p className="mt-1 text-xs text-slate-300">
                Live materials from the database: names, families, densities, and
                active status used for quoting.
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
                {loading && !error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-slate-400"
                    >
                      Loading materials…
                    </td>
                  </tr>
                )}

                {!loading && error && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-rose-300"
                    >
                      Unable to load materials list.
                    </td>
                  </tr>
                )}

                {!loading && !error && materials && materials.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-4 text-center text-xs text-slate-400"
                    >
                      No materials found in the catalog.
                    </td>
                  </tr>
                )}

                {!loading &&
                  !error &&
                  materials &&
                  materials.map((m) => (
                    <tr
                      key={m.id}
                      className="border-t border-slate-800/60 hover:bg-slate-900/70"
                    >
                      <td className="px-3 py-2 text-xs text-slate-100">
                        {m.material_name}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {m.material_family ?? <span className="text-slate-500">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-200">
                        {m.density_lb_ft3 != null
                          ? `${m.density_lb_ft3.toFixed(2)} pcf`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${
                            m.is_active
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
                              : "bg-slate-500/20 text-slate-200 border border-slate-500/40"
                          }`}
                        >
                          {m.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-400">
                        {getMaterialNotes(m)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            These rows are now backed by real data. Polyethylene and Expanded
            Polyethylene remain separate families; any incorrect family labels
            should be fixed in the database, not in code.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Admin only – not visible to customers.
          </p>
        </section>
      </div>
    </main>
  );
}

function getMaterialNotes(m: MaterialRow): string {
  const fam = (m.material_family || "").toLowerCase();

  if (fam.includes("polyurethane")) {
    return "Open-cell PU, commonly used for inserts and instrument cases.";
  }
  if (fam === "polyethylene" || fam.includes(" polyethylene")) {
    return "Closed-cell PE for general protective packaging.";
  }
  if (fam.includes("expanded polyethylene") || fam.startsWith("epe")) {
    return "Expanded Polyethylene; keep separate from standard PE.";
  }
  if (!m.material_family) {
    return "Family not assigned yet – consider updating in the materials table.";
  }
  return "Material family managed in DB; review in admin if this looks off.";
}
