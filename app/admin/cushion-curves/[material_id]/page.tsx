// app/admin/cushion/curves/[material_id]/page.tsx
//
// Read-only cushion curve viewer for a single material.
// URL: /admin/cushion/curves/[material_id]
//
// - Uses /api/cushion/curves/[material_id]
// - Shows material name + family
// - Shows a simple table of points (static_psi, deflect_pct, g_level)
// - No editing, no impact on pricing or quotes.
//
// This version reuses the same three-column dark layout vibe
// as the layout editor:
//   • Left: material card + DB hints
//   • Center: summary + curve data table
//   • Right: quick stats / usage notes
//
// Still NO charts or new math yet (Path A safe).

"use client";

import * as React from "react";
import { useParams } from "next/navigation";

type CushionPoint = {
  static_psi: number;
  deflect_pct: number;
  g_level: number;
  source: string | null;
};

type MaterialInfo = {
  id: number;
  name: string;
  material_family: string | null;
};

type ApiResponse =
  | {
      ok: true;
      material: MaterialInfo;
      points: CushionPoint[];
      point_count: number;
    }
  | {
      ok: false;
      error: string;
      detail?: any;
    };

// Support both [material_id] and [material-id] just in case
type RouteParams = {
  material_id?: string;
  "material-id"?: string;
};

export default function CushionCurvesMaterialPage() {
  const params = useParams<RouteParams>();

  const materialIdParam =
    params?.material_id ?? (params as any)?.["material-id"] ?? "";
  const materialId = String(materialIdParam || "");

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [material, setMaterial] = React.useState<MaterialInfo | null>(
    null,
  );
  const [points, setPoints] = React.useState<CushionPoint[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/cushion/curves/${materialId}`, {
          cache: "no-store",
        });

        const json = (await res.json()) as ApiResponse;

        if (cancelled) return;

        if (!res.ok || !json.ok) {
          const msg =
            (!json.ok && json.error) ||
            `HTTP ${res.status}` ||
            "Unknown error";
          setError(msg);
          setMaterial(null);
          setPoints([]);
          setLoading(false);
          return;
        }

        setMaterial(json.material);
        setPoints(json.points || []);
        setLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("cushion-curves viewer error:", err);
        setError(String(err?.message || err));
        setMaterial(null);
        setPoints([]);
        setLoading(false);
      }
    }

    if (materialId) {
      load();
    } else {
      setError("Missing material_id in URL");
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [materialId]);

  const title =
    material && material.material_family
      ? `${material.material_family} – ${material.name}`
      : material
      ? material.name
      : `Material #${materialId}`;

  // Precomputed ranges for quick summary / sidebar
  const summary = React.useMemo(() => {
    if (!points.length) {
      return null;
    }

    const sortedByG = [...points].sort(
      (a, b) => a.g_level - b.g_level,
    );
    const best = sortedByG[0];

    const psiValues = points.map((p) => p.static_psi);
    const gValues = points.map((p) => p.g_level);
    const deflValues = points.map((p) => p.deflect_pct);

    const psiMin = Math.min(...psiValues);
    const psiMax = Math.max(...psiValues);
    const gMin = Math.min(...gValues);
    const gMax = Math.max(...gValues);
    const deflMin = Math.min(...deflValues);
    const deflMax = Math.max(...deflValues);

    return {
      best,
      psiMin,
      psiMax,
      gMin,
      gMax,
      deflMin,
      deflMax,
    };
  }, [points]);

  return (
    <main className="min-h-screen bg-slate-950 flex items-stretch py-8 px-4">
      <div className="w-full max-w-6xl mx-auto">
        {/* Page-level label (like other admin pages) */}
        <div className="mb-4">
          <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-sky-300/90">
            Admin · Cushion curves
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-50">
            Cushion curves for{" "}
            <span className="font-mono text-sky-300">
              #{materialId}
            </span>
          </h1>
          {material && (
            <p className="mt-1 text-sm text-slate-300">
              <span className="font-semibold">{material.name}</span>
              {material.material_family && (
                <span className="ml-2 text-slate-400">
                  ({material.material_family})
                </span>
              )}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500">
            Read-only view. This page does not affect pricing, quotes, or
            layout — it just surfaces cushion data already in the database.
          </p>
        </div>

        {/* Main card with layout-editor style shell */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow-[0_22px_45px_rgba(15,23,42,0.85)] overflow-hidden">
          {/* Header strip */}
          <div className="border-b border-slate-800 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <div className="text-xs font-semibold text-slate-50">
                  Cushion curve data
                </div>
                <div className="text-[11px] text-sky-50/90">
                  Static load vs deflection vs G-level
                </div>
                {title && (
                  <div className="mt-1 text-[11px] text-slate-100">
                    {title}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {loading && (
                  <span className="text-[11px] text-sky-50/80">
                    Loading…
                  </span>
                )}
                {!loading && points.length > 0 && (
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                    {points.length} point
                    {points.length === 1 ? "" : "s"} loaded
                  </span>
                )}
                {!loading && !points.length && !error && (
                  <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-amber-50">
                    No cushion data found
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Body: three-column layout, same vibe as layout editor */}
          <div className="flex flex-row gap-5 p-5 bg-slate-950/80 text-slate-100">
            {/* LEFT: Material card + DB hint */}
            <aside className="w-60 shrink-0 flex flex-col gap-3">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  Material
                </div>
                {material ? (
                  <>
                    <div className="text-[11px] text-slate-200">
                      <span className="font-semibold">
                        {material.name}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      ID{" "}
                      <span className="font-mono text-sky-300">
                        {material.id}
                      </span>
                    </div>
                    {material.material_family && (
                      <div className="mt-1 text-[11px] text-slate-300">
                        Family:{" "}
                        <span className="font-semibold">
                          {material.material_family}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Looking up material details…
                  </div>
                )}
                <div className="mt-3 text-[11px] text-slate-500">
                  Curves are stored in{" "}
                  <span className="font-mono text-sky-300">
                    public.cushion_curves
                  </span>{" "}
                  with{" "}
                  <span className="font-mono">material_id = {materialId}</span>
                  . Edit rows there and refresh this page to update.
                </div>
              </div>

              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  How this will be used
                </div>
                <p className="text-[11px] text-slate-400">
                  Future Path A steps will let Foam Advisor overlay this
                  material’s curve with the{" "}
                  <span className="text-sky-300">operating psi</span> and
                  compare a few candidate foams on the same graph.
                </p>
              </div>
            </aside>

            {/* CENTER: Summary + table */}
            <section className="flex-1 flex flex-col gap-3">
              {error && (
                <div className="rounded-xl border border-rose-700/70 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-50">
                  Error loading cushion curves:{" "}
                  <span className="font-mono">{error}</span>
                </div>
              )}

              {!error && !loading && !points.length && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-3 text-xs text-slate-300">
                  No cushion curves are stored for this material yet. You can
                  add rows to{" "}
                  <span className="font-mono text-sky-300">
                    public.cushion_curves
                  </span>{" "}
                  (material_id = {materialId}) and refresh this page to see
                  them.
                </div>
              )}

              {points.length > 0 && (
                <>
                  {/* Quick summary row (like mini dashboard) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                      <div className="text-[11px] text-slate-400 mb-1">
                        Lowest G-level point
                      </div>
                      {summary?.best ? (
                        <div className="text-slate-100">
                          <div>
                            <span className="font-semibold">
                              {summary.best.g_level.toFixed(1)} G
                            </span>{" "}
                            @ {summary.best.static_psi.toFixed(3)} psi
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Deflection {summary.best.deflect_pct.toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-300">—</div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                      <div className="text-[11px] text-slate-400 mb-1">
                        Static PSI range
                      </div>
                      {summary ? (
                        <div className="text-slate-100">
                          {summary.psiMin.toFixed(3)} psi –{" "}
                          {summary.psiMax.toFixed(3)} psi
                        </div>
                      ) : (
                        <div className="text-slate-300">—</div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                      <div className="text-[11px] text-slate-400 mb-1">
                        G-level range
                      </div>
                      {summary ? (
                        <div className="text-slate-100">
                          {summary.gMin.toFixed(1)} G –{" "}
                          {summary.gMax.toFixed(1)} G
                        </div>
                      ) : (
                        <div className="text-slate-300">—</div>
                      )}
                    </div>
                  </div>

                  {/* Data table, centered like a “canvas” for now */}
                  <div className="flex-1 bg-slate-900 rounded-2xl border border-slate-800 p-4 overflow-auto">
                    <div className="text-[11px] text-slate-400 mb-2">
                      Raw cushion curve points. In a future step, this center
                      panel will render a graphical curve using these numbers.
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 max-h-[420px] overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-900/80 sticky top-0 z-10">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-800">
                              Static load (psi)
                            </th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-800">
                              Deflection (%)
                            </th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-800">
                              G-level
                            </th>
                            <th className="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-800">
                              Source
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {points.map((p, idx) => (
                            <tr
                              key={`${p.static_psi}-${p.deflect_pct}-${p.g_level}-${idx}`}
                              className={
                                idx % 2 === 0
                                  ? "bg-slate-950"
                                  : "bg-slate-950/70"
                              }
                            >
                              <td className="px-3 py-1.5 text-slate-100 font-mono">
                                {p.static_psi.toFixed(3)}
                              </td>
                              <td className="px-3 py-1.5 text-slate-100 font-mono">
                                {p.deflect_pct.toFixed(1)}
                              </td>
                              <td className="px-3 py-1.5 text-slate-100 font-mono">
                                {p.g_level.toFixed(1)}
                              </td>
                              <td className="px-3 py-1.5 text-slate-300">
                                {p.source || (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* RIGHT: Quick stats / usage notes */}
            <aside className="w-64 shrink-0 flex flex-col gap-3">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  Quick stats
                </div>
                {summary && (
                  <>
                    <div className="text-[11px] text-slate-400 mb-1">
                      Deflection span
                    </div>
                    <div className="text-xs text-slate-100 mb-2">
                      {summary.deflMin.toFixed(1)}% –{" "}
                      {summary.deflMax.toFixed(1)}%
                    </div>
                    <div className="text-[11px] text-slate-400 mb-1">
                      Points in curve
                    </div>
                    <div className="text-xs text-slate-100">
                      {points.length} total
                    </div>
                  </>
                )}
                {!summary && (
                  <div className="text-[11px] text-slate-400">
                    Curve statistics will appear here once points are loaded.
                  </div>
                )}
              </div>

              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  Column legend
                </div>
                <ul className="text-[11px] text-slate-400 space-y-1">
                  <li>
                    <span className="font-semibold text-slate-200">
                      Static load (psi)
                    </span>{" "}
                    – weight ÷ contact area at that test condition.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-200">
                      Deflection (%)
                    </span>{" "}
                    – how much the foam thickness was compressed.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-200">
                      G-level
                    </span>{" "}
                    – transmitted shock back to the product.
                  </li>
                </ul>
                <p className="mt-2 text-[11px] text-slate-500">
                  Lower G at your operating psi and deflection is usually
                  better, as long as the foam isn&apos;t bottoming out.
                </p>
              </div>

              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-[11px] text-slate-400">
                  In a follow-up step, this right panel can also show the{" "}
                  <span className="text-sky-300">
                    Foam Advisor operating point
                  </span>{" "}
                  and how it compares to this curve.
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
