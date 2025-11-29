// app/foam-advisor/page.tsx
//
// Foam Advisor · Path A layout refresh
//
// - Reads ?quote_no= and ?block=LxWxH from searchParams prop.
// - Lets the user enter:
//     • Product weight (lb)
//     • Contact area (in²)
//     • Environment
//     • Fragility
// - On submit, POSTS to /api/foam-advisor/recommend.
// - ALSO loads your real foam catalog from /api/materials and,
//   for each recommendation, shows matching materials (PE / PU / XLPE)
//   in the density band suggested by the API.
//
// This version keeps all behavior the same, but wraps the UI in the
// same three-column dark layout shell as the layout editor so that
// clicking “Recommend my foam” feels visually consistent.
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

  // Prefill contact area from block L×W if available
  React.useEffect(() => {
    if (!parsedBlock) return;
    const { L, W } = parsedBlock;
    if (L > 0 && W > 0) {
      const area = L * W;
      // Only prefill if user hasn't started typing
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

        // If nothing is in the band, fall back to any in the family
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

          {/* Body – three-column layout like the editor */}
          <div className="flex flex-row gap-5 p-5 bg-slate-950/90 text-slate-100">
            {/* LEFT: context + block info */}
            <aside className="w-60 shrink-0 flex flex-col gap-3">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  How this works
                </div>
                <p className="text-[11px] text-slate-400">
                  Tell Alex-IO about your product and how it ships. Foam
                  Advisor calculates static load and suggests foam families as a
                  starting point.
                </p>
                <p className="mt-2 text-[11px] text-slate-500">
                  In later Path A steps, this screen will pull directly from{" "}
                  <span className="text-sky-300">materials</span> and{" "}
                  <span className="text-sky-300">cushion_curves</span> to
                  highlight your operating point on real curves.
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
                    override it in the form.
                  </div>
                </div>
              )}
            </aside>

            {/* CENTER: form + result */}
            <section className="flex-1 flex flex-col gap-3">
              {/* Intro text */}
              <p className="text-[11px] text-slate-400 leading-snug">
                Start by telling Alex-IO about your product and how it ships.
                This advisor calculates your static load and suggests foam
                families as a starting point. Later, the same inputs will drive
                a live cushion-curve overlay.
              </p>

              {/* Advisor form */}
              <form
                onSubmit={handleSubmit}
                className="space-y-4 max-w-xl text-xs bg-slate-900 rounded-2xl border border-slate-800 p-4"
              >
                <div className="grid grid-cols-2 gap-4">
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
                      Area of foam directly supporting the product. For a snug
                      fit, this is often close to the cavity footprint.
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
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
                      Helps tune the recommendation toward harsher conditions.
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
                      Later this will map to g-level bands for selecting curves.
                    </span>
                  </label>
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition disabled:opacity-60"
                  >
                    {submitting
                      ? "Analyzing…"
                      : "Analyze and prepare recommendation"}
                  </button>
                  <span className="text-[11px] text-slate-500">
                    Uses your foam catalog to show example materials for each
                    pick.
                  </span>
                </div>
              </form>

              {/* Errors */}
              {advisorError && (
                <div className="mt-3 rounded-xl border border-amber-600 bg-amber-900/60 px-4 py-3 text-[11px] text-amber-50">
                  {advisorError}
                </div>
              )}

              {materialsError && (
                <div className="mt-3 rounded-xl border border-amber-700 bg-amber-950/70 px-4 py-3 text-[11px] text-amber-100">
                  {materialsError}
                </div>
              )}

              {/* Results */}
              {advisorResult && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Analysis summary card */}
                  <div className="md:col-span-1 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200">
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

                  {/* Recommendations */}
                  <div className="md:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold text-slate-100">
                        Suggested foam families (mapped to your catalog)
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Using /api/materials to show example SKUs.
                      </div>
                    </div>

                    {advisorResult.recommendations.length === 0 ? (
                      <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-300">
                        No specific suggestions returned for this combination
                        yet.
                      </div>
                    ) : (
                      advisorResult.recommendations.map((rec) => {
                        const matchedMaterials =
                          findMaterialsForRecommendation(rec);

                        return (
                          <div
                            key={rec.key}
                            className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200"
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
                            <p className="mt-1 leading-snug text-[11px]">
                              {rec.notes}
                            </p>

                            {matchedMaterials.length > 0 && (
                              <div className="mt-2 text-[10px] text-slate-400">
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
                </div>
              )}
            </section>

            {/* RIGHT: legend / future curve info */}
            <aside className="w-64 shrink-0 flex flex-col gap-3">
              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  What&apos;s coming next
                </div>
                <p className="text-[11px] text-slate-400">
                  Once cushion curves are wired in, this panel will show how the
                  chosen foam family sits on the curve at your operating psi,
                  with soft / typical / firm bands highlighted.
                </p>
              </div>

              <div className="bg-slate-900 rounded-2xl border border-slate-800 p-3">
                <div className="text-xs font-semibold text-slate-100 mb-1">
                  Catalog mapping
                </div>
                <p className="text-[11px] text-slate-400">
                  Each recommendation is mapped to your real materials by
                  family and density band. This uses the same{" "}
                  <span className="font-mono text-sky-300">
                    /api/materials
                  </span>{" "}
                  endpoint the layout editor uses.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
