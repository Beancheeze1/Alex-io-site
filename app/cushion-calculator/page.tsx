"use client";
// app/cushion-calculator/page.tsx
//
// Public, unauthenticated cushion curve calculator. Lead-gen / trust-building
// tool — calls the SAME backend the internal tool uses
// (/api/foam-advisor/recommend -> app/lib/cushion/engine.ts) so results are
// never forked or approximated separately from the verified engine.
//
// Simple mode deliberately does NOT ask for the product's contact area
// (footprint) -- only weight, a plain-language fragility pick, and a
// plain-language handling pick. Without a real contact area we cannot
// compute a real static-stress "verify" number (G at your actual operating
// psi), so Simple mode never shows one. What it DOES show is 100% real:
// the engine's thickness+bearing-area recommendation only depends on the
// fragility target and the curve itself, not on the caller's stated area
// (see computeSafeRange in engine.ts) -- weight only enters afterward, to
// convert the safe psi range into a real bearing-area range. So Simple mode
// ranks and displays purely off `recommendation`, and silently sends a fixed
// placeholder contact area to satisfy the API's required field, without ever
// surfacing anything derived from that placeholder (g_at_operating_psi,
// meets_fragility_target, verify caveats, etc. are simply not read).
//
// Advanced mode asks for real length/width (like the internal tool) and, once
// provided, unlocks full verify-mode numbers, real ranking by margin-to-target,
// and the exact provenance/error-caveat detail the internal tool shows.

import * as React from "react";
import Link from "next/link";

// ── Types (mirror /api/foam-advisor/recommend's real response shape) ──────

type CurveProvenance = "tested" | "proxy" | "unverified" | "modeled" | null;

type ThicknessSummary = {
  thickness_in: number;
  provenance: CurveProvenance;
  min_g: number;
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
  mode: "recommend" | "verify_only";
  thickness_options: ThicknessSummary[];
  requested_thickness_in: number | null;
  operating_psi: number;
  verify_thickness_in: number;
  g_at_operating_psi: number;
  meets_fragility_target: boolean;
  margin_g: number;
  recommendation: Recommendation | null;
  curve: {
    provenance: CurveProvenance;
    thickness_in: number | null;
    drop_in: number | null;
  };
  caveats: string[];
};

type MaterialWithoutRequestedThickness = {
  material_id: number;
  name: string;
  material_family: string | null;
  available_thicknesses: number[];
};

type ApiResult = {
  staticLoadPsi: number;
  fragilityGMax: number;
  fragilityTier: { key: string; label: string };
  dropHeightIn: number;
  requestedThicknessIn: number | null;
  candidates: MaterialCandidate[];
  materialsWithoutRequestedThickness: MaterialWithoutRequestedThickness[];
};

// ── Plain-language mappings -> real engine inputs ──────────────────────────
// Both grounded directly in the standard tables app/lib/cushion/engine.ts
// already uses (FRAGILITY_TIERS, DROP_HEIGHT_TABLE) -- not separately
// invented numbers.

const SIMPLE_FRAGILITY_OPTIONS = [
  {
    key: "highly_fragile",
    label: "Highly fragile",
    hint: "Precision electronics, optics, delicate instruments",
    // Top of the standard "Delicate" tier (25-40G).
    gMax: 40,
  },
  {
    key: "moderately_fragile",
    label: "Moderately fragile",
    hint: "Consumer electronics, general industrial components",
    // Top of the standard "Fragile" tier (40-60G).
    gMax: 60,
  },
  {
    key: "rugged",
    label: "Rugged",
    hint: "Tooling, hardware, castings",
    // Top of the standard "Rugged" tier (85-100G).
    gMax: 100,
  },
] as const;

const SIMPLE_HANDLING_OPTIONS = [
  {
    key: "parcel",
    label: "Parcel / courier shipping",
    hint: "Small package carriers -- thrown, hand-carried",
  },
  {
    key: "freight",
    label: "Palletized / freight",
    hint: "Pallet or equipment-handled shipments",
  },
] as const;

// Standard ASTM D-3332-style weight-based drop-height table -- same table
// app/lib/cushion/engine.ts uses server-side; mirrored here only so Simple
// mode can show the suggested height before the API call returns.
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

function dropHeightForHandling(handlingKey: string, weightLb: number): number {
  const byWeight = suggestDropHeightIn(weightLb);
  if (handlingKey === "freight") {
    // Freight/palletized goods are equipment-handled -- never rougher than
    // the standard table's "Equipment handling" bracket (24in), but can be
    // gentler still if the weight bracket already implies less.
    return Math.min(byWeight, 24);
  }
  // Parcel/courier matches the standard table's own handling-type language
  // ("Throwing", "Carrying") directly.
  return byWeight;
}

// A fixed technical placeholder ONLY -- the API requires a positive
// contactAreaIn2 to run, but Simple mode never asks the user for one and
// never reads/displays anything derived from it (g_at_operating_psi,
// meets_fragility_target, extrapolation caveats). Only `recommendation` is
// used from Simple-mode responses, which does not depend on this value.
const SIMPLE_MODE_PLACEHOLDER_PSI = 0.5;

function toPositiveNumber(raw: string): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

// ── Small shared UI bits ───────────────────────────────────────────────────

function ProvenanceBadge({ provenance }: { provenance: CurveProvenance }) {
  if (!provenance) return null;
  const styles: Record<string, string> = {
    tested:
      "bg-[var(--status-success-bg)] border-[var(--status-success-text)]/30 text-[var(--status-success-text)]",
    proxy: "bg-[var(--attention-bg)] border-[var(--attention-border)] text-[var(--attention)]",
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
    proxy:
      "Adapted from a different vendor's product at a similar density -- not digitized for this exact material.",
    unverified: "No source document is on file for this curve; values are unverified.",
    modeled:
      "Mathematically derived (Burgess stress-energy method) from this material's own tested curve at a different thickness -- not measured. Validated accuracy: 16-45% typical error, up to 200%+ at range extremes.",
  };
  return (
    <span
      title={titles[provenance] ?? ""}
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
        styles[provenance] ?? ""
      }`}
    >
      {labels[provenance] ?? provenance}
    </span>
  );
}

function DisclaimerBanner() {
  return (
    <div className="rounded-lg border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-3 text-sm text-[var(--attention)]">
      <span className="font-medium">Estimate only.</span> This tool is a starting point
      based on real cushion-curve data, not a substitute for real-world drop testing on
      your actual product and packaging before you ship.
    </div>
  );
}

// ── Ranking for Simple mode (recommendation-only, no real area assumed) ───

function rankForSimpleMode(candidates: MaterialCandidate[]): MaterialCandidate[] {
  return candidates
    .filter((c) => c.recommendation != null)
    .sort((a, b) => {
      const rt = a.recommendation!.recommended_thickness_in - b.recommendation!.recommended_thickness_in;
      if (rt !== 0) return rt;
      return (
        a.recommendation!.recommended_bearing_area_in2 -
        b.recommendation!.recommended_bearing_area_in2
      );
    });
}

// ── Main page ───────────────────────────────────────────────────────────────

type Mode = "simple" | "advanced";

export default function CushionCalculatorPage() {
  const [mode, setMode] = React.useState<Mode>("simple");

  // Shared state across both modes
  const [weightLb, setWeightLb] = React.useState<string>("");
  const [fragilityGMax, setFragilityGMax] = React.useState<string>("");
  const [dropHeightIn, setDropHeightIn] = React.useState<string>("");
  const [dropHeightTouched, setDropHeightTouched] = React.useState(false);

  // Simple-mode picker selections (derived highlight state, not the source
  // of truth -- see the *Selected memos below)
  const [handlingKey, setHandlingKey] = React.useState<string>("");

  // Advanced-only
  const [lengthIn, setLengthIn] = React.useState<string>("");
  const [widthIn, setWidthIn] = React.useState<string>("");
  const [thicknessIn, setThicknessIn] = React.useState<string>("");
  const [familyFilter, setFamilyFilter] = React.useState<string>("all");

  const [result, setResult] = React.useState<ApiResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const contactAreaIn2 = React.useMemo(() => {
    const L = toPositiveNumber(lengthIn);
    const W = toPositiveNumber(widthIn);
    if (L == null || W == null) return null;
    return L * W;
  }, [lengthIn, widthIn]);

  const hasRealArea = contactAreaIn2 != null;

  // Auto-suggest drop height from weight, unless the user has manually
  // touched the field (Advanced mode) -- mirrors the internal tool.
  React.useEffect(() => {
    if (dropHeightTouched) return;
    const w = toPositiveNumber(weightLb);
    if (w == null) return;
    if (handlingKey) {
      setDropHeightIn(String(dropHeightForHandling(handlingKey, w)));
    } else {
      setDropHeightIn(String(suggestDropHeightIn(w)));
    }
  }, [weightLb, handlingKey, dropHeightTouched]);

  // Which Simple-mode fragility button (if any) matches the current numeric
  // value -- derived, so editing the raw number in Advanced mode and coming
  // back to Simple mode never shows a stale/incorrect highlight.
  const selectedFragilityKey = React.useMemo(() => {
    const match = SIMPLE_FRAGILITY_OPTIONS.find((o) => String(o.gMax) === fragilityGMax.trim());
    return match?.key ?? null;
  }, [fragilityGMax]);

  const canSubmit = toPositiveNumber(weightLb) != null && toPositiveNumber(fragilityGMax) != null;

  const runCalculation = React.useCallback(async () => {
    const w = toPositiveNumber(weightLb);
    const g = toPositiveNumber(fragilityGMax);
    if (w == null || g == null) return;

    const drop = toPositiveNumber(dropHeightIn) ?? suggestDropHeightIn(w);
    const area = hasRealArea ? contactAreaIn2! : w / SIMPLE_MODE_PLACEHOLDER_PSI;
    const thicknessVal = toPositiveNumber(thicknessIn);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/foam-advisor/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weightLb: w,
          contactAreaIn2: area,
          fragilityGMax: g,
          dropHeightIn: drop,
          thicknessIn: thicknessVal ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError("Couldn't calculate a recommendation for those inputs. Try adjusting them.");
        setResult(null);
        return;
      }
      setResult({
        staticLoadPsi: json.staticLoadPsi,
        fragilityGMax: json.fragilityGMax,
        fragilityTier: json.fragilityTier,
        dropHeightIn: json.dropHeightIn,
        requestedThicknessIn: json.requestedThicknessIn ?? null,
        candidates: Array.isArray(json.candidates) ? json.candidates : [],
        materialsWithoutRequestedThickness: Array.isArray(json.materialsWithoutRequestedThickness)
          ? json.materialsWithoutRequestedThickness
          : [],
      });
    } catch {
      setError("Something went wrong reaching the calculator. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [weightLb, fragilityGMax, dropHeightIn, hasRealArea, contactAreaIn2, thicknessIn]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runCalculation();
  };

  // Results to actually display: recommend-only ranking when we don't have a
  // real footprint yet (true for Simple mode, and for Advanced mode before
  // length/width are filled in); the engine's own real ranking (by margin to
  // target) once a real area exists.
  const displayCandidates = React.useMemo(() => {
    if (!result) return [];
    let list = hasRealArea ? result.candidates : rankForSimpleMode(result.candidates);
    if (mode === "advanced" && familyFilter !== "all") {
      list = list.filter((c) => (c.material_family ?? "Uncategorized") === familyFilter);
    }
    return list.slice(0, 3);
  }, [result, hasRealArea, mode, familyFilter]);

  const familyOptions = React.useMemo(() => {
    if (!result) return [];
    const set = new Set<string>();
    for (const c of result.candidates) set.add(c.material_family ?? "Uncategorized");
    return Array.from(set).sort();
  }, [result]);

  const selectedFragility = SIMPLE_FRAGILITY_OPTIONS.find((o) => o.key === selectedFragilityKey);
  const selectedHandling = SIMPLE_HANDLING_OPTIONS.find((o) => o.key === handlingKey);

  return (
    <main className="relative min-h-screen bg-[var(--surface-page)] text-[var(--text-primary)]">
      {/* Nav */}
      <section className="border-b border-[var(--border)] bg-[var(--surface-card)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
              Alex-IO
            </div>
            <div className="text-sm text-[var(--text-secondary)]">Cushion Curve Calculator</div>
          </div>
          <Link
            href="/landing"
            className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-subtle)] sm:px-4 sm:text-sm"
          >
            What is Alex-IO? →
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
        {/* Header */}
        <div className="text-xs font-medium uppercase tracking-[0.20em] text-[var(--text-muted)]">
          Free Tool -- No Signup
        </div>
        <h1 className="mt-3 max-w-2xl text-3xl font-medium leading-tight text-[var(--text-primary)] sm:text-4xl">
          Foam cushion curve calculator
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
          Get a real material and thickness recommendation from tested cushion-curve data
          -- not a rule of thumb. Enter your product weight and how fragile it is; we'll
          tell you what to protect it with and why.
        </p>

        <div className="mt-6 max-w-2xl">
          <DisclaimerBanner />
        </div>

        {/* Mode toggle */}
        <div className="mt-8 inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-1">
          {(["simple", "advanced"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                "rounded-md px-4 py-2 text-sm font-medium transition",
                mode === m
                  ? "bg-[var(--action-primary)] text-white"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              {m === "simple" ? "Simple" : "Advanced"}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-12">
          {/* ── Form ── */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-5 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-6"
          >
            <label className="block">
              <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                Product weight (lb)
              </div>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={weightLb}
                onChange={(e) => setWeightLb(e.target.value)}
                placeholder="e.g. 8"
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
              />
            </label>

            {mode === "simple" ? (
              <>
                <div className="mt-5">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    How fragile is it?
                  </div>
                  <div className="flex flex-col gap-2">
                    {SIMPLE_FRAGILITY_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setFragilityGMax(String(o.gMax))}
                        className={[
                          "rounded-md border px-4 py-3 text-left transition",
                          selectedFragilityKey === o.key
                            ? "border-[var(--action-primary)] bg-[var(--action-primary)]/5"
                            : "border-[var(--border)] bg-[var(--surface-page)] hover:bg-[var(--surface-subtle)]",
                        ].join(" ")}
                      >
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {o.label}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">{o.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    How does it ship?
                  </div>
                  <div className="flex flex-col gap-2">
                    {SIMPLE_HANDLING_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => {
                          setHandlingKey(o.key);
                          setDropHeightTouched(false);
                        }}
                        className={[
                          "rounded-md border px-4 py-3 text-left transition",
                          handlingKey === o.key
                            ? "border-[var(--action-primary)] bg-[var(--action-primary)]/5"
                            : "border-[var(--border)] bg-[var(--surface-page)] hover:bg-[var(--surface-subtle)]",
                        ].join(" ")}
                      >
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {o.label}
                        </div>
                        <div className="text-xs text-[var(--text-muted)]">{o.hint}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                      Contact length (in)
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      value={lengthIn}
                      onChange={(e) => setLengthIn(e.target.value)}
                      placeholder="e.g. 6"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                      Contact width (in)
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      value={widthIn}
                      onChange={(e) => setWidthIn(e.target.value)}
                      placeholder="e.g. 4"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                    />
                  </label>
                </div>
                <p className="mt-1.5 text-xs text-[var(--text-faint)]">
                  {hasRealArea
                    ? `Contact area: ${contactAreaIn2!.toFixed(2)} in² -- unlocks real static-load verification below.`
                    : "Optional -- without this we can only show thickness recommendations, not verify an exact operating load."}
                </p>

                <label className="mt-5 block">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    Fragility target (max G)
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={fragilityGMax}
                    onChange={(e) => setFragilityGMax(e.target.value)}
                    placeholder="e.g. 60"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SIMPLE_FRAGILITY_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setFragilityGMax(String(o.gMax))}
                        className={[
                          "rounded-full border px-2.5 py-1 text-[11px] transition",
                          selectedFragilityKey === o.key
                            ? "border-[var(--action-primary)] bg-[var(--action-primary)]/10 text-[var(--action-primary)]"
                            : "border-[var(--border)] bg-[var(--surface-page)] text-[var(--text-secondary)] hover:border-[var(--action-primary)] hover:text-[var(--text-primary)]",
                        ].join(" ")}
                      >
                        {o.label} ({o.gMax}G)
                      </button>
                    ))}
                  </div>
                </label>

                <label className="mt-5 block">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    Drop height (in)
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={dropHeightIn}
                    onChange={(e) => {
                      setDropHeightTouched(true);
                      setDropHeightIn(e.target.value);
                    }}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                  />
                  <p className="mt-1.5 text-xs text-[var(--text-faint)]">
                    {dropHeightTouched
                      ? "Overriding the standard weight-based suggestion."
                      : "Suggested from the standard ASTM D-3332-style weight table -- edit to override."}
                  </p>
                </label>

                <label className="mt-5 block">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    Verify a specific thickness (in) -- optional
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={thicknessIn}
                    onChange={(e) => setThicknessIn(e.target.value)}
                    placeholder="Leave blank for a recommendation"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                  />
                </label>

                {familyOptions.length > 1 && (
                  <label className="mt-5 block">
                    <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                      Material family
                    </div>
                    <select
                      value={familyFilter}
                      onChange={(e) => setFamilyFilter(e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                    >
                      <option value="all">All families</option>
                      {familyOptions.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}

            <button
              type="submit"
              disabled={!canSubmit || loading}
              className="mt-6 w-full rounded-md bg-[var(--action-primary)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[var(--action-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Calculating…" : "Get recommendation"}
            </button>
            {!canSubmit && (
              <p className="mt-2 text-center text-xs text-[var(--text-faint)]">
                {mode === "simple"
                  ? "Enter weight and pick a fragility level."
                  : "Enter weight and a fragility G-target."}
              </p>
            )}
            {error && (
              <div className="mt-4 rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-3 text-sm text-[var(--attention)]">
                {error}
              </div>
            )}
          </form>

          {/* ── Results ── */}
          <div className="lg:col-span-7">
            {!result && !loading && (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
                Enter your product details and click "Get recommendation" to see real
                material and thickness matches.
              </div>
            )}

            {loading && (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-8 text-center text-sm text-[var(--text-secondary)]">
                Calculating against real cushion-curve data…
              </div>
            )}

            {result && !loading && (
              <div className="flex flex-col gap-4">
                {/* Why explanation */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-4 text-sm leading-6 text-[var(--text-secondary)]">
                  {mode === "simple" && selectedFragility && selectedHandling ? (
                    <>
                      Because your product is{" "}
                      <span className="font-medium text-[var(--text-primary)]">
                        {selectedFragility.label.toLowerCase()}
                      </span>{" "}
                      and ships via{" "}
                      <span className="font-medium text-[var(--text-primary)]">
                        {selectedHandling.label.toLowerCase()}
                      </span>{" "}
                      (~{result.dropHeightIn}in drop), it needs to stay under roughly{" "}
                      <span className="font-medium text-[var(--text-primary)]">
                        {result.fragilityGMax}G
                      </span>{" "}
                      of shock ({result.fragilityTier.label} tier).
                    </>
                  ) : (
                    <>
                      Target:{" "}
                      <span className="font-medium text-[var(--text-primary)]">
                        {result.fragilityGMax}G
                      </span>{" "}
                      ({result.fragilityTier.label}) at a{" "}
                      <span className="font-medium text-[var(--text-primary)]">
                        {result.dropHeightIn}in
                      </span>{" "}
                      drop height
                      {result.requestedThicknessIn != null ? (
                        <>
                          , verifying{" "}
                          <span className="font-medium text-[var(--text-primary)]">
                            {result.requestedThicknessIn}in
                          </span>{" "}
                          thickness exactly
                        </>
                      ) : (
                        ""
                      )}
                      {hasRealArea ? (
                        <>
                          {" "}
                          at a computed static load of{" "}
                          <span className="font-medium text-[var(--text-primary)]">
                            {result.staticLoadPsi.toFixed(3)} psi
                          </span>
                          .
                        </>
                      ) : (
                        ". Add contact length/width above for a real load verification."
                      )}
                    </>
                  )}
                  {!hasRealArea && mode === "simple" && (
                    <div className="mt-2 text-xs text-[var(--text-faint)]">
                      Showing minimum-thickness recommendations from real tested/modeled
                      curve data. Switch to Advanced mode and enter your product's contact
                      footprint for a full load verification.
                    </div>
                  )}
                </div>

                {result.requestedThicknessIn != null &&
                  result.materialsWithoutRequestedThickness.length > 0 && (
                    <div className="rounded-xl border border-[var(--attention-border)] bg-[var(--attention-bg)] px-5 py-4 text-sm text-[var(--attention)]">
                      <div className="font-medium">
                        No data at {result.requestedThicknessIn}in for{" "}
                        {result.materialsWithoutRequestedThickness.length} other material
                        {result.materialsWithoutRequestedThickness.length === 1 ? "" : "s"}
                      </div>
                      <p className="mt-1 text-xs">
                        Rather than guess, those are left out below. Try one of their real
                        thicknesses instead.
                      </p>
                    </div>
                  )}

                {displayCandidates.length === 0 ? (
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-6 text-sm text-[var(--text-secondary)]">
                    No materials with cushion-curve data matched this combination. Try a
                    less strict fragility target.
                  </div>
                ) : (
                  displayCandidates.map((c, i) => (
                    <div
                      key={c.material_id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--action-primary)] text-[10px] font-medium text-white">
                              {i + 1}
                            </span>
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                              {c.name}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-muted)]">
                            {c.material_family ?? "Uncategorized"}
                            {c.density_lb_ft3 != null ? ` · ${c.density_lb_ft3.toFixed(1)} pcf` : ""}
                          </div>
                        </div>
                        {mode === "advanced" && (
                          <ProvenanceBadge
                            provenance={c.recommendation?.provenance ?? c.curve.provenance}
                          />
                        )}
                      </div>

                      {c.recommendation ? (
                        <div className="mt-3 rounded-lg border border-[var(--action-primary)]/30 bg-[var(--action-primary)]/5 px-3 py-2 text-sm">
                          <div className="font-medium text-[var(--text-primary)]">
                            {c.recommendation.recommended_thickness_in}in thick
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                            Works with roughly{" "}
                            {c.recommendation.recommended_bearing_area_in2.toFixed(0)}–
                            {c.recommendation.conservative_bearing_area_in2.toFixed(0)} in² of
                            contact area under the product.
                          </div>
                          {mode === "simple" && (
                            <ProvenanceBadge provenance={c.recommendation.provenance} />
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                          {result.requestedThicknessIn != null
                            ? `At ${result.requestedThicknessIn}in: ${c.g_at_operating_psi.toFixed(
                                1,
                              )}G against your ${result.fragilityGMax}G target${
                                c.meets_fragility_target ? " -- meets target." : " -- over target."
                              }`
                            : "Only one digitized thickness on file for this material -- verification only, no thickness sweep available."}
                        </div>
                      )}

                      {mode === "advanced" && hasRealArea && !result.requestedThicknessIn && (
                        <div className="mt-2 text-xs text-[var(--text-secondary)]">
                          At your stated footprint ({result.staticLoadPsi.toFixed(3)} psi):{" "}
                          <span
                            className={
                              c.meets_fragility_target
                                ? "text-[var(--status-success-text)]"
                                : "text-[var(--attention)]"
                            }
                          >
                            {c.g_at_operating_psi.toFixed(1)}G
                            {c.meets_fragility_target ? " (meets target)" : " (over target)"}
                          </span>
                        </div>
                      )}

                      {mode === "advanced" && c.caveats.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--text-faint)] list-disc list-inside">
                          {c.caveats.map((note, idx) => (
                            <li key={idx}>{note}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}

                {/* Soft CTA */}
                <div className="mt-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] p-5 text-center">
                  <div className="text-sm text-[var(--text-secondary)]">
                    Want a real, priced quote using this?
                  </div>
                  <Link
                    href="/landing#sample-quote"
                    className="mt-3 inline-flex rounded-md bg-[var(--action-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--action-primary-hover)]"
                  >
                    Build your layout in Alex-IO →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
