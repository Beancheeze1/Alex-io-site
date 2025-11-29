// app/foam-advisor/page.tsx
//
// Foam Advisor · Path A skeleton
//
// - Accessed from the layout editor "Recommend my foam" button.
// - Reads ?quote_no= and ?block=LxWxH from the searchParams prop.
// - Shows a simple form for:
//     • Product weight (lb)
//     • Contact area (in²)
//     • Environment
//     • Fragility
// - Prefills contact area from block L×W when available.
// - NO calls to pricing, quotes, or cushion_curves yet.
//   This is a UI-only starting point, safe for Path A.
//

"use client";

import * as React from "react";

type EnvironmentOption = "normal" | "cold_chain" | "vibration";
type FragilityOption = "very_fragile" | "moderate" | "rugged";

type SearchParams = {
  [key: string]: string | string[] | undefined;
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
  // ----- Read query params from props (no useSearchParams hook) -----

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
  const [submittedSummary, setSubmittedSummary] =
    React.useState<string | null>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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

    // For now, we only show a friendly summary.
    // A later Path A step will call a real /api/foam-advisor endpoint
    // that uses materials + cushion_curves to pick 2–3 foams.
    const staticLoadPsi = w / a;

    let envLabel = "Normal shipping";
    if (environment === "cold_chain") envLabel = "Cold chain / low temp";
    if (environment === "vibration")
      envLabel = "Heavy vibration / rough handling";

    let fragLabel = "General industrial";
    if (fragility === "very_fragile")
      fragLabel = "Very fragile electronics / optics";
    if (fragility === "rugged") fragLabel = "Rugged hardware";

    const parts: string[] = [];
    parts.push(
      `Static load ≈ ${staticLoadPsi.toFixed(3)} psi (weight ÷ area).`,
    );
    parts.push(`Environment: ${envLabel}.`);
    parts.push(`Fragility band: ${fragLabel}.`);
    if (parsedBlock) {
      parts.push(
        `Block: ${parsedBlock.L}" × ${parsedBlock.W}" × ${parsedBlock.H}" (from layout).`,
      );
    }
    if (quoteNo) {
      parts.push(`Linked quote: ${quoteNo}.`);
    }

    setSubmittedSummary(parts.join(" "));
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
              Start by telling Alex-IO about your product and how it ships. In a
              later step, this advisor will use your existing{" "}
              <span className="font-semibold text-sky-300">
                materials
              </span>{" "}
              and{" "}
              <span className="font-semibold text-sky-300">
                cushion_curves
              </span>{" "}
              tables to recommend 2–3 foam options (PE / PU / XLPE) and show
              where your operating point lands on the curve.
            </p>

            {parsedBlock && (
              <div className="mb-4 inline-flex items-center rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-200">
                <span className="font-semibold mr-1">From layout:</span>
                Block{" "}
                <span className="font-mono ml-1">
                  {parsedBlock.L}" × {parsedBlock.W}" × {parsedBlock.H}"
                </span>
                <span className="ml-2 text-slate-400">
                  (contact area prefilled from L × W when empty)
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
                    Helps pick curves and safety factors for harsher shipping
                    conditions.
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
                  className="inline-flex items-center rounded-full border border-sky-500/80 bg-sky-500 px-4 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400 transition"
                >
                  Analyze and prepare recommendation
                </button>
                <span className="text-[11px] text-slate-500">
                  For now this shows a summary and static load. Next step will
                  return actual foam picks.
                </span>
              </div>
            </form>

            {submittedSummary && (
              <div className="mt-5 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-[11px] text-slate-200">
                <div className="font-semibold text-sky-200 mb-1">
                  Analysis summary (preview only)
                </div>
                <p className="leading-snug">{submittedSummary}</p>
                <p className="mt-2 text-[10px] text-slate-500">
                  In a future Path A step, this screen will list the top 2–3
                  foam families/grades from your database (PE, PU, XLPE) and can
                  show a comparison cushion curve with your operating point
                  highlighted.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
