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
// This follows the same dark UI style as the layout editor / admin views.

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

  const materialId =
    params?.material_id ??
    (params as any)?.["material-id"] ??
    "";

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [material, setMaterial] = React.useState<MaterialInfo | null>(null);
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

  return (
    <main className="min-h-screen bg-slate-950 py-8 px-4 text-slate-100">
      <div className="w-full max-w-5xl mx-auto">
        <div className="mb-6">
          <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-sky-300/90">
            Admin · Cushion curves
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-slate-50">
            Cushion curves for material{" "}
            <span className="font-mono text-sky-300">#{materialId}</span>
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

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 shadow-[0_22px_45px_rgba(15,23,42,0.85)] overflow-hidden">
          {/* Header strip */}
          <div className="border-b border-slate-800 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-50">
                  Cushion curve data
                </div>
                <div className="text-[11px] text-sky-50/90">
                  Static loading vs deflection vs G-level
                </div>
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

          {/* Body */}
          <div className="p-4">
            {error && (
              <div className="mb-4 rounded-xl border border-rose-700/70 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-50">
                Error loading cushion curves:{" "}
                <span className="font-mono">{error}</span>
              </div>
            )}

            {!error && !loading && points.length === 0 && (
              <div className="text-sm text-slate-300">
                No cushion curves are stored for this material yet. You can add
                rows to{" "}
                <span className="font-mono text-sky-300">
                  public.cushion_curves
                </span>{" "}
                (material_id = {materialId}) and refresh this page to see them.
              </div>
            )}

            {!error && points.length > 0 && (
              <>
                {/* Quick summary card */}
                <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Lowest G-level point */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <div className="text-[11px] text-slate-400 mb-1">
                      Lowest G-level point
                    </div>
                    {(() => {
                      const sorted = [...points].sort(
                        (a, b) => a.g_level - b.g_level,
                      );
                      const best = sorted[0];
                      if (!best) return <div className="text-xs">—</div>;
                      return (
                        <div className="text-xs text-slate-100">
                          <div>
                            <span className="font-semibold">
                              {best.g_level.toFixed(1)} G
                            </span>{" "}
                            @ {best.static_psi.toFixed(3)} psi
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Deflection {best.deflect_pct.toFixed(1)}%
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* PSI span */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <div className="text-[11px] text-slate-400 mb-1">
                      Static PSI range
                    </div>
                    {(() => {
                      const psis = points.map((p) => p.static_psi);
                      const min = Math.min(...psis);
                      const max = Math.max(...psis);
                      return (
                        <div className="text-xs text-slate-100">
                          {min.toFixed(3)} psi – {max.toFixed(3)} psi
                        </div>
                      );
                    })()}
                  </div>

                  {/* G-level span */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2">
                    <div className="text-[11px] text-slate-400 mb-1">
                      G-level range
                    </div>
                    {(() => {
                      const gs = points.map((p) => p.g_level);
                      const min = Math.min(...gs);
                      const max = Math.max(...gs);
                      return (
                        <div className="text-xs text-slate-100">
                          {min.toFixed(1)} G – {max.toFixed(1)} G
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Table of points */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 max-h-[480px] overflow-auto">
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

                <p className="mt-3 text-[11px] text-slate-500">
                  Data source:{" "}
                  <span className="font-mono text-sky-300">
                    public.cushion_curves
                  </span>{" "}
                  (material_id = {materialId}). To adjust curves, edit rows in the
                  database and refresh this page.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
