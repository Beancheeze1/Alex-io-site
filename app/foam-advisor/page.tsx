// app/foam-advisor/page.tsx
//
// Foam Advisor · Path A layout v10
// - Inputs on the LEFT
// - Center: cushion-curve canvas that shows the selected recommendation’s curve
//   from /api/cushion/curves/{material_id}, with the operating point marked.
// - Extras in this version:
//   • Finds the nearest tested cushion-curve point to your operating psi
//   • Highlights it on the graph
//   • Shows a small numeric readout: psi / % deflection / G
//   • Operating band gauge with 0 / 1 / 2 / 3 psi ticks and segment labels
//   • Stronger gradient band (soft → typical → firm / red) so it pops
//   • Dashed operating-line marker inside the band (matches chart vibe)
//   • Subtle but visible grid behind the curve, with axis ticks aligned
//   • Hover tooltips on tested data points
//   • Short explanation of the operating band for non-experts
//   • Sticky inputs per quote number via localStorage
// - RIGHT: analysis summary + recommended materials (clickable to drive the canvas)
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

type FoamAdvisorStoredState = {
  weightLb?: string;
  contactAreaIn2?: string;
  environment?: EnvironmentOption;
  fragility?: FragilityOption;
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

function storageKeyForQuote(quoteNo: string): string {
  const key = quoteNo && quoteNo.trim().length > 0 ? quoteNo.trim() : "demo";
  return `foamAdvisorState:${key}`;
}

// Shared helper: 0–1 fraction of operating psi across the curve’s psi span
function computeOperatingFraction(
  points: CushionPoint[] | null | undefined,
  operatingPsi: number | null | undefined,
): number | null {
  if (!points || points.length < 2) return null;
  if (operatingPsi == null || !Number.isFinite(operatingPsi) || operatingPsi <= 0) {
    return null;
  }

  const psis = points.map((p) => p.static_psi);
  const minPsi = Math.min(...psis);
  const maxPsi = Math.max(...psis);
  const span = maxPsi - minPsi;

  if (!span || !Number.isFinite(span)) return null;

  let normalized = (operatingPsi - minPsi) / span;
  if (normalized < 0) normalized = 0;
  if (normalized > 1) normalized = 1;

  return normalized; // 0–1 across the actual curve psi range
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

  const [effectiveQuoteNo, setEffectiveQuoteNo] =
    React.useState<string>(() => {
      if (quoteNo && quoteNo.trim().length > 0) {
        return quoteNo.trim();
      }

      if (typeof window !== "undefined") {
        try {
          const url = new URL(window.location.href);
          const q =
            url.searchParams.get("quote_no") ||
            url.searchParams.get("quote") ||
            "";
          return (q ?? "").trim();
        } catch {
          // ignore
        }
      }

      return "";
    });

  React.useEffect(() => {
    if (quoteNo && quoteNo.trim()) {
      setEffectiveQuoteNo(quoteNo.trim());
      return;
    }

    if (typeof window === "undefined") return;

    try {
      const url = new URL(window.location.href);
      const q =
        url.searchParams.get("quote_no") ||
        url.searchParams.get("quote") ||
        "";
      if (q && q.trim()) {
        setEffectiveQuoteNo(q.trim());
      }
    } catch {
      // ignore
    }
  }, [quoteNo]);

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

  // Which recommendation is currently driving the center canvas
  const [selectedRecKey, setSelectedRecKey] =
    React.useState<string | null>(null);

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

  // Hovered tested point (for flyout tooltip)
  const [hoverPoint, setHoverPoint] = React.useState<{
    point: CushionPoint;
    x: number;
    y: number;
  } | null>(null);

  // Shared operating psi + fraction + nearest-point for both band + chart
  const operatingPsi = advisorResult?.staticLoadPsi ?? null;

  const operatingFraction = React.useMemo(
    () => computeOperatingFraction(curvePoints, operatingPsi),
    [curvePoints, operatingPsi],
  );

  const hasOperating = React.useMemo(
    () =>
      operatingPsi != null &&
      Number.isFinite(operatingPsi) &&
      operatingPsi > 0,
    [operatingPsi],
  );

  const nearestCurvePoint = React.useMemo(() => {
    if (!hasOperating || operatingPsi == null || !curvePoints.length) {
      return null;
    }

    const sorted = [...curvePoints].sort(
      (a, b) => a.static_psi - b.static_psi,
    );

    return (
      sorted.reduce<{ best: CushionPoint | null; dist: number }>(
        (acc, p) => {
          const d = Math.abs(p.static_psi - operatingPsi);
          if (acc.best === null || d < acc.dist) {
            return { best: p, dist: d };
          }
          return acc;
        },
        { best: null, dist: Infinity },
      ).best ?? null
    );
  }, [hasOperating, operatingPsi, curvePoints]);

  const hasQuote = !!effectiveQuoteNo;

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

  // Load stored form state per quote (sticky inputs)
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const key = storageKeyForQuote(effectiveQuoteNo);

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as FoamAdvisorStoredState;

      if (parsed.weightLb != null) {
        setWeightLb(String(parsed.weightLb));
      }
      if (parsed.contactAreaIn2 != null) {
        setContactAreaIn2(String(parsed.contactAreaIn2));
      }
      if (parsed.environment) {
        setEnvironment(parsed.environment);
      }
      if (parsed.fragility) {
        setFragility(parsed.fragility);
      }
    } catch {
      // ignore parse errors
    }
  }, [effectiveQuoteNo]);

  // Persist form state per quote when values change
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const key = storageKeyForQuote(effectiveQuoteNo);
    const payload: FoamAdvisorStoredState = {
      weightLb,
      contactAreaIn2,
      environment,
      fragility,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [effectiveQuoteNo, weightLb, contactAreaIn2, environment, fragility]);

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

  // Clear hover tooltip when curve data changes
  React.useEffect(() => {
    setHoverPoint(null);
  }, [curvePoints]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdvisorError(null);
    setAdvisorResult(null);
    setSelectedRecKey(null);
    // reset curve state when running a new analysis
    setCurveMaterial(null);
    setCurvePoints([]);
    setCurveError(null);
    setHoverPoint(null);

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
          quoteNo: effectiveQuoteNo || null,
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

      // Choose default recommendation for the canvas (primary, else first)
      let defaultKey: string | null = null;
      if (result.recommendations.length > 0) {
        const primary =
          result.recommendations.find(
            (r) => r.confidence === "primary",
          ) ?? result.recommendations[0];
        defaultKey = primary.key;
      }

      setAdvisorResult(result);
      setSelectedRecKey(defaultKey);
    } catch (err) {
      console.error("Foam Advisor submit error", err);
      setAdvisorError(
        "Foam Advisor is unavailable right now. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

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

  // Auto-load a cushion curve for the selected recommendation's best match
  React.useEffect(() => {
    if (!advisorResult) return;
    if (!advisorResult.recommendations.length) return;
    if (!materials.length) return;
    if (!selectedRecKey) return;

    const rec = advisorResult.recommendations.find(
      (r) => r.key === selectedRecKey,
    );
    if (!rec) return;

    const matches = findMaterialsForRecommendation(rec);
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
      setHoverPoint(null);

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
    selectedRecKey,
    findMaterialsForRecommendation,
    curveMaterial,
    curvePoints.length,
  ]);

  // Helper to find the currently selected recommendation
  const selectedRecommendation: AdvisorRecommendation | null =
    React.useMemo(() => {
      if (!advisorResult || !advisorResult.recommendations.length)
        return null;
      if (!selectedRecKey) return null;
      return (
        advisorResult.recommendations.find(
          (r) => r.key === selectedRecKey,
        ) ?? null
      );
    }, [advisorResult, selectedRecKey]);

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
                        {effectiveQuoteNo}
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
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 flex-1 flex flex-col shadow-[0_18px_45px_rgba(15,23,42,0.9)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] font-semibold text-slate-100 tracking-tight">
                    Cushion curve canvas
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Choose a recommendation on the right to drive this view.
                  </div>
                </div>

                {/* States when we don't have an analysis yet */}
                {!advisorResult && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-[11px] text-slate-500 text-center max-w-xs">
                      Run an analysis on the left. Once Foam Advisor has a
                      static load and recommendations, this canvas will pull the
                      matching cushion curve and show your operating point.
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
                      <div className="relative h-12 rounded-full overflow-hidden border border-slate-700 bg-slate-950">
                        {/* Bright gradient band (soft → typical → firm/red) */}
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-400/65 via-sky-400/90 to-rose-600/95" />

                        {/* Content overlay (ticks, labels, marker) */}
                        <div className="absolute inset-0">
                          {/* Tick marks at 0, 1, 2, 3 psi */}
                          <div className="absolute inset-0 flex items-end justify-between px-6 pb-3 text-[9px] text-slate-50 pointer-events-none">
                            {[0, 1, 2, 3].map((v) => (
                              <div
                                key={v}
                                className="flex flex-col items-center drop-shadow-[0_0_4px_rgba(15,23,42,0.8)]"
                              >
                                <div className="h-2 w-px bg-slate-50" />
                                <span className="mt-0.5 font-semibold">
                                  {v}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Segment labels (soft / typical / firm) */}
                          <div className="absolute inset-x-6 bottom-1 flex justify-between text-[9px] text-slate-50 font-semibold pointer-events-none drop-shadow-[0_0_6px_rgba(15,23,42,0.9)]">
                            <span>Soft</span>
                            <span className="text-center flex-1">
                              Typical 0–1.5 psi
                            </span>
                            <span className="text-right">
                              Firm / high
                            </span>
                          </div>

                          {/* Operating point marker – shares fraction with chart */}
                          {advisorResult.staticLoadPsi > 0 && (() => {
                            let pct: number;

                            if (operatingFraction != null) {
                              // Match the chart exactly
                              pct = operatingFraction * 100;
                            } else {
                              // Fallback: simple 0–3 psi band if we ever don't have curves
                              const psi = advisorResult.staticLoadPsi || 0;
                              const clamped =
                                psi <= 0 ? 0 : psi >= 3 ? 3 : psi;
                              pct = (clamped / 3) * 100;
                            }

                            return (
                              <div className="pointer-events-none absolute inset-y-0 inset-x-6">
                                <div
                                  className="absolute inset-y-0"
                                  style={{
                                    left: `${pct}%`,
                                    transform: "translateX(-50%)",
                                  }}
                                >
                                  {/* Glow column behind the line (same vibe as chart) */}
                                  <div className="absolute inset-y-0 w-[10px] bg-sky-300/30 shadow-[0_0_18px_rgba(56,189,248,0.95)]" />
                                  {/* Dashed operating line to match curve canvas */}
                                  <div className="absolute top-1 bottom-1 border-l-2 border-dashed border-slate-50 shadow-[0_0_10px_rgba(15,23,42,0.9)]" />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <p className="mt-1 text-[10px] text-slate-500">
                        The colored bar shows a typical static-load range for
                        this type of foam. The dashed line and glow mark where
                        your product sits within that range.
                      </p>
                    </div>
                    {/* Curve loading / error / chart */}
                    <div className="mt-3 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-semibold text-slate-100">
                          {selectedRecommendation
                            ? `Curve preview: ${selectedRecommendation.label}`
                            : "Primary curve preview"}
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
                            Couldn’t load cushion curve for the selected
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
                                    {curveMaterial.material_family ?? "Foam"}
                                    {" – "}
                                    {curveMaterial.name}
                                  </span>{" "}
                                  as G-level vs static psi. The vertical marker
                                  shows your operating load.
                                </>
                              ) : (
                                "Plotting selected recommendation curve."
                              )}
                            </div>

                            {/* SVG chart with grid, ticks, hover tooltips */}
                            <div className="relative flex-1 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 select-none">
                              {(() => {
                                const sorted = [...curvePoints].sort(
                                  (a, b) => a.static_psi - b.static_psi,
                                );
                                const psis = sorted.map((p) => p.static_psi);
                                const gs = sorted.map((p) => p.g_level);

                                const minPsi = Math.min(...psis);
                                const maxPsi = Math.max(...psis);
                                const minG = Math.min(...gs);
                                const maxG = Math.max(...gs);

                                const spanPsi = maxPsi - minPsi || 1;
                                const spanG = maxG - minG || 1;

                                const VIEW_W = 420;
                                const VIEW_H = 260;
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

                                // Grid line positions
                                const xGridCount = 4;
                                const xGridValues = Array.from(
                                  { length: xGridCount + 1 },
                                  (_, i) =>
                                    minPsi + (spanPsi * i) / xGridCount,
                                );
                                const yGridCount = 4;
                                const yGridValues = Array.from(
                                  { length: yGridCount + 1 },
                                  (_, i) =>
                                    minG + (spanG * i) / yGridCount,
                                );

                                const pathD = sorted
                                  .map((p, idx) => {
                                    const x = mapX(p.static_psi);
                                    const y = mapY(p.g_level);
                                    return `${idx === 0 ? "M" : "L"} ${x.toFixed(
                                      2,
                                    )} ${y.toFixed(2)}`;
                                  })
                                  .join(" ");

                                // X position of the operating line on the chart,
                                // using the same operatingFraction that drives the band.
                                let opX: number | null = null;
                                if (operatingFraction != null) {
                                  opX =
                                    PAD_X +
                                    operatingFraction *
                                      (VIEW_W - 2 * PAD_X);
                                } else if (hasOperating && operatingPsi != null) {
                                  // Fallback: same 0–3 psi clamp used by the band
                                  const psi = operatingPsi;
                                  const clamped =
                                    psi <= 0 ? 0 : psi >= 3 ? 3 : psi;
                                  const frac = clamped / 3;
                                  opX =
                                    PAD_X + frac * (VIEW_W - 2 * PAD_X);
                                }

                                // Nearest highlighted point coordinates
                                const nearestX =
                                  nearestCurvePoint != null
                                    ? mapX(nearestCurvePoint.static_psi)
                                    : null;
                                const nearestY =
                                  nearestCurvePoint != null
                                    ? mapY(nearestCurvePoint.g_level)
                                    : null;

                                return (
                                  <>
                                    <svg
                                      width={VIEW_W}
                                      height={VIEW_H}
                                      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                                      onMouseLeave={() => setHoverPoint(null)}
                                    >
                                      {/* Background */}
                                      <rect
                                        x={0}
                                        y={0}
                                        width={VIEW_W}
                                        height={VIEW_H}
                                        fill="#020617"
                                      />

                                      <defs>
                                        <linearGradient
                                          id="curveStroke"
                                          x1="0"
                                          y1="0"
                                          x2="1"
                                          y2="0"
                                        >
                                          <stop
                                            offset="0%"
                                            stopColor="#7dd3fc"
                                          />
                                          <stop
                                            offset="100%"
                                            stopColor="#38bdf8"
                                          />
                                        </linearGradient>
                                      </defs>

                                      {/* Grid lines behind everything */}
                                      {xGridValues.map((v, idx) => {
                                        const x = mapX(v);
                                        return (
                                          <line
                                            key={`gx-${idx}`}
                                            x1={x}
                                            y1={PAD_Y}
                                            x2={x}
                                            y2={VIEW_H - PAD_Y}
                                            stroke="#1e293b"
                                            strokeWidth={0.7}
                                            strokeDasharray="3 5"
                                          />
                                        );
                                      })}
                                      {yGridValues.map((v, idx) => {
                                        const y = mapY(v);
                                        return (
                                          <line
                                            key={`gy-${idx}`}
                                            x1={PAD_X}
                                            y1={y}
                                            x2={VIEW_W - PAD_X}
                                            y2={y}
                                            stroke="#1e293b"
                                            strokeWidth={0.7}
                                            strokeDasharray="3 5"
                                          />
                                        );
                                      })}

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

                                      {/* Axis ticks – Static load (psi), aligned with grid */}
                                      {xGridValues.map((v, idx) => {
                                        const x = mapX(v);
                                        const yAxis = VIEW_H - PAD_Y;
                                        return (
                                          <g key={`xt-${idx}`}>
                                            <line
                                              x1={x}
                                              y1={yAxis}
                                              x2={x}
                                              y2={yAxis - 6}
                                              stroke="#cbd5f5"
                                              strokeWidth={1}
                                            />
                                            <text
                                              x={x}
                                              y={yAxis + 12}
                                              textAnchor="middle"
                                              fontSize={9}
                                              fill="#cbd5f5"
                                            >
                                              {v.toFixed(3)}
                                            </text>
                                          </g>
                                        );
                                      })}

                                      {/* Axis ticks – G-level, aligned with grid */}
                                      {yGridValues.map((v, idx) => {
                                        const y = mapY(v);
                                        const xAxis = PAD_X;
                                        return (
                                          <g key={`yt-${idx}`}>
                                            <line
                                              x1={xAxis}
                                              y1={y}
                                              x2={xAxis + 6}
                                              y2={y}
                                              stroke="#cbd5f5"
                                              strokeWidth={1}
                                            />
                                            <text
                                              x={xAxis - 8}
                                              y={y + 3}
                                              textAnchor="end"
                                              fontSize={9}
                                              fill="#cbd5f5"
                                            >
                                              {v.toFixed(1)}
                                            </text>
                                          </g>
                                        );
                                      })}

                                      {/* Axis labels */}
                                      <text
                                        x={VIEW_W / 2}
                                        y={VIEW_H - 6}
                                        textAnchor="middle"
                                        fontSize={11}
                                        fill="#e5e7eb"
                                      >
                                        Static load (psi)
                                      </text>
                                      <text
                                        x={12}
                                        y={VIEW_H / 2}
                                        textAnchor="middle"
                                        fontSize={11}
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
                                        stroke="url(#curveStroke)"
                                        strokeWidth={1.8}
                                      />

                                      {/* Hoverable points */}
                                      {sorted.map((p, idx) => {
                                        const x = mapX(p.static_psi);
                                        const y = mapY(p.g_level);
                                        return (
                                          <circle
                                            key={`${p.static_psi}-${p.g_level}-${idx}`}
                                            cx={x}
                                            cy={y}
                                            r={3}
                                            fill="#e0f2fe"
                                            onMouseEnter={() =>
                                              setHoverPoint({ point: p, x, y })
                                            }
                                          />
                                        );
                                      })}

                                      {/* Operating point marker on chart */}
                                      {opX != null && (
                                        <>
                                          {/* Glow behind line */}
                                          <line
                                            x1={opX}
                                            y1={PAD_Y}
                                            x2={opX}
                                            y2={VIEW_H - PAD_Y}
                                            stroke="#0ea5e9"
                                            strokeWidth={4}
                                            strokeOpacity={0.2}
                                          />
                                          {/* Main dashed line */}
                                          <line
                                            x1={opX}
                                            y1={PAD_Y}
                                            x2={opX}
                                            y2={VIEW_H - PAD_Y}
                                            stroke="#f9fafb"
                                            strokeWidth={1}
                                            strokeDasharray="4 4"
                                          />
                                        </>
                                      )}

                                      {/* Nearest highlighted point */}
                                      {nearestX != null && nearestY != null && (
                                        <>
                                          <circle
                                            cx={nearestX}
                                            cy={nearestY}
                                            r={4.2}
                                            fill="#22c55e"
                                            stroke="#022c22"
                                            strokeWidth={1}
                                          />
                                          <circle
                                            cx={nearestX}
                                            cy={nearestY}
                                            r={7}
                                            fill="none"
                                            stroke="#22c55e"
                                            strokeWidth={1}
                                            strokeDasharray="3 3"
                                          />
                                        </>
                                      )}
                                    </svg>

                                    {/* Hover tooltip for tested point */}
                                    {hoverPoint && (
                                      <div
                                        className="absolute bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-[10px] text-slate-200 shadow-xl pointer-events-none"
                                        style={{
                                          left: `${hoverPoint.x + 15}px`,
                                          top: `${hoverPoint.y + 15}px`,
                                        }}
                                      >
                                        <div>
                                          <span className="text-sky-300 font-mono">
                                            {hoverPoint.point.static_psi.toFixed(
                                              3,
                                            )}
                                          </span>{" "}
                                          psi
                                        </div>
                                        <div>
                                          <span className="text-sky-300 font-mono">
                                            {hoverPoint.point.deflect_pct.toFixed(
                                              1,
                                            )}
                                          </span>{" "}
                                          % defl
                                        </div>
                                        <div>
                                          <span className="text-sky-300 font-mono">
                                            {hoverPoint.point.g_level.toFixed(
                                              1,
                                            )}
                                          </span>{" "}
                                          G
                                        </div>
                                      </div>
                                    )}

                                    {/* Legend */}
                                    <div className="absolute top-2 right-2 bg-slate-900/80 border border-slate-700 rounded-md px-2 py-1 text-[10px] text-slate-200 backdrop-blur-sm">
                                      <div className="flex items-center gap-1">
                                        <span className="w-2 h-2 bg-sky-300 inline-block rounded-sm"></span>
                                        Curve
                                      </div>
                                      <div className="flex items-center gap-1 mt-1">
                                        <span className="w-2 h-2 bg-emerald-400 inline-block rounded-sm"></span>
                                        Closest test point
                                      </div>
                                      <div className="flex items-center gap-1 mt-1">
                                        <span className="w-2 h-2 bg-slate-50 inline-block rounded-sm"></span>
                                        Operating load
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>

                            {/* Nearest-point numeric readout + disclaimer */}
                            {nearestCurvePoint && hasOperating && (
                              <div className="mt-3 text-[10px] text-slate-300">
                                <div>
                                  <span className="font-semibold text-slate-200">
                                    Nearest tested point:
                                  </span>{" "}
                                  <span className="font-mono text-sky-200">
                                    {nearestCurvePoint.static_psi.toFixed(3)} psi
                                  </span>
                                  <span className="text-slate-500">
                                    {" "}
                                    ·{" "}
                                  </span>
                                  <span className="font-mono text-sky-200">
                                    {nearestCurvePoint.deflect_pct.toFixed(1)}%
                                  </span>
                                  <span className="text-slate-500">
                                    {" "}
                                    ·{" "}
                                  </span>
                                  <span className="font-mono text-sky-200">
                                    {nearestCurvePoint.g_level.toFixed(1)} G
                                  </span>
                                </div>
                                <div className="mt-1 text-[9px] text-slate-500">
                                  Lab curves are a guide, not a guarantee.
                                  Always verify with real-world testing.
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                )}
              </div>
            </section>
            {/* RIGHT: Summary + recommendations (clickable) */}
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
                      <span className="font-semibold">Environment: </span>
                      {advisorResult.environmentLabel}
                    </p>
                    <p>
                      <span className="font-semibold">Fragility: </span>
                      {advisorResult.fragilityLabel}
                    </p>
                    {parsedBlock && (
                      <p className="mt-2 text-[10px] text-slate-500">
                        Block from layout: {parsedBlock.L}" × {parsedBlock.W}"
                        × {parsedBlock.H}".
                      </p>
                    )}
                  </div>

                  {/* Suggested foam families */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200">
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

                        const isActive =
                          !!selectedRecKey && selectedRecKey === rec.key;

                        return (
                          <div
                            key={rec.key}
                            className={[
                              "mb-3 last:mb-0 rounded-xl border px-3 py-2 cursor-pointer transition",
                              isActive
                                ? "border-sky-500/90 bg-slate-900 shadow-[0_0_0_1px_rgba(56,189,248,0.4)]"
                                : "border-slate-700 bg-slate-950/80 hover:border-sky-500/70 hover:bg-sky-500/5",
                            ].join(" ")}
                            onClick={() => setSelectedRecKey(rec.key)}
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
                              <div className="flex flex-col items-end gap-1">
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
                                {isActive && (
                                  <span className="inline-flex items-center rounded-full border border-sky-400/70 bg-sky-500/10 px-2 py-0.5 text-[9px] font-medium text-sky-100">
                                    Showing on canvas
                                  </span>
                                )}
                              </div>
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
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <a
                                      href={`/admin/cushion/curves/${firstMatched.id}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center rounded-full border border-sky-500/70 px-3 py-1 text-[10px] font-medium text-sky-100 hover:bg-sky-500/15 transition"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      View cushion curve
                                    </a>

                                    <button
                                      type="button"
                                      className="inline-flex items-center rounded-full border border-emerald-500/70 bg-emerald-500/20 px-3 py-1 text-[10px] font-medium text-emerald-100 hover:bg-emerald-500/30 transition"
                                      onClick={(e) => {
  e.stopPropagation();

  const mid = firstMatched.id;

// Prefer return_to if present — it contains the full editor seed
const currentUrl = new URL(window.location.href);
const returnTo = currentUrl.searchParams.get("return_to");

let editorUrl: URL;

if (returnTo) {
  // Decode once — return_to is already encoded
  editorUrl = new URL(decodeURIComponent(returnTo));
} else {
  // Fallback: current URL (safe for direct entry)
  editorUrl = new URL(currentUrl.href);
}

// Override / seed material only
editorUrl.searchParams.set("material_id", String(mid));

// Navigate back to editor with FULL preserved state
window.location.href = editorUrl.toString();

}}

                                    >
                                      Use this in layout
                                    </button>
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
