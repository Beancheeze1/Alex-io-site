"use client";

import * as React from "react";

type CushionCurve = {
  id: number;
  material_id: number;
  static_psi: string;
  deflect_pct: string;
  g_level: string;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export default function CushionCurvesAdminPage() {
  const [materialId, setMaterialId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [curves, setCurves] = React.useState<CushionCurve[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);

  const handleLoad = async () => {
    setError(null);
    setHasLoadedOnce(true);
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (materialId.trim()) {
        params.set("material_id", materialId.trim());
      }
      params.set("t", Date.now().toString());

      const res = await fetch(`/api/cushion/curves?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json().catch(() => null);
      if (!data || data.ok !== true) {
        throw new Error("Unexpected response from server");
      }

      setCurves(Array.isArray(data.curves) ? data.curves : []);
    } catch (err: any) {
      console.error("load curves error", err);
      setError(err?.message || "Failed to load curves");
      setCurves([]);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (materialId.trim()) {
      params.set("material_id", materialId.trim());
    }
    params.set("t", Date.now().toString());

    const url = `/api/cushion/curves/export?${params.toString()}`;
    // open in a new tab so the browser downloads the CSV
    window.open(url, "_blank");
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-stretch">
      <div className="w-full mx-auto bg-white rounded-none shadow-none border-t border-slate-200 p-6">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          {/* Header */}
          <header className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Cushion curves
              </h1>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                Look up cushion curves by material ID, review the points, and
                export them as a CSV file for offline analysis or editing.
              </p>
            </div>
          </header>

          {/* Controls */}
          <section className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-600 font-medium">
                  Material ID
                </label>
                <input
                  type="number"
                  value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}
                  placeholder="e.g. 1"
                  className="w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Leave blank to view all curves.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoad}
                  disabled={loading}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 transition disabled:opacity-60"
                >
                  {loading ? "Loading…" : "Load curves"}
                </button>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50/60 transition"
                >
                  Export CSV
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {error}
              </div>
            )}
          </section>

          {/* Results table */}
          <section className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            {curves.length === 0 ? (
              <div className="text-xs text-slate-500">
                {loading && <span>Loading cushion curves…</span>}
                {!loading && hasLoadedOnce && (
                  <span>No cushion curves found for this filter.</span>
                )}
                {!loading && !hasLoadedOnce && (
                  <span>Run a search above to see cushion curves.</span>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-[11px] text-slate-600">
                      <th className="border border-slate-200 px-2 py-1 text-left">
                        ID
                      </th>
                      <th className="border border-slate-200 px-2 py-1 text-left">
                        Material ID
                      </th>
                      <th className="border border-slate-200 px-2 py-1 text-right">
                        Static (psi)
                      </th>
                      <th className="border border-slate-200 px-2 py-1 text-right">
                        Deflect (%)
                      </th>
                      <th className="border border-slate-200 px-2 py-1 text-right">
                        G-level
                      </th>
                      <th className="border border-slate-200 px-2 py-1 text-left">
                        Source
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {curves.map((c) => (
                      <tr key={c.id} className="odd:bg-white even:bg-slate-50">
                        <td className="border border-slate-200 px-2 py-1">
                          {c.id}
                        </td>
                        <td className="border border-slate-200 px-2 py-1">
                          {c.material_id}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                          {c.static_psi}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                          {c.deflect_pct}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-right font-mono">
                          {c.g_level}
                        </td>
                        <td className="border border-slate-200 px-2 py-1 text-[11px] text-slate-600">
                          {c.source || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
