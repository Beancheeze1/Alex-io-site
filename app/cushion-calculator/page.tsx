"use client";
// app/cushion-calculator/page.tsx
//
// Public, unauthenticated cushion curve calculator. Lead-gen / trust-building
// tool — calls the SAME backend the internal tool uses
// (/api/foam-advisor/recommend -> app/lib/cushion/engine.ts) so results are
// never forked or approximated separately from the verified engine.
//
// Simple mode asks for product length/width (in plain "how big is it"
// terms, not "bearing area") alongside weight and the plain-language
// fragility/handling picks. Length/width are still OPTIONAL, same as
// Advanced mode -- but once given, they compute a REAL contact area and
// Simple mode gets the full result: recommended thickness, real static
// stress, G-at-your-load, meets/fails target. This is the exact same
// `contactAreaIn2` state Advanced mode uses (shared, not mode-gated), so
// filling it in in one mode carries into the other.
//
// If length/width are left blank (in either mode), the engine still needs
// SOME positive contactAreaIn2 to run at all, so a fixed technical
// placeholder is sent -- but nothing derived from that placeholder
// (g_at_operating_psi, meets_fragility_target, verify caveats) is ever
// read or displayed; only the engine's `recommendation` block is shown,
// which is genuinely area-independent (see computeSafeRange in engine.ts).
// That fallback only fires when the user has NOT provided real dimensions;
// it is never used once real length/width are entered.
//
// Advanced mode additionally exposes the raw numeric fragility/drop-height
// inputs, a specific-thickness verify field, provenance badges, and the
// full error-caveat detail the internal tool shows -- Simple mode stays
// deliberately lighter on that detail even once it has real area.

import * as React from "react";
import Link from "next/link";

// ── Types (mirror /api/foam-advisor/recommend's real response shape) ──────

type CurveProvenance = "tested" | "proxy" | "unverified" | "modeled" | null;

type ThicknessSummary = {
  thickness_in: number;
  provenance: CurveProvenance;
  min_g: number;
  meets_target: boolean;
  g_at_operating_psi: number | null;
  meets_target_at_operating_psi: boolean | null;
  extrapolated_at_operating_psi: boolean | null;
  points: { static_psi: number; g_level: number }[];
};

// Standard thickness set used for Simple mode's pills and Advanced mode's
// chart -- matches what the catalog actually digitizes/derives against.
const STANDARD_THICKNESSES_IN = [2, 3, 4, 5] as const;

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
  thicker_alternative_in_same_material: {
    thickness_in: number;
    provenance: CurveProvenance;
    g_at_operating_psi: number;
  } | null;
  also_available_as: string[];
};

type MaterialWithoutRequestedThickness = {
  material_id: number;
  name: string;
  material_family: string | null;
  available_thicknesses: number[];
};

type MaterialExcludedByThicknessConstraint = {
  material_id: number;
  name: string;
  material_family: string | null;
  thinnest_available_in: number;
};

type BestOptionBeyondConstraint = {
  material_id: number;
  name: string;
  thickness_in: number;
  g_at_operating_psi: number;
};

type ApiResult = {
  staticLoadPsi: number;
  fragilityGMax: number;
  fragilityTier: { key: string; label: string };
  dropHeightIn: number;
  requestedThicknessIn: number | null;
  maxThicknessIn: number | null;
  candidates: MaterialCandidate[];
  materialsWithoutRequestedThickness: MaterialWithoutRequestedThickness[];
  materialsExcludedByThicknessConstraint: MaterialExcludedByThicknessConstraint[];
  anyMaterialMeetsTarget: boolean;
  bestOptionBeyondConstraint: BestOptionBeyondConstraint | null;
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

// A fixed technical placeholder ONLY, used when the user hasn't (yet)
// entered length/width in either mode -- the API requires a positive
// contactAreaIn2 to run, but nothing derived from this placeholder
// (g_at_operating_psi, meets_fragility_target, extrapolation caveats) is
// ever read or displayed while it's in use. Only `recommendation` is shown
// in that case, which does not depend on this value. As soon as real
// length/width are provided, `hasRealArea` is true and this is never sent.
const NO_AREA_PLACEHOLDER_PSI = 0.5;

// Now that near-identical color/tint SKU variants are deduped server-side
// (see also_available_as), each result really is a distinct cushioning
// profile -- safe to show more of them than the old cap of 3. 7 rather than
// a flat 6: in real scenarios with ~13 deduped families, a wide-margin
// proxy-provenance family can rank 7th behind several tighter tested-tier
// matches under the new thinnest -> tested-over-proxy -> margin ranking --
// that's the ranking rule working as intended, not a reason to hide it.
const TOP_FAMILIES_SHOWN = 7;

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

// Per-thickness pass/fail pills for the standard 2/3/4/5in set, using real
// per-thickness data at the caller's ACTUAL operating psi -- never the
// design-range "meets target somewhere on this curve" number. A thickness
// with no digitized data on file shows as "no data," never a fabricated
// pass or fail.
function ThicknessPills({ candidate }: { candidate: MaterialCandidate }) {
  const byThickness = new Map(candidate.thickness_options.map((t) => [t.thickness_in, t]));
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {STANDARD_THICKNESSES_IN.map((t) => {
        const opt = byThickness.get(t);
        if (!opt || opt.meets_target_at_operating_psi == null) {
          return (
            <span
              key={t}
              className="rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-faint)]"
            >
              {t}in -- no data
            </span>
          );
        }
        const pass = opt.meets_target_at_operating_psi;
        const isThinnestPass = pass && candidate.verify_thickness_in === t;
        return (
          <span
            key={t}
            title={`${opt.g_at_operating_psi?.toFixed(1)}G at your footprint${
              opt.extrapolated_at_operating_psi ? " (extrapolated beyond tested range)" : ""
            }`}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              pass
                ? isThinnestPass
                  ? "border-[var(--status-success-text)] bg-[var(--status-success-bg)] text-[var(--status-success-text)] ring-1 ring-inset ring-[var(--status-success-text)]/50"
                  : "border-[var(--status-success-text)]/40 bg-[var(--status-success-bg)]/50 text-[var(--status-success-text)]"
                : "border-[var(--attention-border)] bg-[var(--attention-bg)] text-[var(--attention)]",
            ].join(" ")}
          >
            {t}in {pass ? "✓" : "✕"}
            {isThinnestPass ? " thinnest" : ""}
          </span>
        );
      })}
    </div>
  );
}

// Simplified real cushion-curve chart: G-force (y) vs static stress (x),
// one line per digitized thickness, a dashed horizontal target-G line, and
// a shaded safe zone underneath it -- the standard industry "effective
// cushioning range" chart format. Tested/proxy/modeled curves are
// distinguished by line style, never just color (colorblind-safe, and
// still legible printed in grayscale).
const CHART_LINE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed"];

function CushionCurveChart({
  candidate,
  targetG,
  operatingPsi,
}: {
  candidate: MaterialCandidate;
  targetG: number;
  operatingPsi: number | null;
}) {
  const W = 340;
  const H = 190;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 22;

  const curves = candidate.thickness_options
    .filter((t) => (STANDARD_THICKNESSES_IN as readonly number[]).includes(t.thickness_in) && t.points.length > 1)
    .sort((a, b) => a.thickness_in - b.thickness_in);

  if (!curves.length) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11px] text-[var(--text-faint)]">
        Not enough digitized points at 2-5in to chart this material's curve.
      </div>
    );
  }

  const allPsi = curves.flatMap((c) => c.points.map((p) => p.static_psi));
  const allG = curves.flatMap((c) => c.points.map((p) => p.g_level));
  const maxPsi = Math.max(...allPsi, operatingPsi ?? 0) * 1.05 || 1;
  const maxG = Math.max(...allG, targetG) * 1.08 || 1;

  const x = (psi: number) => padL + (psi / maxPsi) * (W - padL - padR);
  const y = (g: number) => padT + (1 - g / maxG) * (H - padT - padB);
  const targetY = y(targetG);

  return (
    <div className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Real cushion curve chart for ${candidate.name}: G-force versus static stress at ${curves
          .map((c) => `${c.thickness_in}in`)
          .join(", ")}`}
      >
        <rect
          x={padL}
          y={targetY}
          width={W - padL - padR}
          height={Math.max(0, H - padB - targetY)}
          fill="var(--status-success-text)"
          opacity="0.08"
        />
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" strokeOpacity="0.25" />
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" strokeOpacity="0.25" />
        <line
          x1={padL}
          y1={targetY}
          x2={W - padR}
          y2={targetY}
          stroke="var(--attention)"
          strokeWidth="1.25"
          strokeDasharray="4 3"
        />
        <text x={W - padR} y={Math.max(9, targetY - 3)} textAnchor="end" fontSize="9" fill="var(--attention)">
          {targetG}G target
        </text>
        {curves.map((c, i) => {
          const sorted = [...c.points].sort((a, b) => a.static_psi - b.static_psi);
          const d = sorted
            .map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(p.static_psi).toFixed(1)} ${y(p.g_level).toFixed(1)}`)
            .join(" ");
          const dash = c.provenance === "modeled" ? "5 3" : c.provenance === "proxy" ? "1.5 2.5" : undefined;
          return (
            <path
              key={c.thickness_in}
              d={d}
              fill="none"
              stroke={CHART_LINE_COLORS[i % CHART_LINE_COLORS.length]}
              strokeWidth="1.75"
              strokeDasharray={dash}
            />
          );
        })}
        {operatingPsi != null && operatingPsi > 0 && operatingPsi <= maxPsi && (
          <line
            x1={x(operatingPsi)}
            y1={padT}
            x2={x(operatingPsi)}
            y2={H - padB}
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeDasharray="2 2"
          />
        )}
        <text x={2} y={padT + 4} fontSize="8" fill="currentColor" opacity="0.6">
          {Math.round(maxG)}G
        </text>
        <text x={2} y={H - padB} fontSize="8" fill="currentColor" opacity="0.6">
          0G
        </text>
        <text x={padL} y={H - 4} fontSize="8" fill="currentColor" opacity="0.6">
          0 psi
        </text>
        <text x={W - padR} y={H - 4} fontSize="8" fill="currentColor" opacity="0.6" textAnchor="end">
          {maxPsi.toFixed(2)} psi
        </text>
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
        {curves.map((c, i) => (
          <span key={c.thickness_in} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-0.5 w-3"
              style={{
                backgroundColor: CHART_LINE_COLORS[i % CHART_LINE_COLORS.length],
                opacity: c.provenance === "proxy" ? 0.55 : 1,
              }}
            />
            {c.thickness_in}in ({c.provenance ?? "unknown"})
          </span>
        ))}
        {operatingPsi != null && operatingPsi > 0 && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-px bg-[var(--text-muted)]" />
            your load
          </span>
        )}
      </div>
    </div>
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

// ── Ranking used whenever no real area is known yet (recommendation-only) ─

function rankByRecommendationOnly(candidates: MaterialCandidate[]): MaterialCandidate[] {
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

  // Product footprint -- shared across both modes (Simple asks for it in
  // plain "length x width" terms; Advanced labels it "contact length/width").
  const [lengthIn, setLengthIn] = React.useState<string>("");
  const [widthIn, setWidthIn] = React.useState<string>("");

  // Simple-mode "how much room do you have" hard thickness ceiling. Kept as
  // shared state (like length/width) so it survives a mode toggle, but only
  // sent to the API in Simple mode -- Advanced mode has its own, different
  // "verify a specific thickness" field below.
  const [maxThicknessIn, setMaxThicknessIn] = React.useState<string>("");

  // Advanced-only
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
    const area = hasRealArea ? contactAreaIn2! : w / NO_AREA_PLACEHOLDER_PSI;
    const thicknessVal = toPositiveNumber(thicknessIn);
    const maxThicknessVal = mode === "simple" ? toPositiveNumber(maxThicknessIn) : null;

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
          maxThicknessIn: maxThicknessVal ?? undefined,
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
        maxThicknessIn: json.maxThicknessIn ?? null,
        candidates: Array.isArray(json.candidates) ? json.candidates : [],
        materialsWithoutRequestedThickness: Array.isArray(json.materialsWithoutRequestedThickness)
          ? json.materialsWithoutRequestedThickness
          : [],
        materialsExcludedByThicknessConstraint: Array.isArray(json.materialsExcludedByThicknessConstraint)
          ? json.materialsExcludedByThicknessConstraint
          : [],
        anyMaterialMeetsTarget: json.anyMaterialMeetsTarget !== false,
        bestOptionBeyondConstraint: json.bestOptionBeyondConstraint ?? null,
      });
    } catch {
      setError("Something went wrong reaching the calculator. Please try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [weightLb, fragilityGMax, dropHeightIn, hasRealArea, contactAreaIn2, thicknessIn, mode, maxThicknessIn]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runCalculation();
  };

  // Results to actually display: recommend-only ranking when we don't have a
  // real footprint yet (either mode, before length/width are filled in); the
  // engine's own real ranking (by margin to target) once a real area exists
  // -- in either mode, since length/width are shared state now.
  const displayCandidates = React.useMemo(() => {
    if (!result) return [];
    let list = hasRealArea ? result.candidates : rankByRecommendationOnly(result.candidates);
    if (mode === "advanced" && familyFilter !== "all") {
      list = list.filter((c) => (c.material_family ?? "Uncategorized") === familyFilter);
    }
    return list.slice(0, TOP_FAMILIES_SHOWN);
  }, [result, hasRealArea, mode, familyFilter]);

  const familyOptions = React.useMemo(() => {
    if (!result) return [];
    const set = new Set<string>();
    for (const c of result.candidates) set.add(c.material_family ?? "Uncategorized");
    return Array.from(set).sort();
  }, [result]);

  // For requestedThicknessIn (Advanced verify-a-specific-thickness) mode:
  // when a material fails AT THAT EXACT thickness and has no thicker option
  // of its own that would pass, the best real fallback to point to is
  // whichever OTHER material in the same result set already passes at that
  // same thickness -- already ranked first if one exists.
  const firstPassingAtRequestedThickness = React.useMemo(() => {
    if (!result || result.requestedThicknessIn == null) return null;
    return result.candidates.find((c) => c.meets_fragility_target) ?? null;
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
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                      Product length (in)
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
                      Product width (in)
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
                    ? `The face that'll sit on the foam, roughly ${contactAreaIn2!.toFixed(
                        1,
                      )} in² -- this unlocks a real check against your target below.`
                    : "The face of the product that'll actually sit on the foam -- not the whole box. Optional, but skipping it means we can only suggest a thickness, not confirm it works for your load."}
                </p>

                <label className="mt-5 block">
                  <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                    How much room do you have? (in) -- optional
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={maxThicknessIn}
                    onChange={(e) => setMaxThicknessIn(e.target.value)}
                    placeholder="Leave blank for the thinnest option that works"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-faint)] transition focus:border-[var(--action-primary)]"
                  />
                  <p className="mt-1.5 text-xs text-[var(--text-faint)]">
                    {maxThicknessIn.trim()
                      ? `We'll only suggest materials that protect your product at or under ${maxThicknessIn}in.`
                      : "Max cushion thickness your box or product allows. Leave blank and we'll just find the thinnest option that works."}
                  </p>
                </label>

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
                      {hasRealArea && (
                        <>
                          {" "}
                          At your product's footprint, that's a static load of{" "}
                          <span className="font-medium text-[var(--text-primary)]">
                            {result.staticLoadPsi.toFixed(3)} psi
                          </span>
                          .
                        </>
                      )}
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
                      curve data. Add your product's length and width above for a full
                      check against your fragility target.
                    </div>
                  )}
                </div>

                {hasRealArea && !result.anyMaterialMeetsTarget && (
                  <div className="rounded-xl border border-[var(--attention-border)] bg-[var(--attention-bg)] px-5 py-4 text-sm text-[var(--attention)]">
                    {result.maxThicknessIn != null && result.bestOptionBeyondConstraint ? (
                      <>
                        <div className="font-medium">
                          Nothing fits your {result.maxThicknessIn}in limit at this fragility
                          level.
                        </div>
                        <p className="mt-1 text-xs">
                          The thinnest option that meets your {result.fragilityGMax}G target is{" "}
                          <span className="font-medium">
                            {result.bestOptionBeyondConstraint.thickness_in}in
                          </span>{" "}
                          of <span className="font-medium">{result.bestOptionBeyondConstraint.name}</span>{" "}
                          ({result.bestOptionBeyondConstraint.g_at_operating_psi.toFixed(1)}G at your
                          footprint).
                        </p>
                      </>
                    ) : result.requestedThicknessIn != null && result.bestOptionBeyondConstraint ? (
                      <>
                        <div className="font-medium">
                          None of the materials on file meet target at exactly{" "}
                          {result.requestedThicknessIn}in.
                        </div>
                        <p className="mt-1 text-xs">
                          The thinnest real option that would work is{" "}
                          <span className="font-medium">
                            {result.bestOptionBeyondConstraint.thickness_in}in
                          </span>{" "}
                          of <span className="font-medium">{result.bestOptionBeyondConstraint.name}</span>{" "}
                          ({result.bestOptionBeyondConstraint.g_at_operating_psi.toFixed(1)}G at your
                          footprint). Try leaving the thickness field blank to see it ranked with the
                          rest.
                        </p>
                      </>
                    ) : (
                      <div className="font-medium">
                        No material on file protects this product at this footprint and fragility
                        level. Increasing the contact area (larger footprint) or reducing the
                        fragility requirement would open up more options.
                      </div>
                    )}
                  </div>
                )}

                {result.maxThicknessIn != null &&
                  result.materialsExcludedByThicknessConstraint.length > 0 && (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-5 py-4 text-xs text-[var(--text-secondary)]">
                      {result.materialsExcludedByThicknessConstraint.length} material
                      {result.materialsExcludedByThicknessConstraint.length === 1 ? "" : "s"} left out
                      because {result.materialsExcludedByThicknessConstraint.length === 1 ? "its" : "their"}{" "}
                      thinnest option on file doesn't fit your {result.maxThicknessIn}in limit.
                    </div>
                  )}

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
                          {c.also_available_as.length > 0 && (
                            <div className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                              Also available in: {c.also_available_as.join(", ")}
                            </div>
                          )}
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
                            : c.mode === "verify_only"
                              ? "Only one digitized thickness on file for this material -- verification only, no thickness sweep available."
                              : `None of this material's thicknesses${
                                  result.maxThicknessIn != null
                                    ? ` at or under your ${result.maxThicknessIn}in limit`
                                    : ""
                                } bring it under your ${result.fragilityGMax}G target at your stated footprint. Closest: ${
                                  c.verify_thickness_in
                                }in at ${c.g_at_operating_psi.toFixed(1)}G.`}
                          {result.requestedThicknessIn != null &&
                            !c.meets_fragility_target &&
                            (c.thicker_alternative_in_same_material ? (
                              <span>
                                {" "}
                                {c.thicker_alternative_in_same_material.thickness_in}in of the same
                                material would work (
                                {c.thicker_alternative_in_same_material.g_at_operating_psi.toFixed(1)}
                                G).
                              </span>
                            ) : firstPassingAtRequestedThickness &&
                              firstPassingAtRequestedThickness.material_id !== c.material_id ? (
                              <span>
                                {" "}
                                No thicker option on file for this material.{" "}
                                {firstPassingAtRequestedThickness.name} already meets target at{" "}
                                {result.requestedThicknessIn}in (
                                {firstPassingAtRequestedThickness.g_at_operating_psi.toFixed(1)}G).
                              </span>
                            ) : null)}
                        </div>
                      )}

                      {hasRealArea && !result.requestedThicknessIn && (
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

                      {mode === "simple" && hasRealArea && !result.requestedThicknessIn && (
                        <ThicknessPills candidate={c} />
                      )}

                      {mode === "advanced" && (
                        <CushionCurveChart
                          candidate={c}
                          targetG={result.fragilityGMax}
                          operatingPsi={hasRealArea ? result.staticLoadPsi : null}
                        />
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
