// app/foam-advisor/page.tsx
//
// Foam Advisor · Path A step 2
//
// - Reads ?quote_no= and ?block=LxWxH from searchParams prop.
// - Lets the user enter:
//     • Product weight (lb)
//     • Contact area (in²)
//     • Environment
//     • Fragility
// - On submit, POSTS to /api/foam-advisor/recommend and shows:
//     • Static load summary
//     • 2–3 generic foam recommendations.
// - Still NO direct DB access here; the API is a stub that we can
//   later swap to read from materials + cushion_curves.
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
};

type AdvisorResult = {
  staticLoadPsi: number;
  staticLoadPsiLabel: string;
  environmentLabel: string;
  fragilityLabel: string;
  recommendations: AdvisorRecommendation[];
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

  return (
    <main className="min-h-screen bg-slate-950 flex items-stretch py-8 px-4">
      <div className="w-full max-w-4xl mx-auto">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/90 shadow-[0_22px_45px_rgba(15,23,42,0.85)] overflow-hidden">
          {/* Header */}
          <div className="border-b border-slate-800 bg-gradient-to-r from-sky-500 via-sky-500/80 to-slate-900 px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-sky-50/90">
                  Powered by Alex-IO
                </div>
                <div className="mt-1 text-xs text-sky-50/95">
                  Foam Advisor{" "}
                  {hasQuote && (
                    <>
                      · Quote{" "}
                      <span className="font-mono font-semibold text-slate-50">
                        {quoteNo}
                      </span>
                    </>
                  )}
                  {!hasQuote && (
                    <span className="ml-1 text-amber-50/90">
                      · No quote linked (demo input)
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-50">
                  Foam recommendation assistant
                </div>
                <div className="mt-1 inline-flex items-center rounded-full border border-slate-200/70 bg-slate-900/40 px-3 py-1 text-[11px] font-medium text-sky-50">
                  Foam Advisor · BETA
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 bg-slate-950/90 text-slate-100">
            <p className="text-[11px] text-slate-400 mb-4 leading-snug">
              Start by telling Alex-IO about your product and how it ships. This
              advisor calculates your static load and suggests foam families as
              a starting point. In a later Path A step, this same screen will
              use your{" "}
              <span className="font-semibold text-sky-300">
                materials
              </span>{" "}
              and{" "}
              <span className="font-semibold text-sky-300">
                cushion_curves
              </span>{" "}
              tables to return live recommendations and highlight your
              operating point on the curve.
            </p>

            {parsedBlock && (
              <div className="mb-4 inline-flex items-center rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-200">
                <span className="font-semibold mr-1">From layout:</span>
                Block{" "}
                <span className="font-mono ml-1">
                  {parsedBlock.L}" × {parsedBlock.W}" × {parsedBlock.H}"
                </span>
                <span className="ml-2 text-slate-400">
                  (contact area can start from L × W)
                </span>
              </div>
            )}

            {/* Advisor form */}
            <form
              onSubmit={handleSubmit}
              className="space-y-4 max-w-xl text-xs"
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
                      setEnvironment(e.target.value as EnvironmentOption)
                    }
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  >
                    <option value="normal">Normal parcel / LTL</option>
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
                      setFragility(e.target.value as FragilityOption)
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
                  This version uses generic foam families. Next step: wire this
                  into your real materials + cushion_curves data.
                </span>
              </div>
            </form>

            {advisorError && (
              <div className="mt-4 rounded-xl border border-amber-600 bg-amber-900/60 px-4 py-3 text-[11px] text-amber-50">
                {advisorError}
              </div>
            )}

            {advisorResult && (
              <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Summary card */}
                <div className="md:col-span-1 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200">
                  <div className="font-semibold text-sky-200 mb-1">
                    Analysis summary
                  </div>
                  <p className="mb-2">{advisorResult.staticLoadPsiLabel}</p>
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
                      Block from layout: {parsedBlock.L}" × {parsedBlock.W}" ×{" "}
                      {parsedBlock.H}".
                    </p>
                  )}
                </div>

                {/* Recommendations */}
                <div className="md:col-span-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-semibold text-slate-100">
                      Suggested foam families (preview)
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Generic bands only – will be hooked to your actual
                      materials list.
                    </div>
                  </div>

                  {advisorResult.recommendations.length === 0 ? (
                    <div className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-300">
                      No specific suggestions returned for this combination yet.
                    </div>
                  ) : (
                    advisorResult.recommendations.map((rec) => (
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
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
