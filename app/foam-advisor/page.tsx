// app/foam-advisor/page.tsx
//
// Foam Advisor · Path A layout v3 + live curve canvas
//
// - Inputs on the LEFT
// - Center: cushion-curve canvas that auto-loads the primary pick’s curve
//   from /api/cushion/curves/{material_id} and marks the operating point.
// - RIGHT: analysis summary + recommended materials (with View cushion curve link).
//
// No changes to pricing, quotes, or existing core logic.
//

"use client";

import * as React from "react";

type EnvironmentOption = "normal" | "cold_chain" | "vibration";
type FragilityOption = "very_fragile" | "moderate" | "rugged";

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type AdvisorRecommendation = {
  key: string;
  family: string;
  label: string;
  confidence: "primary" | "alternative" | "stretch";
  notes: string;
  targetDensityMin?: number;
  targetDensityMax?: number;
};

type AdvisorResult = {
  staticLoadPsi: number;
  staticLoadPsiLabel: string;
  environmentLabel: string;
  fragilityLabel: string;
  recommendations: AdvisorRecommendation[];
};

type MaterialOption = {
  id: number;
  name: string;
  family: string;
  density_lb_ft3: number | null;
};

type CushionPoint = {
  static_psi: number;
  deflect_pct: number;
  g_level: number;
  source: string | null;
};

type CushionCurvesApiResponse =
  | {
      ok: true;
      material: {
        id: number;
        name: string;
        material_family: string | null;
      };
      points: CushionPoint[];
      point_count: number;
    }
  | {
      ok: false;
      error: string;
      detail?: any;
    };

function parseBlockDims(
  raw: string | null,
): { L: number; W: number; H: number } | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = t.match(
    /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/,
  );
  if (!m) return null;
  const L = Number(m[1]) || 0;
  const W = Number(m[2]) || 0;
  const H = Number(m[3]) || 0;
  if (!L || !W || !H) return null;
  return { L, W, H };
}

export default function FoamAdvisorPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  // ----- Read query params from props -----

  const quoteParam = searchParams?.quote_no ?? searchParams?.quote ?? "";
  const quoteNo = Array.isArray(quoteParam)
    ? (quoteParam[0] ?? "").trim()
    : (quoteParam ?? "").trim();

  const blockParamRaw = searchParams?.block ?? null;
  const blockParam = Array.isArray(blockParamRaw)
    ? blockParamRaw[0] ?? null
    : blockParamRaw ?? null;

  const parsedBlock = React.useMemo(
    () => parseBlockDims(blockParam),
    [blockParam],
  );

  // ----- Form state -----

  const [weightLb, setWeightLb] = React.useState<string>("");
  const [contactAreaIn2, setContactAreaIn2] =
    React.useState<string>("");
  const [environment, setEnvironment] =
    React.useState<EnvironmentOption>("normal");
  const [fragility, setFragility] =
    React.useState<FragilityOption>("moderate");

  // Advisor result / status
  const [advisorResult, setAdvisorResult] =
    React.useState<AdvisorResult | null>(null);
  const [advisorError, setAdvisorError] =
    React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  // Materials catalog (from /api/materials)
  const [materials, setMaterials] =
    React.useState<MaterialOption[]>([]);
  const [materialsLoading, setMaterialsLoading] =
    React.useState<boolean>(true);
  const [materialsError, setMaterialsError] = React.useState<
    string | null
  >(null);

  // Cushion curve state for the center canvas
  const [curveMaterial, setCurveMaterial] = React.useState<{
    id: number;
    name: string;
    material_family: string | null;
  } | null>(null);
  const [curvePoints, setCurvePoints] = React.useState<CushionPoint[]>(
    [],
  );
  const [curveLoading, setCurveLoading] =
    React.useState<boolean>(false);
  const [curveError, setCurveError] =
    React.useState<string | null>(null);

  // Prefill contact area from block L×W if available
  React.useEffect(() => {
    if (!parsedBlock) return;
    const { L, W } = parsedBlock;
    if (L > 0 && W > 0) {
      const area = L * W;
      setContactAreaIn2((prev) =>
        prev.trim() ? prev : area.toFixed(1),
      );
    }
  }, [parsedBlock]);

  // Load materials list from existing API (same one the editor uses)
  React.useEffect(() => {
    let cancelled = false;

    async function loadMaterials() {
      setMaterialsLoading(true);
      setMaterialsError(null);

      try {
        const res = await fetch("/api/materials", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();

        if (!cancelled && Array.isArray(json.materials)) {
          const mapped: MaterialOption[] = json.materials.map(
            (m: any) => ({
              id: m.id,
              name:
                (m.name ?? m.material_name ?? `Material #${m.id}`) ||
                `Material #${m.id}`,
              family: m.material_family || "Uncategorized",
              density_lb_ft3:
                typeof m.density_lb_ft3 === "number"
                  ? m.density_lb_ft3
                  : m.density_lb_ft3 != null
                  ? Number(m.density_lb_ft3)
                  : null,
            }),
          );
          setMaterials(mapped);
        }
      } catch (err) {
        console.error("Error loading materials for Foam Advisor", err);
        if (!cancelled) {
          setMaterialsError(
            "Couldn’t load your foam catalog. Recommendations will still show, but won’t be mapped to actual materials.",
          );
        }
      } finally {
        if (!cancelled) {
          setMaterialsLoading(false);
        }
      }
    }

    loadMaterials();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdvisorError(null);
    setAdvisorResult(null);
    // reset curve state when running a new analysis
    setCurveMaterial(null);
    setCurvePoints([]);
    setCurveError(null);

    const w = Number(weightLb);
    const a = Number(contactAreaIn2);

    if (!Number.isFinite(w) || w <= 0) {
      alert("Please enter a valid product weight (lb).");
      return;
    }
    if (!Number.isFinite(a) || a <= 0) {
      alert("Please enter a valid contact area (in²).");
      return;
    }

    try {
      setSubmitting(true);

      const res = await fetch("/api/foam-advisor/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightLb: w,
          contactAreaIn2: a,
          environment,
          fragility,
          quoteNo: quoteNo || null,
          block: blockParam || null,
        }),
      });

      if (!res.ok) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }
        const message =
          payload?.error === "invalid_weight"
            ? "The weight value was not valid."
            : payload?.error === "invalid_area"
            ? "The contact-area value was not valid."
            : "Foam Advisor had trouble analyzing this input.";
        setAdvisorError(message);
        return;
      }

      const json: any = await res.json();
      if (!json || !json.ok) {
        setAdvisorError(
          "Foam Advisor returned an unexpected response.",
        );
        return;
      }

      const result: AdvisorResult = {
        staticLoadPsi: Number(json.staticLoadPsi) || 0,
        staticLoadPsiLabel:
          json.staticLoadPsiLabel ||
          "Static load calculated from weight and contact area.",
        environmentLabel:
          json.environmentLabel || "Shipping environment",
        fragilityLabel:
          json.fragilityLabel || "Product fragility band",
        recommendations:
          Array.isArray(json.recommendations) &&
          json.recommendations.length > 0
            ? json.recommendations
            : [],
      };

      setAdvisorResult(result);
    } catch (err) {
      console.error("Foam Advisor submit error", err);
      setAdvisorError(
        "Foam Advisor is unavailable right now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasQuote = !!quoteNo;

  // Helper: find best catalog matches for a recommendation
  const findMaterialsForRecommendation = React.useCallback(
    (rec: AdvisorRecommendation): MaterialOption[] => {
      if (!materials || materials.length === 0) return [];

      const familyMatches = materials.filter((m) => {
        if (!m.family || !rec.family) return false;
        return (
          m.family.toLowerCase() === rec.family.toLowerCase() &&
          m.density_lb_ft3 != null
        );
      });

      if (familyMatches.length === 0) return [];

      let filtered = familyMatches;

      if (rec.targetDensityMin != null || rec.targetDensityMax != null) {
        filtered = familyMatches.filter((m) => {
          const d = m.density_lb_ft3!;
          if (
            rec.targetDensityMin != null &&
            d < rec.targetDensityMin
          )
            return false;
          if (
            rec.targetDensityMax != null &&
            d > rec.targetDensityMax
          )
            return false;
          return true;
        });

        if (filtered.length === 0) {
          filtered = familyMatches;
        }
      }

      const target =
        rec.targetDensityMin != null &&
        rec.targetDensityMax != null
          ? (rec.targetDensityMin + rec.targetDensityMax) / 2
          : rec.targetDensityMin ?? rec.targetDensityMax ?? null;

      filtered.sort((a, b) => {
        const da = a.density_lb_ft3 ?? 0;
        const db = b.density_lb_ft3 ?? 0;
        if (target == null) return da - db;
        return Math.abs(da - target) - Math.abs(db - target);
      });

      return filtered.slice(0, 3);
    },
    [materials],
  );

  // Auto-load a cushion curve for the primary recommendation's best match
  React.useEffect(() => {
    if (!advisorResult) return;
    if (!advisorResult.recommendations.length) return;
    if (!materials.length) return;

    const primary =
      advisorResult.recommendations.find(
        (r) => r.confidence === "primary",
      ) ?? advisorResult.recommendations[0];

    if (!primary) return;

    const matches = findMaterialsForRecommendation(primary);
    if (!matches || matches.length === 0) return;

    const best = matches[0];
    if (!best || !best.id) return;

    // If we already have this material loaded, do nothing
    if (curveMaterial && curveMaterial.id === best.id && curvePoints.length) {
      return;
    }

    let cancelled = false;

    async function loadCurve() {
      setCurveLoading(true);
      setCurveError(null);

      try {
        const res = await fetch(`/api/cushion/curves/${best.id}`, {
          cache: "no-store",
        });
        const json: CushionCurvesApiResponse = await res.json();

        if (cancelled) return;

        if (!res.ok || !json.ok) {
          const msg =
            (!json.ok && json.error) ||
            `HTTP ${res.status}` ||
            "Unknown error";
          setCurveError(msg);
          setCurveMaterial(null);
          setCurvePoints([]);
          setCurveLoading(false);
          return;
        }

        setCurveMaterial(json.material);
        setCurvePoints(json.points || []);
        setCurveLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error("Foam Advisor cushion curve load error:", err);
        setCurveError(String(err?.message || err));
        setCurveMaterial(null);
        setCurvePoints([]);
        setCurveLoading(false);
      }
    }

    loadCurve();

    return () => {
      cancelled = true;
    };
  }, [
    advisorResult,
    materials,
    findMaterialsForRecommendation,
    curveMaterial,
    curvePoints.length,
  ]);

  // Simple helper for the center band text label
  const operatingBandLabel = React.useMemo(() => {
    if (!advisorResult) return null;
    const psi = advisorResult.staticLoadPsi;
    if (!Number.isFinite(psi) || psi <= 0) return null;
    if (psi < 0.5) return "Soft / low psi band";
    if (psi < 1.5) return "Typical 0–1.5 psi band";
    return "Firm / high psi band";
  }, [advisorResult]);

  return (
    <main className="min-h-screen bg-slate-950 flex items-stretch py-8 px-4">
      <div className="w-full max-w-6xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/90 shadow-[0_22px_45px_rgba(15,23,42,0.85)] overflow-hidden">
          {/* Header – match layout editor vibe */}
          <div className="border-b border-slate-800 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
            <div className="flex items-center gap-4 w-full">
              {/* LEFT: powered by + quote */}
              <div className="flex flex-col">
                <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-50/90">
                  Powered by Alex-IO
                </div>
                <div className="mt-1 text-xs text-sky-50/95">
                  Foam Advisor ·{" "}
                  {hasQuote ? (
                    <>
                      Quote{" "}
                      <span className="font-mono font-semibold text-slate-50">
                        {quoteNo}
                      </span>
                    </>
                  ) : (
                    <span className="text-amber-50/90">
                      No quote linked (demo input)
                    </span>
                  )}
                </div>
              </div>

              {/* CENTER: big title */}
              <div className="flex-1 text-center">
                <div className="text-xl font-extrabold text-slate-50 leading-snug drop-shadow-[0_0_8px_rgba(15,23,42,0.6)]">
                  Foam recommendation assistant
                </div>
              </div>

              {/* RIGHT: BETA pill */}
              <div className="flex items-center justify-end">
                <span className="inline-flex items-center rounded-full border border-slate-200/70 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                  Foam Advisor · BETA
                </span>
              </div>
            </div>
          </div>

          {/* Body – three-column layout */}
          <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100">
            {/* LEFT: Inputs + context */}
            <aside className="w-72 shrink-0 flex flex-col gap-3">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  How this works
                </div>
                <p className="text-[11px] text-slate-400">
                  Enter the product weight, contact area, environment, and
                  fragility. Foam Advisor computes static load and suggests foam
                  families as a starting point.
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  The center canvas uses your cushion curve data to show where
                  this load sits.
                </p>
              </div>

              {parsedBlock && (
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 text-[11px] text-slate-200">
                  <div className="text-xs font-semibold text-slate-100 mb-1">
                    From layout
                  </div>
                  <div className="font-mono">
                    {parsedBlock.L}" × {parsedBlock.W}" × {parsedBlock.H}"
                  </div>
                  <div className="mt-1 text-slate-400">
                    Contact area can start as L × W for snug fits. You can
                    override it below.
                  </div>
                </div>
              )}

              {/* Advisor form */}
              <form
                onSubmit={handleSubmit}
                className="space-y-4 text-xs bg-slate-900 rounded-2xl border border-slate-800 p-4"
              >
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Product weight (lb)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={weightLb}
                      onChange={(e) => setWeightLb(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                    />
                    <span className="text-[10px] text-slate-500">
                      Approximate weight of the protected item or load on each
                      cavity.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Contact area (in²)
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={contactAreaIn2}
                      onChange={(e) =>
                        setContactAreaIn2(e.target.value)
                      }
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                    />
                    <span className="text-[10px] text-slate-500">
                      Area of foam directly supporting the product.
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Shipping environment
                    </span>
                    <select
                      value={environment}
                      onChange={(e) =>
                        setEnvironment(
                          e.target.value as EnvironmentOption,
                        )
                      }
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                    >
                      <option value="normal">
                        Normal parcel / LTL
                      </option>
                      <option value="cold_chain">
                        Cold chain / refrigerated
                      </option>
                      <option value="vibration">
                        Heavy vibration / rough handling
                      </option>
                    </select>
                    <span className="text-[10px] text-slate-500">
                      Tunes recommendations toward harsher or gentler handling.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-300">
                      Product fragility
                    </span>
                    <select
                      value={fragility}
                      onChange={(e) =>
                        setFragility(
                          e.target.value as FragilityOption,
                        )
                      }
                      className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                    >
                      <option value="very_fragile">
                        Very fragile electronics / optics
                      </option>
                      <option value="moderate">
                        General industrial components
                      </option>
                      <option value="rugged">
                        Rugged hardware / tooling
                      </option>
                    </select>
                    <span className="text-[10px] text-slate-500">
                      Later this maps to g-level bands for curve selection.
                    </span>
                  </label>
                </div>

                <div className="pt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                  >
                    {submitting
                      ? "Analyzing…"
                      : "Analyze and prepare recommendation"}
                  </button>
                </div>

                {advisorError && (
                  <div className="mt-3 rounded-xl border border-amber-600 bg-amber-900/60 px-3 py-2 text-[11px] text-amber-50">
                    {advisorError}
                  </div>
                )}

                {materialsError && (
                  <div className="mt-2 rounded-xl border border-amber-700 bg-amber-950/70 px-3 py-2 text-[11px] text-amber-100">
                    {materialsError}
                  </div>
                )}
              </form>
            </aside>

            {/* CENTER: Graphical cushion canvas */}
            <section className="flex-1 flex flex-col">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-100">
                    Cushion curve canvas
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Auto-loads the primary pick’s curve and marks your load.
                  </div>
                </div>

                {/* States when we don't have an analysis yet */}
                {!advisorResult && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-[11px] text-slate-500 text-center max-w-xs">
                      Run an analysis on the left. Once Foam Advisor has a
                      static load and primary recommendation, this canvas will
                      pull the matching cushion curve and show your operating
                      point.
                    </div>
                  </div>
                )}

                {/* States once we have an analysis */}
                {advisorResult && (
                  <div className="flex-1 flex flex-col gap-4">
                    {/* Static load + band bar */}
                    <div className="text-[11px] text-slate-300">
                      <div className="mb-1">
                        <span className="font-semibold text-sky-200">
                          Static load:
                        </span>{" "}
                        {advisorResult.staticLoadPsi.toFixed(3)} psi
                      </div>
                      <p>{advisorResult.staticLoadPsiLabel}</p>
                    </div>

                    {/* Band visualization */}
                    <div className="mt-2">
                      <div className="text-[11px] text-slate-300 mb-1">
                        Operating band preview
                      </div>
                      <div className="relative h-10 rounded-full overflow-hidden border border-slate-700 bg-slate-950">
                        {/* Soft band */}
                        <div className="absolute inset-y-0 left-0 w-1/3 bg-emerald-500/25" />
                        {/* Typical band */}
                        <div className="absolute inset-y-0 left-1/3 w-1/3 bg-sky-500/25" />
                        {/* Firm band */}
                        <div className="absolute inset-y-0 left-2/3 w-1/3 bg-amber-500/25" />

                        {/* Operating point marker (normalized 0–3 psi) */}
                        {advisorResult.staticLoadPsi > 0 && (
                          <div className="absolute inset-y-0 flex items-center">
                            {(() => {
                              const psi =
                                advisorResult.staticLoadPsi || 0;
                              const clamped =
                                psi <= 0
                                  ? 0
                                  : psi >= 3
                                  ? 3
                                  : psi;
                              const pct = (clamped / 3) * 100;
                              return (
                                <div className="relative h-full w-full">
                                  <div
                                    className="absolute top-0 bottom-0 w-[2px] bg-slate-50 shadow-[0_0_6px_rgba(248,250,252,0.9)]"
                                    style={{ left: `${pct}%` }}
                                  />
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                      {operatingBandLabel && (
                        <div className="mt-1 text-[10px] text-slate-400">
                          {operatingBandLabel}
                        </div>
                      )}
                    </div>

                    {/* Curve loading / error / chart */}
                    <div className="mt-3 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-semibold text-slate-100">
                          Primary curve preview
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Source: public.cushion_curves
                        </div>
                      </div>

                      {curveLoading && (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-[11px] text-sky-200">
                            Loading cushion curve data…
                          </div>
                        </div>
                      )}

                      {!curveLoading && curveError && (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="rounded-xl border border-rose-700/70 bg-rose-950/60 px-3 py-2 text-[11px] text-rose-50 max-w-xs text-center">
                            Couldn’t load cushion curve for the primary
                            recommendation.
                            <br />
                            <span className="font-mono">{curveError}</span>
                          </div>
                        </div>
                      )}

                      {!curveLoading &&
                        !curveError &&
                        (!curvePoints || curvePoints.length === 0) && (
                          <div className="flex-1 flex items-center justify-center">
                            <div className="text-[11px] text-slate-500 text-center max-w-xs">
                              No curve data was found for the selected catalog
                              material yet. You can still click{" "}
                              <span className="font-semibold">
                                View cushion curve
                              </span>{" "}
                              in the sidebar to open its admin view.
                            </div>
                          </div>
                        )}

                      {!curveLoading &&
                        !curveError &&
                        curvePoints &&
                        curvePoints.length > 0 && (
                          <div className="flex-1 flex flex-col gap-2">
                            <div className="text-[11px] text-slate-300">
                              {curveMaterial ? (
                                <>
                                  Plotting{" "}
                                  <span className="font-semibold text-sky-200">
                                    {curveMaterial.material_family ??
                                      "Foam"}
                                    {" – "}
                                    {curveMaterial.name}
                                  </span>{" "}
                                  as G-level vs static psi. The vertical marker
                                  shows your operating load.
                                </>
                              ) : (
                                "Plotting primary recommendation curve."
                              )}
                            </div>

                            {/* Simple SVG chart */}
                            <div className="flex-1 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2">
                              {(() => {
                                const sorted = [...curvePoints].sort(
                                  (a, b) =>
                                    a.static_psi - b.static_psi,
                                );
                                const psis = sorted.map(
                                  (p) => p.static_psi,
                                );
                                const gs = sorted.map(
                                  (p) => p.g_level,
                                );

                                const minPsi = Math.min(...psis);
                                const maxPsi = Math.max(...psis);
                                const minG = Math.min(...gs);
                                const maxG = Math.max(...gs);

                                const spanPsi =
                                  maxPsi - minPsi || 1;
                                const spanG = maxG - minG || 1;

                                const VIEW_W = 420;
                                const VIEW_H = 220;
                                const PAD_X = 40;
                                const PAD_Y = 30;

                                const mapX = (psi: number) =>
                                  PAD_X +
                                  ((psi - minPsi) / spanPsi) *
                                    (VIEW_W - 2 * PAD_X);
                                const mapY = (g: number) =>
                                  VIEW_H -
                                  PAD_Y -
                                  ((g - minG) / spanG) *
                                    (VIEW_H - 2 * PAD_Y);

                                const pathD = sorted
                                  .map((p, idx) => {
                                    const x = mapX(p.static_psi);
                                    const y = mapY(p.g_level);
                                    return `${idx === 0 ? "M" : "L"} ${x.toFixed(
                                      2,
                                    )} ${y.toFixed(2)}`;
                                  })
                                  .join(" ");

                                const operatingPsi =
                                  advisorResult.staticLoadPsi;
                                const operatingInRange =
                                  Number.isFinite(operatingPsi) &&
                                  operatingPsi >= minPsi &&
                                  operatingPsi <= maxPsi;

                                const opX = operatingInRange
                                  ? mapX(operatingPsi)
                                  : null;

                                return (
                                  <svg
                                    width={VIEW_W}
                                    height={VIEW_H}
                                    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                                  >
                                    {/* Background */}
                                    <rect
                                      x={0}
                                      y={0}
                                      width={VIEW_W}
                                      height={VIEW_H}
                                      fill="#020617"
                                    />

                                    {/* Axes */}
                                    <line
                                      x1={PAD_X}
                                      y1={VIEW_H - PAD_Y}
                                      x2={VIEW_W - PAD_X}
                                      y2={VIEW_H - PAD_Y}
                                      stroke="#64748b"
                                      strokeWidth={1}
                                    />
                                    <line
                                      x1={PAD_X}
                                      y1={PAD_Y}
                                      x2={PAD_X}
                                      y2={VIEW_H - PAD_Y}
                                      stroke="#64748b"
                                      strokeWidth={1}
                                    />

                                    {/* Axis labels */}
                                    <text
                                      x={VIEW_W / 2}
                                      y={VIEW_H - 6}
                                      textAnchor="middle"
                                      fontSize={10}
                                      fill="#e5e7eb"
                                    >
                                      Static load (psi)
                                    </text>
                                    <text
                                      x={12}
                                      y={VIEW_H / 2}
                                      textAnchor="middle"
                                      fontSize={10}
                                      fill="#e5e7eb"
                                      transform={`rotate(-90 12 ${
                                        VIEW_H / 2
                                      })`}
                                    >
                                      G-level
                                    </text>

                                    {/* Curve path */}
                                    <path
                                      d={pathD}
                                      fill="none"
                                      stroke="#38bdf8"
                                      strokeWidth={1.5}
                                    />

                                    {/* Curve points */}
                                    {sorted.map((p, idx) => {
                                      const x = mapX(p.static_psi);
                                      const y = mapY(p.g_level);
                                      return (
                                        <circle
                                          key={`${p.static_psi}-${p.g_level}-${idx}`}
                                          cx={x}
                                          cy={y}
                                          r={2}
                                          fill="#e0f2fe"
                                        />
                                      );
                                    })}

                                    {/* Operating point marker */}
                                    {opX != null && (
                                      <>
                                        <line
                                          x1={opX}
                                          y1={PAD_Y}
                                          x2={opX}
                                          y2={VIEW_H - PAD_Y}
                                          stroke="#f9fafb"
                                          strokeWidth={1}
                                          strokeDasharray="4 4"
                                        />
                                        <text
                                          x={opX}
                                          y={PAD_Y - 6}
                                          textAnchor="middle"
                                          fontSize={9}
                                          fill="#f9fafb"
                                        >
                                          Operating load
                                        </text>
                                      </>
                                    )}

                                    {/* Min/max tick labels */}
                                    <text
                                      x={PAD_X}
                                      y={VIEW_H - PAD_Y + 12}
                                      textAnchor="middle"
                                      fontSize={9}
                                      fill="#cbd5f5"
                                    >
                                      {minPsi.toFixed(3)}
                                    </text>
                                    <text
                                      x={VIEW_W - PAD_X}
                                      y={VIEW_H - PAD_Y + 12}
                                      textAnchor="middle"
                                      fontSize={9}
                                      fill="#cbd5f5"
                                    >
                                      {maxPsi.toFixed(3)}
                                    </text>
                                    <text
                                      x={PAD_X - 8}
                                      y={VIEW_H - PAD_Y}
                                      textAnchor="end"
                                      fontSize={9}
                                      fill="#cbd5f5"
                                    >
                                      {minG.toFixed(1)}
                                    </text>
                                    <text
                                      x={PAD_X - 8}
                                      y={PAD_Y + 4}
                                      textAnchor="end"
                                      fontSize={9}
                                      fill="#cbd5f5"
                                    >
                                      {maxG.toFixed(1)}
                                    </text>
                                  </svg>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* RIGHT: Summary + recommendations */}
            <aside className="w-80 shrink-0 flex flex-col gap-3">
              {!advisorResult && (
                <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3 text-[11px] text-slate-400">
                  Run an analysis on the left to see a summary and mapped foam
                  families here.
                </div>
              )}

              {advisorResult && (
                <>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200">
                    <div className="font-semibold text-sky-200 mb-1">
                      Analysis summary
                    </div>
                    <p className="mb-2">
                      {advisorResult.staticLoadPsiLabel}
                    </p>
                    <p className="mb-1">
                      <span className="font-semibold">
                        Environment:{" "}
                      </span>
                      {advisorResult.environmentLabel}
                    </p>
                    <p>
                      <span className="font-semibold">
                        Fragility:{" "}
                      </span>
                      {advisorResult.fragilityLabel}
                    </p>
                    {parsedBlock && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        Block from layout: {parsedBlock.L}" ×{" "}
                        {parsedBlock.W}" × {parsedBlock.H}".
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200 max-h-[420px] overflow-auto">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-semibold text-slate-100">
                        Suggested foam families
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Using /api/materials for catalog mapping.
                      </div>
                    </div>

                    {advisorResult.recommendations.length === 0 ? (
                      <div className="text-[11px] text-slate-300">
                        No specific suggestions returned for this combination
                        yet.
                      </div>
                    ) : (
                      advisorResult.recommendations.map((rec) => {
                        const matchedMaterials =
                          findMaterialsForRecommendation(rec);

                        const firstMatched =
                          matchedMaterials.length > 0
                            ? matchedMaterials[0]
                            : null;

                        return (
                          <div
                            key={rec.key}
                            className="mb-3 last:mb-0 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div>
                                <div className="font-semibold">
                                  {rec.label}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {rec.family}
                                </div>
                              </div>
                              <span
                                className={[
                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                  rec.confidence === "primary"
                                    ? "bg-sky-500/20 border border-sky-400 text-sky-100"
                                    : rec.confidence === "alternative"
                                    ? "bg-emerald-500/15 border border-emerald-400 text-emerald-100"
                                    : "bg-slate-700/60 border border-slate-500 text-slate-100",
                                ].join(" ")}
                              >
                                {rec.confidence === "primary"
                                  ? "Primary pick"
                                  : rec.confidence === "alternative"
                                  ? "Alternative"
                                  : "Stretch option"}
                              </span>
                            </div>
                            <p className="leading-snug text-[11px] mb-1">
                              {rec.notes}
                            </p>

                            {matchedMaterials.length > 0 && (
                              <div className="mt-1 text-[10px] text-slate-400">
                                <div className="font-semibold text-[10px] text-slate-300 mb-0.5">
                                  In your catalog:
                                </div>
                                <ul className="list-disc list-inside space-y-0.5">
                                  {matchedMaterials.map((m) => (
                                    <li key={m.id}>
                                      {m.name}
                                      {m.density_lb_ft3 != null
                                        ? ` · ${m.density_lb_ft3.toFixed(
                                            1,
                                          )} pcf`
                                        : ""}
                                    </li>
                                  ))}
                                </ul>

                                {firstMatched && (
                                  <div className="mt-2">
                                    <a
                                      href={`/admin/cushion/curves/${firstMatched.id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center rounded-full border border-sky-500/70 px-3 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-500/15 transition"
                                    >
                                      View cushion curve
                                    </a>
                                  </div>
                                )}

                                {materialsLoading && (
                                  <div className="mt-1 text-[10px] text-slate-500">
                                    Loading materials…
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
