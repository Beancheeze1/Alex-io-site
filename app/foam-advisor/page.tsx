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

type FragilityTier = {
  key: string;
  label: string;
  gMin: number;
  gMax: number | null;
};

// How many ranked candidates to actually display -- the API still returns
// every material with curve data (ranked), but the list only ever showed
// value in the top few; showing all 60+ buried the best matches.
const TOP_CANDIDATES_SHOWN = 3;

// Mirrors app/lib/cushion/engine.ts FRAGILITY_TIERS -- standard, generic
// industry tiers, kept in sync with the API response's `reference.fragilityTiers`.
const DEFAULT_FRAGILITY_TIERS: FragilityTier[] = [
  { key: "very_delicate", label: "Extremely / Very Delicate", gMin: 0, gMax: 25 },
  { key: "delicate", label: "Delicate", gMin: 25, gMax: 40 },
  { key: "fragile", label: "Fragile", gMin: 40, gMax: 60 },
  { key: "moderately_fragile", label: "Moderately Fragile", gMin: 60, gMax: 85 },
  { key: "rugged", label: "Rugged", gMin: 85, gMax: 100 },
  { key: "very_rugged", label: "Very Rugged", gMin: 100, gMax: null },
];

type SearchParams = {
  [key: string]: string | string[] | undefined;
};

type CurveProvenance = "tested" | "proxy" | "unverified" | "modeled" | null;

type ThicknessSummary = {
  thickness_in: number;
  provenance: CurveProvenance;
  point_count: number;
  min_g: number;
  min_tested_psi: number;
  max_tested_psi: number;
  meets_target: boolean;
};

type Recommendation = {
  recommended_thickness_in: number;
  provenance: CurveProvenance;
  safe_static_loading_range_psi: { low: number; high: number };
  recommended_bearing_area_in2: number;
  conservative_bearing_area_in2: number;
  low_bound_extends_beyond_tested_data: boolean;
  high_bound_extends_beyond_tested_data: boolean;
};

type MaterialCandidate = {
  material_id: number;
  name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  price_per_bf: number | null;
  min_charge_usd: number | null;
  mode: "recommend" | "verify_only";
  thickness_options: ThicknessSummary[];
  requested_thickness_in: number | null;
  operating_psi: number;
  verify_thickness_in: number;
  g_at_operating_psi: number;
  extrapolated_beyond_tested_range: boolean;
  meets_fragility_target: boolean;
  margin_g: number;
  recommendation: Recommendation | null;
  curve: {
    point_count: number;
    provenance: CurveProvenance;
    thickness_in: number | null;
    drop_in: number | null;
    source: string | null;
    nearest_tested_psi: number;
  };
  caveats: string[];
};

type MaterialWithoutRequestedThickness = {
  material_id: number;
  name: string;
  material_family: string | null;
  available_thicknesses: number[];
};

type AdvisorResult = {
  staticLoadPsi: number;
  staticLoadPsiLabel: string;
  environmentLabel: string;
  fragilityGMax: number;
  fragilityTier: { key: string; label: string };
  dropHeightIn: number;
  dropHeightSuggested: boolean;
  requestedThicknessIn: number | null;
  candidates: MaterialCandidate[];
  materialsConsidered: number;
  materialsWithoutCurveData: number;
  materialsWithoutRequestedThickness: MaterialWithoutRequestedThickness[];
};

type CushionPoint = {
  static_psi: number;
  // Not available from the source charts for the vast majority of the
  // catalog (see cushion_curves.deflect_note) -- null, not a guessed value.
  deflect_pct: number | null;
  g_level: number;
  thickness_in?: number | null;
  drop_in?: number | null;
  provenance?: CurveProvenance;
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
  productContactLengthIn?: string;
  productContactWidthIn?: string;
  contactAreaIn2?: string;
  environment?: EnvironmentOption;
  fragilityGMax?: string;
  dropHeightIn?: string;
  thicknessIn?: string;
};

// Mirrors app/lib/cushion/engine.ts DROP_HEIGHT_TABLE -- standard ASTM
// D-3332-style weight-based drop-height table (generic reference values).
const DROP_HEIGHT_TABLE: { minLb: number; maxLb: number | null; dropIn: number }[] = [
  { minLb: 0, maxLb: 25, dropIn: 42 },
  { minLb: 25, maxLb: 50, dropIn: 36 },
  { minLb: 50, maxLb: 100, dropIn: 30 },
  { minLb: 100, maxLb: 500, dropIn: 24 },
  { minLb: 500, maxLb: 1000, dropIn: 18 },
  { minLb: 1000, maxLb: null, dropIn: 12 },
];

function suggestDropHeightIn(weightLb: number): number {
  const band =
    DROP_HEIGHT_TABLE.find(
      (b) => weightLb >= b.minLb && (b.maxLb == null || weightLb <= b.maxLb),
    ) ?? DROP_HEIGHT_TABLE[DROP_HEIGHT_TABLE.length - 1];
  return band.dropIn;
}

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

function toPositiveNumber(raw: string): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

// Surfaces whether a curve was actually digitized for this exact material
// ("tested"), adapted from a nearby-density material's curve ("proxy"), has
// no source document on file at all ("unverified"), or is a mathematical
// extrapolation from this material's own tested curve ("modeled", Burgess
// stress-energy method) -- see cushion_curves.provenance.
function ProvenanceBadge({ provenance }: { provenance: CurveProvenance }) {
  if (!provenance) return null;
  const styles: Record<string, string> = {
    tested:
      "bg-[var(--status-success-bg)] border-[var(--status-success-text)]/30 text-[var(--status-success-text)]",
    proxy:
      "bg-[var(--attention-bg)] border-[var(--attention-border)] text-[var(--attention)]",
    unverified:
      "bg-[var(--status-neutral-bg)] border-[var(--border-strong)] text-[var(--status-neutral-text)]",
    modeled:
      "bg-[var(--action-primary)]/10 border-[var(--action-primary)]/40 text-[var(--action-primary)]",
  };
  const labels: Record<string, string> = {
    tested: "Tested curve",
    proxy: "Proxy curve",
    unverified: "Unverified",
    modeled: "Modeled from tested data",
  };
  const titles: Record<string, string> = {
    tested: "Digitized directly from a manufacturer cushion-curve chart for this material.",
    proxy: "Adapted from a different, nearby-density material's tested curve -- not digitized for this exact material.",
    unverified: "No source document is on file for this curve; values are unverified.",
    modeled:
      "Mathematically derived (Burgess stress-energy method) from this material's own tested curve at a different thickness -- not measured. Validated accuracy: 16-45% typical error, up to 200%+ at range extremes. Treat with more caution than tested or proxy data.",
  };
  return (
    <span
      title={titles[provenance] ?? ""}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
        styles[provenance] ?? ""
      }`}
    >
      {labels[provenance] ?? provenance}
    </span>
  );
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
  const [productContactLengthIn, setProductContactLengthIn] =
    React.useState<string>("");
  const [productContactWidthIn, setProductContactWidthIn] =
    React.useState<string>("");
  const [contactAreaIn2, setContactAreaIn2] =
    React.useState<string>("");
  const [environment, setEnvironment] =
    React.useState<EnvironmentOption>("normal");
  const [fragilityGMax, setFragilityGMax] = React.useState<string>("60");
  const [dropHeightIn, setDropHeightIn] = React.useState<string>("");
  const [dropHeightTouched, setDropHeightTouched] = React.useState(false);
  // Optional: the product's actual/proposed under-cushion thickness. Blank
  // -> recommend mode (find the minimum thickness that meets target).
  // Filled in -> verify mode (check that exact thickness only).
  const [thicknessIn, setThicknessIn] = React.useState<string>("");

  const computedContactAreaIn2 = React.useMemo(() => {
    const L = toPositiveNumber(productContactLengthIn);
    const W = toPositiveNumber(productContactWidthIn);
    if (L == null || W == null) return null;
    const area = L * W;
    if (!Number.isFinite(area) || area <= 0) return null;
    return area;
  }, [productContactLengthIn, productContactWidthIn]);

  React.useEffect(() => {
    if (computedContactAreaIn2 == null) {
      setContactAreaIn2("");
      return;
    }
    setContactAreaIn2(computedContactAreaIn2.toFixed(2));
  }, [computedContactAreaIn2]);

  // Suggested drop height from the standard weight-based table. Auto-fills
  // the input as the user types a weight, but stops overriding once they've
  // manually edited the drop-height field themselves.
  React.useEffect(() => {
    if (dropHeightTouched) return;
    const w = toPositiveNumber(weightLb);
    if (w == null) return;
    setDropHeightIn(String(suggestDropHeightIn(w)));
  }, [weightLb, dropHeightTouched]);

  // Advisor result / status
  const [advisorResult, setAdvisorResult] =
    React.useState<AdvisorResult | null>(null);
  const [advisorError, setAdvisorError] =
    React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState<boolean>(false);

  // Which candidate material_id is currently driving the center canvas
  const [selectedRecKey, setSelectedRecKey] =
    React.useState<number | null>(null);

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
      if (parsed.productContactLengthIn != null) {
        setProductContactLengthIn(String(parsed.productContactLengthIn));
      }
      if (parsed.productContactWidthIn != null) {
        setProductContactWidthIn(String(parsed.productContactWidthIn));
      }
      if (parsed.contactAreaIn2 != null) {
        setContactAreaIn2(String(parsed.contactAreaIn2));
      }
      if (parsed.environment) {
        setEnvironment(parsed.environment);
      }
      if (parsed.fragilityGMax != null) {
        setFragilityGMax(String(parsed.fragilityGMax));
      }
      if (parsed.dropHeightIn != null) {
        setDropHeightIn(String(parsed.dropHeightIn));
        setDropHeightTouched(true);
      }
      if (parsed.thicknessIn != null) {
        setThicknessIn(String(parsed.thicknessIn));
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
      productContactLengthIn,
      productContactWidthIn,
      contactAreaIn2,
      environment,
      fragilityGMax,
      dropHeightIn,
      thicknessIn,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }, [
    effectiveQuoteNo,
    weightLb,
    productContactLengthIn,
    productContactWidthIn,
    contactAreaIn2,
    environment,
    fragilityGMax,
    thicknessIn,
    dropHeightIn,
  ]);

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
    const L = toPositiveNumber(productContactLengthIn);
    const W = toPositiveNumber(productContactWidthIn);
    const a = L != null && W != null ? L * W : NaN;
    const gMax = toPositiveNumber(fragilityGMax);
    const dropIn = toPositiveNumber(dropHeightIn);
    // Optional -- blank means "recommend mode", a value means "verify this
    // exact thickness". toPositiveNumber returns null for blank/invalid.
    const thicknessInVal = toPositiveNumber(thicknessIn);

    if (!Number.isFinite(w) || w <= 0) {
      alert("Please enter a valid product weight (lb).");
      return;
    }
    if (L == null || W == null) {
      alert(
        "Please enter a valid product contact length and width (in).",
      );
      return;
    }
    if (!Number.isFinite(a) || a <= 0) {
      alert("Contact area could not be computed.");
      return;
    }
    if (gMax == null) {
      alert("Please enter a valid fragility G target.");
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
          fragilityGMax: gMax,
          dropHeightIn: dropIn ?? undefined,
          thicknessIn: thicknessInVal ?? undefined,
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
        fragilityGMax: Number(json.fragilityGMax) || gMax,
        fragilityTier: json.fragilityTier ?? { key: "", label: "" },
        dropHeightIn: Number(json.dropHeightIn) || dropIn || 24,
        dropHeightSuggested: !!json.dropHeightSuggested,
        requestedThicknessIn:
          json.requestedThicknessIn != null ? Number(json.requestedThicknessIn) : null,
        candidates: Array.isArray(json.candidates) ? json.candidates : [],
        materialsConsidered: Number(json.materialsConsidered) || 0,
        materialsWithoutCurveData: Number(json.materialsWithoutCurveData) || 0,
        materialsWithoutRequestedThickness: Array.isArray(
          json.materialsWithoutRequestedThickness,
        )
          ? json.materialsWithoutRequestedThickness
          : [],
      };

      // Default the canvas to the top-ranked candidate (best real match).
      const defaultKey =
        result.candidates.length > 0 ? result.candidates[0].material_id : null;

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

  // Auto-load the cushion curve for the selected candidate material. Unlike
  // the old stub, `candidates` already ARE real materials queried from
  // cushion_curves -- no separate family/density matching step needed.
  // Some materials now have multiple digitized thicknesses; we fetch the
  // ONE curve the candidate is actually being evaluated on (its
  // curve.thickness_in -- the recommended thickness in "recommend" mode, or
  // the material's single thickness in "verify_only" mode), not a mix.
  React.useEffect(() => {
    if (!advisorResult) return;
    if (!advisorResult.candidates.length) return;
    if (!selectedRecKey) return;

    const candidate = advisorResult.candidates.find(
      (c) => c.material_id === selectedRecKey,
    );
    if (!candidate) return;
    const thicknessIn = candidate.curve.thickness_in;

    // If we already have this exact material+thickness loaded, do nothing
    if (
      curveMaterial &&
      curveMaterial.id === selectedRecKey &&
      curvePoints.length &&
      curvePoints[0]?.thickness_in === thicknessIn
    ) {
      return;
    }

    let cancelled = false;

    async function loadCurve() {
      setCurveLoading(true);
      setCurveError(null);
      setHoverPoint(null);

      try {
        const qs = thicknessIn != null ? `?thickness_in=${thicknessIn}` : "";
        const res = await fetch(`/api/cushion/curves/${selectedRecKey}${qs}`, {
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
  }, [advisorResult, selectedRecKey, curveMaterial, curvePoints.length]);

  // The currently selected candidate (drives the canvas + provenance badge)
  const selectedCandidate: MaterialCandidate | null = React.useMemo(() => {
    if (!advisorResult || !advisorResult.candidates.length) return null;
    if (!selectedRecKey) return null;
    return (
      advisorResult.candidates.find((c) => c.material_id === selectedRecKey) ??
      null
    );
  }, [advisorResult, selectedRecKey]);

  return (
    <main className="min-h-screen bg-[var(--surface-page)] flex items-stretch py-8 px-4">
      <div className="w-full max-w-6xl mx-auto">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] shadow-sm overflow-hidden">
          {/* Header – match layout editor vibe */}
          <div className="border-b border-[var(--border)] bg-[var(--surface-subtle)] px-6 py-4">
            <div className="flex items-center gap-4 w-full">
              {/* LEFT: powered by + quote */}
              <div className="flex flex-col">
                <div className="text-[11px] font-medium tracking-[0.16em] uppercase text-[var(--text-secondary)]">
                  Powered by Alex-IO
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  Foam Advisor ·{" "}
                  {hasQuote ? (
                    <>
                      Quote{" "}
                      <span className="font-mono font-medium text-[var(--text-primary)]">
                        {effectiveQuoteNo}
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">
                      No quote linked (demo input)
                    </span>
                  )}
                </div>
              </div>

              {/* CENTER: big title */}
              <div className="flex-1 text-center">
                <div className="text-xl font-medium text-[var(--text-primary)] leading-snug">
                  Foam recommendation assistant
                </div>
              </div>

              {/* RIGHT: BETA pill */}
              <div className="flex items-center justify-end">
                <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-card)] px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
                  Foam Advisor · BETA
                </span>
              </div>
            </div>
          </div>

          {/* Body – three-column layout */}
          <div className="flex flex-row gap-5 p-5 bg-[var(--surface-card)] text-[var(--text-primary)]">
            {/* LEFT: Inputs + context */}
            <aside className="w-72 shrink-0 flex flex-col gap-3">
              <div className="bg-[var(--surface-subtle)] rounded-2xl border border-[var(--border)] p-3">
                <div className="text-xs font-medium text-[var(--text-primary)] mb-1">
                  How this works
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Enter the product weight, contact area, environment, and
                  fragility. Foam Advisor computes static load and suggests foam
                  families as a starting point.
                </p>
                <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                  The center canvas uses your cushion curve data to show where
                  this load sits.
                </p>
              </div>

              {parsedBlock && (
                <div className="bg-[var(--surface-subtle)] rounded-2xl border border-[var(--border)] p-3 text-[11px] text-[var(--text-secondary)]">
                  <div className="text-xs font-medium text-[var(--text-primary)] mb-1">
                    From layout
                  </div>
                  <div className="font-mono">
                    {parsedBlock.L}" × {parsedBlock.W}" × {parsedBlock.H}"
                  </div>
                  <div className="mt-1 text-[var(--text-muted)]">
                    Contact area can start as L × W for snug fits. You can
                    override it below.
                  </div>
                </div>
              )}

              {/* Advisor form */}
              <form
                onSubmit={handleSubmit}
                className="space-y-4 text-xs bg-[var(--surface-subtle)] rounded-2xl border border-[var(--border)] p-4"
              >
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Product weight (lb)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={weightLb}
                      onChange={(e) => setWeightLb(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">
                      Approximate weight of the protected item or load on each
                      cavity.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Product contact length (in)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={productContactLengthIn}
                      onChange={(e) =>
                        setProductContactLengthIn(e.target.value)
                      }
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">
                      Length of the area actually touching/supporting the product.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Product contact width (in)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={productContactWidthIn}
                      onChange={(e) =>
                        setProductContactWidthIn(e.target.value)
                      }
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">
                      Width of the area actually touching/supporting the product.
                    </span>
                  </label>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-page)] px-3 py-2">
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      Contact area (computed)
                    </div>
                    <div className="mt-1 flex items-baseline justify-between">
                      <div className="font-mono text-[var(--text-primary)] text-[12px]">
                        {computedContactAreaIn2 != null
                          ? `${computedContactAreaIn2.toFixed(2)} in`
                          : ""}
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)]">L  W</div>
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--text-faint)]">
                      This drives psi and the cushion curve operating point.
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Shipping environment
                    </span>
                    <select
                      value={environment}
                      onChange={(e) =>
                        setEnvironment(
                          e.target.value as EnvironmentOption,
                        )
                      }
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
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
                    <span className="text-[10px] text-[var(--text-faint)]">
                      Informational for now -- not yet part of the G-level
                      calculation below.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Drop height (in)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={dropHeightIn}
                      onChange={(e) => {
                        setDropHeightTouched(true);
                        setDropHeightIn(e.target.value);
                      }}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {dropHeightTouched
                        ? "Overriding the standard weight-based suggestion."
                        : "Suggested from the standard weight-based drop-height table -- edit to override."}
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Fragility target (max G)
                    </span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={fragilityGMax}
                      onChange={(e) => setFragilityGMax(e.target.value)}
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {DEFAULT_FRAGILITY_TIERS.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setFragilityGMax(String(t.gMax ?? t.gMin))}
                          className="rounded-full border border-[var(--border)] bg-[var(--surface-page)] px-2 py-0.5 text-[9px] text-[var(--text-secondary)] hover:border-[var(--action-primary)] hover:text-[var(--text-primary)]"
                          title={`${t.gMin}${t.gMax != null ? `–${t.gMax}` : "+"} G`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <span className="text-[10px] text-[var(--text-faint)]">
                      Standard industry fragility tiers. Pick one or enter a
                      custom max-G value.
                    </span>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)]">
                      Under-cushion thickness (in) -- optional
                    </span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={thicknessIn}
                      onChange={(e) => setThicknessIn(e.target.value)}
                      placeholder="Leave blank for a recommendation"
                      className="rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-2 py-1 text-xs text-[var(--text-primary)]"
                    />
                    <span className="text-[10px] text-[var(--text-faint)]">
                      {thicknessIn.trim()
                        ? "Verifying this exact thickness against real/modeled data -- no recommendation will be shown."
                        : "Leave blank to get a minimum-thickness recommendation where real data supports it. Enter a value to check a specific thickness instead."}
                    </span>
                  </label>
                </div>

                <div className="pt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center rounded-md border border-[var(--action-primary)] bg-[var(--action-primary)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--action-primary-hover)] transition disabled:opacity-60"
                  >
                    {submitting
                      ? "Analyzing…"
                      : "Analyze and prepare recommendation"}
                  </button>
                </div>

                {advisorError && (
                  <div className="mt-3 rounded-xl border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-[11px] text-[var(--attention)]">
                    {advisorError}
                  </div>
                )}
              </form>
            </aside>

            {/* CENTER: Graphical cushion canvas */}
            <section className="flex-1 flex flex-col">
              <div className="bg-[var(--surface-subtle)] rounded-2xl border border-[var(--border)] p-4 flex-1 flex flex-col shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] font-medium text-[var(--text-primary)] tracking-tight">
                    Cushion curve canvas
                  </div>
                  <div className="text-[10px] text-[var(--text-faint)]">
                    Choose a recommendation on the right to drive this view.
                  </div>
                </div>

                {/* States when we don't have an analysis yet */}
                {!advisorResult && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-[11px] text-[var(--text-faint)] text-center max-w-xs">
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
                    <div className="text-[11px] text-[var(--text-secondary)]">
                      <div className="mb-1">
                        <span className="font-medium text-[var(--text-primary)]">
                          Static load:
                        </span>{" "}
                        {advisorResult.staticLoadPsi.toFixed(3)} psi
                      </div>
                      <p>{advisorResult.staticLoadPsiLabel}</p>
                    </div>

                    {/* Band visualization */}
                    <div className="mt-2">
                      <div className="text-[11px] text-[var(--text-secondary)] mb-1">
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
                      <p className="mt-1 text-[10px] text-[var(--text-faint)]">
                        The colored bar shows a typical static-load range for
                        this type of foam. The dashed line and glow mark where
                        your product sits within that range.
                      </p>
                    </div>
                    {/* Curve loading / error / chart */}
                    <div className="mt-3 flex-1 flex flex-col">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] font-medium text-[var(--text-primary)] flex items-center gap-2">
                          {selectedCandidate
                            ? `Curve preview: ${selectedCandidate.name}`
                            : "Top-ranked curve preview"}
                          {selectedCandidate?.curve.provenance && (
                            <ProvenanceBadge
                              provenance={selectedCandidate.curve.provenance}
                            />
                          )}
                        </div>
                        <div className="text-[10px] text-[var(--text-faint)]">
                          Source: public.cushion_curves
                        </div>
                      </div>

                      {curveLoading && (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-[11px] text-[var(--text-secondary)]">
                            Loading cushion curve data…
                          </div>
                        </div>
                      )}

                      {!curveLoading && curveError && (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="rounded-xl border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-[11px] text-[var(--attention)] max-w-xs text-center">
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
                            <div className="text-[11px] text-[var(--text-faint)] text-center max-w-xs">
                              No curve data was found for the selected catalog
                              material yet. You can still click{" "}
                              <span className="font-medium">
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
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              {curveMaterial ? (
                                <>
                                  Plotting{" "}
                                  <span className="font-medium text-[var(--text-primary)]">
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
                                        {hoverPoint.point.deflect_pct != null && (
                                          <div>
                                            <span className="text-sky-300 font-mono">
                                              {hoverPoint.point.deflect_pct.toFixed(
                                                1,
                                              )}
                                            </span>{" "}
                                            % defl
                                          </div>
                                        )}
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
                              <div className="mt-3 text-[10px] text-[var(--text-secondary)]">
                                <div>
                                  <span className="font-medium text-[var(--text-primary)]">
                                    Nearest tested point:
                                  </span>{" "}
                                  <span className="font-mono text-[var(--text-primary)]">
                                    {nearestCurvePoint.static_psi.toFixed(3)} psi
                                  </span>
                                  <span className="text-[var(--text-faint)]">
                                    {" "}
                                    ·{" "}
                                  </span>
                                  {nearestCurvePoint.deflect_pct != null ? (
                                    <>
                                      <span className="font-mono text-[var(--text-primary)]">
                                        {nearestCurvePoint.deflect_pct.toFixed(1)}%
                                      </span>
                                      <span className="text-[var(--text-faint)]">
                                        {" "}
                                        ·{" "}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[var(--text-faint)]" title="Not present in the source chart -- see cushion_curves.deflect_note">
                                      deflection n/a ·{" "}
                                    </span>
                                  )}
                                  <span className="font-mono text-[var(--text-primary)]">
                                    {nearestCurvePoint.g_level.toFixed(1)} G
                                  </span>
                                </div>
                                <div className="mt-1 text-[9px] text-[var(--text-faint)]">
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
                <div className="bg-[var(--surface-subtle)] rounded-2xl border border-[var(--border)] p-3 text-[11px] text-[var(--text-muted)]">
                  Run an analysis on the left to see a summary and mapped foam
                  families here.
                </div>
              )}

              {advisorResult && (
                <>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                    <div className="font-medium text-[var(--text-primary)] mb-1">
                      Analysis summary
                    </div>
                    <p className="mb-2">
                      {advisorResult.staticLoadPsiLabel}
                    </p>
                    <p className="mb-1">
                      <span className="font-medium">Environment: </span>
                      {advisorResult.environmentLabel}
                    </p>
                    <p className="mb-1">
                      <span className="font-medium">Fragility target: </span>
                      {advisorResult.fragilityGMax}G
                      {advisorResult.fragilityTier.label
                        ? ` (${advisorResult.fragilityTier.label})`
                        : ""}
                    </p>
                    <p className="mb-1">
                      <span className="font-medium">Drop height: </span>
                      {advisorResult.dropHeightIn}in
                      {advisorResult.dropHeightSuggested
                        ? " (suggested from weight)"
                        : ""}
                    </p>
                    <p>
                      <span className="font-medium">Thickness: </span>
                      {advisorResult.requestedThicknessIn != null
                        ? `Verifying ${advisorResult.requestedThicknessIn}in exactly (no recommendation)`
                        : "Not specified -- showing recommended minimum where supported"}
                    </p>
                    {parsedBlock && (
                      <p className="mt-2 text-[10px] text-[var(--text-faint)]">
                        Block from layout: {parsedBlock.L}" × {parsedBlock.W}"
                        × {parsedBlock.H}".
                      </p>
                    )}
                    <p className="mt-2 text-[10px] text-[var(--text-faint)]">
                      {advisorResult.candidates.length} of{" "}
                      {advisorResult.materialsConsidered} active materials have
                      cushion-curve data on file
                      {advisorResult.materialsWithoutCurveData > 0
                        ? ` (${advisorResult.materialsWithoutCurveData} skipped -- no curve data)`
                        : ""}
                      .
                    </p>
                  </div>

                  {/* Honest "no data at this exact thickness" list -- never
                      silently dropped or fabricated across thicknesses. */}
                  {advisorResult.requestedThicknessIn != null &&
                    advisorResult.materialsWithoutRequestedThickness.length > 0 && (
                      <div className="rounded-2xl border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-3 text-[11px] text-[var(--attention)]">
                        <div className="font-medium mb-1">
                          No data at {advisorResult.requestedThicknessIn}in for{" "}
                          {advisorResult.materialsWithoutRequestedThickness.length}{" "}
                          material
                          {advisorResult.materialsWithoutRequestedThickness.length === 1
                            ? ""
                            : "s"}
                        </div>
                        <p className="text-[10px] mb-1.5">
                          These materials have real cushion-curve data, but not at
                          exactly {advisorResult.requestedThicknessIn}in -- rather
                          than guess by interpolating across thicknesses, they're
                          left out of the results below. Try one of their actual
                          thicknesses instead:
                        </p>
                        <ul className="text-[10px] space-y-0.5 list-disc list-inside">
                          {advisorResult.materialsWithoutRequestedThickness
                            .slice(0, 8)
                            .map((m) => (
                              <li key={m.material_id}>
                                {m.name} -- available:{" "}
                                {m.available_thicknesses
                                  .slice()
                                  .sort((a, b) => a - b)
                                  .map((t) => `${t}in`)
                                  .join(", ")}
                              </li>
                            ))}
                        </ul>
                        {advisorResult.materialsWithoutRequestedThickness.length > 8 && (
                          <p className="mt-1 text-[10px] text-[var(--text-faint)]">
                            +{advisorResult.materialsWithoutRequestedThickness.length - 8}{" "}
                            more.
                          </p>
                        )}
                      </div>
                    )}

                  {/* Ranked real materials, from cushion_curves */}
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[11px] font-medium text-[var(--text-primary)]">
                        Top matches
                      </div>
                      <div className="text-[10px] text-[var(--text-faint)]">
                        G-level at your operating psi, from tested curves.
                      </div>
                    </div>

                    {advisorResult.candidates.length === 0 ? (
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        No materials with cushion-curve data matched this
                        combination.
                      </div>
                    ) : (
                      <>
                        {advisorResult.candidates.length > TOP_CANDIDATES_SHOWN && (
                          <div className="mb-2 text-[10px] text-[var(--text-faint)]">
                            Showing the top {TOP_CANDIDATES_SHOWN} of{" "}
                            {advisorResult.candidates.length} materials with
                            cushion-curve data that match this combination,
                            ranked by fit to your fragility target.
                          </div>
                        )}
                        {advisorResult.candidates
                          .slice(0, TOP_CANDIDATES_SHOWN)
                          .map((c) => {
                        const isActive =
                          selectedRecKey != null &&
                          selectedRecKey === c.material_id;

                        return (
                          <div
                            key={c.material_id}
                            className={[
                              "mb-3 last:mb-0 rounded-xl border px-3 py-2 cursor-pointer transition",
                              isActive
                                ? "border-[var(--action-primary)] bg-[var(--surface-card)] shadow-[0_0_0_1px_var(--action-primary)]"
                                : "border-[var(--border)] bg-[var(--surface-page)] hover:border-[var(--action-primary)] hover:bg-[var(--surface-subtle)]",
                            ].join(" ")}
                            onClick={() => setSelectedRecKey(c.material_id)}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div>
                                <div className="font-medium flex items-center gap-1.5 flex-wrap">
                                  {c.name}
                                  <ProvenanceBadge provenance={c.curve.provenance} />
                                  <span
                                    className={[
                                      "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium",
                                      c.mode === "recommend"
                                        ? "bg-[var(--action-primary)]/10 border-[var(--action-primary)]/40 text-[var(--action-primary)]"
                                        : "bg-[var(--status-neutral-bg)] border-[var(--border-strong)] text-[var(--status-neutral-text)]",
                                    ].join(" ")}
                                    title={
                                      c.mode === "recommend"
                                        ? `${c.thickness_options.length} digitized thicknesses on file -- can recommend a minimum thickness + bearing area.`
                                        : "Only one digitized thickness on file -- can verify your stated footprint, not recommend a thickness."
                                    }
                                  >
                                    {c.mode === "recommend" ? "Thickness recommend" : "Verify only"}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)]">
                                  {c.material_family ?? "Uncategorized"}
                                  {c.density_lb_ft3 != null
                                    ? ` · ${c.density_lb_ft3.toFixed(1)} pcf`
                                    : ""}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span
                                  className={[
                                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                                    c.meets_fragility_target
                                      ? "bg-[var(--status-success-bg)] border border-[var(--status-success-text)]/30 text-[var(--status-success-text)]"
                                      : "bg-[var(--attention-bg)] border border-[var(--attention-border)] text-[var(--attention)]",
                                  ].join(" ")}
                                >
                                  {c.g_at_operating_psi.toFixed(1)}G
                                  {c.meets_fragility_target ? " ✓" : " over target"}
                                </span>
                                {isActive && (
                                  <span className="inline-flex items-center rounded-full border border-[var(--action-primary)]/50 bg-[var(--surface-subtle)] px-2 py-0.5 text-[9px] font-medium text-[var(--action-primary)]">
                                    Showing on canvas
                                  </span>
                                )}
                              </div>
                            </div>

                            <p className="leading-snug text-[11px] mb-1">
                              At {c.operating_psi.toFixed(3)} psi on the{" "}
                              {c.verify_thickness_in}in curve, this material
                              reads {c.g_at_operating_psi.toFixed(1)}G against
                              your {advisorResult.fragilityGMax}G target
                              {c.price_per_bf != null
                                ? ` · $${c.price_per_bf.toFixed(2)}/bf`
                                : ""}
                              .
                            </p>

                            {c.recommendation && (
                              <div className="mb-1 rounded-lg border border-[var(--action-primary)]/30 bg-[var(--action-primary)]/5 px-2 py-1.5 text-[11px]">
                                <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5 flex-wrap">
                                  Recommended: {c.recommendation.recommended_thickness_in}in
                                  thick
                                  <ProvenanceBadge provenance={c.recommendation.provenance} />
                                </div>
                                <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                                  Safe loading range{" "}
                                  {c.recommendation.safe_static_loading_range_psi.low.toFixed(3)}
                                  {"–"}
                                  {c.recommendation.safe_static_loading_range_psi.high.toFixed(3)}{" "}
                                  psi &rarr; bearing area{" "}
                                  {c.recommendation.recommended_bearing_area_in2.toFixed(0)}
                                  {"–"}
                                  {c.recommendation.conservative_bearing_area_in2.toFixed(0)} in
                                  <sup>2</sup> (efficient end:{" "}
                                  {c.recommendation.recommended_bearing_area_in2.toFixed(0)} in
                                  <sup>2</sup>).
                                </div>
                              </div>
                            )}

                            {c.mode === "recommend" && !c.recommendation && (
                              <p className="mb-1 text-[10px] text-[var(--attention)]">
                                None of the {c.thickness_options.length} digitized
                                thicknesses on file bring this material under your
                                target at any tested load.
                              </p>
                            )}

                            {c.caveats.length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-[10px] text-[var(--text-faint)] list-disc list-inside">
                                {c.caveats.map((note, i) => (
                                  <li key={i}>{note}</li>
                                ))}
                              </ul>
                            )}

                            <div className="mt-2 flex flex-wrap gap-2">
                              <a
                                href={`/admin/cushion-curves/${c.material_id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center rounded-full border border-[var(--border-strong)] px-3 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] transition"
                                onClick={(e) => e.stopPropagation()}
                              >
                                View cushion curve
                              </a>

                              <button
                                type="button"
                                className="inline-flex items-center rounded-full border border-[var(--status-success-text)]/30 bg-[var(--status-success-bg)] px-3 py-1 text-[10px] font-medium text-[var(--status-success-text)] hover:bg-[var(--status-success-bg)]/70 transition"
                                onClick={(e) => {
  e.stopPropagation();

  const mid = c.material_id;

// Prefer return_to if present — it contains the full editor seed
const currentUrl = new URL(window.location.href);
const returnTo = currentUrl.searchParams.get("return_to");

let editorUrl: URL;

if (returnTo) {
  // IMPORTANT:
  // return_to is an encoded FULL editor URL. If it contains "%23" (for "#"),
  // decodeURIComponent() would turn it into a literal "#", and URL parsing
  // would treat everything after it as a fragment (truncating the query).
  // So we "protect" %23 by double-encoding it first: %23 -> %2523.
  const protectedReturnTo = returnTo.replace(/%23/gi, "%2523");

  // Decode once — return_to is already encoded
  const decoded = decodeURIComponent(protectedReturnTo);

  // Now safe to parse as a URL without truncation
  editorUrl = new URL(decoded);
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
                          </div>
                        );
                        })}
                      </>
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
