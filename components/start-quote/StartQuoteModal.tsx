// components/start-quote/StartQuoteModal.tsx
//
// Step C:
// - Pull materials from DB via GET /api/materials (already exists in your repo)
// - Render by material_family (exact DB value; NO normalization)
// - Select stores material_id + material_text
//
// Keeps Step B behavior unchanged:
// - Branching flows, fit freeze, defaults, seeding keys.

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ProgressRail, {
  ProgressStep,
  ProgressState,
} from "@/components/start-quote/ProgressRail";
import StepCard from "@/components/start-quote/StepCard";
import { FIT_ALLOW_IN } from "@/components/start-quote/constants";
import { fetchNewQuoteNo, isDemoQuoteNo } from "@/lib/quote-no";
import { ARTWORK_ACCEPT, artworkProblem, uploadArtwork } from "@/lib/artwork";
import { QUOTE_TYPE_LABELS } from "@/lib/quote-types";
import { useQuoteTypes } from "@/components/start-quote/useQuoteTypes";
import { BOX_STYLES, boxStyleInfo, parseBoxStyle, parseCells, type BoxStyle } from "@/lib/box-styles";
import { matchGrade } from "@/lib/corrugated/grade-match";
import BoxShapeHint from "@/components/start-quote/BoxShapeHint";
import DielineChoices, {
  DielinePartThumb,
  dielineDisplayBlocked,
  dielineWarnings,
  readDielineFile,
  type DielineAsPick,
  type DielineRead,
  type DielineUnitsPick,
} from "@/components/start-quote/DielineChoices"; // Step 39E; Step 39P: shared reader, units, one part or display
import BoxSizesEditor, {
  describeExtraSize,
  extraSizePayload,
  extraSizesProblem,
  type ExtraBoxSize,
} from "@/components/start-quote/BoxSizesEditor";

type QuoteType = "foam_insert" | "complete_pack" | "boxes_only";
// Step 27: BoxStyle comes from lib/box-styles (boxes-only offers every style;
// foam + box keeps the RSC and mailer cards).
type FoamConfig = "bottom_top" | "bottom_only" | "custom";

const DEFAULT_TOP_PAD_IN = 1.0;

type MaterialRow = {
  id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean | null;
};

type StockCandidate = {
  id: number;
  sku: string;
  description: string;
  style: string;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
  fit_score: number;
  notes?: string;
};

// Quote numbers come from lib/quote-no.ts (Q-A-YYMMDD-NNNNN, collision-checked server-side).

function normalizeDims3(L: number | null, W: number | null, D: number | null) {
  if (!L || !W || !D) return "";
  if (!(L > 0 && W > 0 && D > 0)) return "";
  return `${L}x${W}x${D}`;
}

function toNumOrNull(s: string) {
  const n = Number(String(s || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function fmtIn(n: number | null) {
  if (!n || !Number.isFinite(n)) return "";
  const s = String(Math.round(n * 1000) / 1000);
  return s;
}

function familyLabel(fam: string | null) {
  const t = (fam || "").trim();
  return t ? t : "Other";
}

/**
 * Parse a single cavity token.
 *
 * Supports:
 *  - Rect:   3x2x1
 *  - Circle: Ø3x1 or Ø3x1 (DIAMETER x DEPTH) — already normalized by the AI
 *  - Circle shorthand: 2 numbers only => treated as DIA x DEPTH => "Ø2.5x1"
 *
 * Returns normalized string or null if invalid.
 */
function parseSingleCavity(raw: string): string | null {
  const s = String(raw || "")
    .replace(/[×\*]/g, "x")
    .replace(/\s+/g, "")
    .trim();
  if (!s) return null;

  // Circle prefix: Ø, ø, @, or text "dia"/"diam"/"diameter"
  const circlePrefixRe = /^(?:[Øø@]|dia(?:m(?:eter)?)?)(.+)/i;
  const circleMatch = s.match(circlePrefixRe);
  if (circleMatch) {
    const rest = circleMatch[1];
    const nums = rest.match(/(\d+(?:\.\d+)?|\.\d+)/g);
    if (!nums || nums.length < 2) return null;
    const dia = Number(nums[0]);
    const depth = Number(nums[1]);
    if (!dia || !depth) return null;
    return `Ø${dia}x${depth}`;
  }

  // numbers-only extraction
  const nums = s.match(/(\d+(?:\.\d+)?|\.\d+)/g);
  if (!nums) return null;

  // Rect: 3 numbers => LxWxD
  if (nums.length >= 3) {
    const L = Number(nums[0]);
    const W = Number(nums[1]);
    const D = Number(nums[2]);
    if (![L, W, D].every((n) => Number.isFinite(n) && n > 0)) return null;
    return `${L}x${W}x${D}`;
  }

  // Circle shorthand: 2 numbers => DIA x DEPTH
  if (nums.length === 2) {
    const dia = Number(nums[0]);
    const depth = Number(nums[1]);
    if (![dia, depth].every((n) => Number.isFinite(n) && n > 0)) return null;
    return `Ø${dia}x${depth}`;
  }

  return null;
}

/**
 * Parse a semicolon-delimited multi-cavity seed string.
 * Returns { normalized, isValid } where normalized is the semicolon-joined
 * string ready to pass as the `cavities=` URL param.
 */
function parseSeedCavities(raw: string): { normalized: string; isValid: boolean } {
  if (!raw || !raw.trim()) return { normalized: "", isValid: true };
  const tokens = raw.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
  const parsed = tokens.map(parseSingleCavity);
  const valid = parsed.filter((p): p is string => p !== null);
  return {
    normalized: valid.join(";"),
    isValid: valid.length === tokens.length && tokens.length > 0,
  };
}

// Legacy single-cavity wrapper used by display/validation
function parseSeedCavity(raw: string): { normalized: string; kind: "rect" | "circle" } | null {
  const s = String(raw || "")
    .replace(/[×\*]/g, "x")
    .replace(/\s+/g, "")
    .trim();
  if (!s) return null;

  // numbers-only extraction
  const nums = s.match(/(\d+(?:\.\d+)?|\.\d+)/g);
  if (!nums) return null;

  // Rect: 3 numbers => LxWxD
  if (nums.length >= 3) {
    const L = Number(nums[0]);
    const W = Number(nums[1]);
    const D = Number(nums[2]);
    if (![L, W, D].every((n) => Number.isFinite(n) && n > 0)) return null;
    return { normalized: `${L}x${W}x${D}`, kind: "rect" };
  }

  // Circle shorthand (user-selected standard): 2 numbers => DIA x DEPTH
  if (nums.length === 2) {
    const dia = Number(nums[0]);
    const depth = Number(nums[1]);
    if (![dia, depth].every((n) => Number.isFinite(n) && n > 0)) return null;
    // IMPORTANT: editor supports Ø...x... format already (see page.tsx parser)
    return { normalized: `Ø${dia}x${depth}`, kind: "circle" };
  }

  return null;
}

export default function StartQuoteModal({
  embedded = false,
  initialPrefillData = null,
  onClose,
  quoteSource,
}: {
  embedded?: boolean;
  /**
   * Bypasses the URL ?prefill= mechanism — used when the embedded chat
   * widget hands off gathered facts to an in-place "expand" within the
   * same iframe (no page navigation, so there's no URL to carry the data).
   * Same shape as the JSON object normally JSON-encoded into ?prefill=.
   */
  initialPrefillData?: Record<string, any> | null;
  /**
   * Overrides the default Close-button behavior (router.back()/push
   * ("/admin")), which doesn't make sense inside the chat-expand embed —
   * there's no app history to go back to and /admin is a staff route, not
   * a customer one. Used by EmbedChatClient to "minimize" back to the
   * chat bubble instead of navigating.
   */
  onClose?: () => void;
  /**
   * Reporting-only channel tag ("direct" | "embed_website") for where this
   * quote was created from -- distinct from sales_rep_slug (who gets
   * commission credit). Set once per entry point (this page/component
   * already knows unambiguously which channel it is) and threaded into the
   * editor URL so /api/quote/layout/apply can stamp it on quote creation.
   */
  quoteSource?: string;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---------- Parse prefill data from chatbot ----------
  const prefillData = React.useMemo(() => {
    const prefillRaw = searchParams.get("prefill");
    if (!prefillRaw) return initialPrefillData ?? null;

    try {
      const decoded = decodeURIComponent(prefillRaw);
      const parsed = JSON.parse(decoded);
      return parsed;
    } catch (err) {
      console.warn("Failed to parse prefill data:", err);
      return initialPrefillData ?? null;
    }
  }, [searchParams, initialPrefillData]);

  // ---------- Close behavior ----------
  const close = React.useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/admin");
  }, [router, onClose]);

// ---------- Seeded entry (minimal, safe) ----------
  // Check both direct URL params AND prefill data from chatbot
  const seededType = (
    searchParams.get("type") ||
    searchParams.get("quote_type") ||
    ""
  ).trim();
  const seededIsCompletePack =
    seededType === "complete_pack" ||
    seededType === "completepack" ||
    seededType === "pack";
  // Step 11: ?quote_type=boxes_only presets Boxes only (stays on the first step for the quantity).
  const seededIsBoxesOnly = seededType === "boxes_only" || seededType === "boxes";

  // ---------- State ----------
  const [activeStep, setActiveStep] = React.useState<
    "type" | "box" | "foam" | "specs" | "cav" | "mat" | "rev"
  >(seededIsCompletePack ? "box" : "type");

  const [completedSteps, setCompletedSteps] = React.useState<Set<string>>(
    () => seededIsCompletePack ? new Set<string>(["type"]) : new Set<string>(),
  );

  const [quoteType, setQuoteType] = React.useState<QuoteType>(
    seededIsCompletePack ? "complete_pack" : seededIsBoxesOnly ? "boxes_only" : "foam_insert",
  );

  // Step 11: only the quote types this shop offers (tenants.theme_json.quoteTypes).
  const { types: offeredTypes, loaded: offeredTypesLoaded } = useQuoteTypes(
    (searchParams.get("tenant") || searchParams.get("t") || "").trim().toLowerCase(),
  );
  React.useEffect(() => {
    if (!offeredTypesLoaded) return;
    if (!offeredTypes.includes(quoteType)) setQuoteType(offeredTypes[0]);
  }, [offeredTypesLoaded, offeredTypes, quoteType]);

  // Common - prefer prefill data over URL params
  const [qty, setQty] = React.useState<string>(
    searchParams.get("qty") || "",
  );
  // Material selection
  const [materialText, setMaterialText] = React.useState<string>(
    searchParams.get("material_text") ||
    searchParams.get("material") ||
    "",
  );
  const [materialId, setMaterialId] = React.useState<string>(
    searchParams.get("material_id") || "",
  );

  // Cavities seed
  const [cavitySeed, setCavitySeed] = React.useState<string>(
    searchParams.get("cavity") || "",
  );

  // Customer notes — feeds the "notes" URL param, which seeds the editor's
  // "Notes / special instructions" field and renders on the finished print
  // page. Deliberately starts blank (no URL seed) so the customer fills it
  // in themselves here, same intent as the removed comment below explained
  // before this field existed.
  const [customerNotes, setCustomerNotes] = React.useState<string>("");

  // Foam Insert specs
  const [insertL, setInsertL] = React.useState<string>("");
  const [insertW, setInsertW] = React.useState<string>("");
  const [insertD, setInsertD] = React.useState<string>("");

  // Foam Insert: cropped corners (chamfer), applied uniformly to every layer
  // in the block above. Same geometry the layout editor / CAD export already
  // support per-layer (cropCorners) — this just exposes it here too. No
  // pricing impact (matches the existing Complete Pack top-pad option).
  const [insertCropCorners, setInsertCropCorners] = React.useState<boolean>(false);

  // Foam Insert: additional bonded layers on top of the Layer 1 block above.
  // Empty by default so a plain single-block quote is unaffected.
  const [extraInsertLayers, setExtraInsertLayers] = React.useState<
    { id: string; thicknessIn: string }[]
  >([]);

  const addExtraInsertLayer = () => {
    setExtraInsertLayers((prev) => [
      ...prev,
      { id: `extra-${Date.now()}-${prev.length}`, thicknessIn: "1" },
    ]);
  };
  const removeExtraInsertLayer = (id: string) => {
    setExtraInsertLayers((prev) => prev.filter((l) => l.id !== id));
  };
  const updateExtraInsertLayerThickness = (id: string, value: string) => {
    setExtraInsertLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, thicknessIn: value } : l)),
    );
  };

  // Complete Pack: Box setup
  const [boxL, setBoxL] = React.useState<string>(
    (searchParams.get("box_l") || "").trim(),
  );
  const [boxW, setBoxW] = React.useState<string>(
    (searchParams.get("box_w") || "").trim(),
  );
  const [boxD, setBoxD] = React.useState<string>(
    (searchParams.get("box_d") || "").trim(),
  );
  const [boxStyle, setBoxStyle] = React.useState<BoxStyle>(
    parseBoxStyle(searchParams.get("box_style")) ?? "mailer",
  );
  // Step 27: partition sets (boxes only).
  const [cellsAcross, setCellsAcross] = React.useState<string>("2");
  const [cellsDown, setCellsDown] = React.useState<string>("2");
  const [printed, setPrinted] = React.useState<boolean>(
    (searchParams.get("printed") || "").trim() === "1" ||
      (searchParams.get("box_printed") || "").trim() === "1",
  );
  // Per-color printing (Corrugated Step 3B): one entry per color (spot or
  // flood) + sides. `printed` is kept in sync (colors.length > 0) for the
  // flows that still read it.
  const [printColors, setPrintColors] = React.useState<("spot" | "flood")[]>(() =>
    (searchParams.get("printed") || "").trim() === "1" ||
    (searchParams.get("box_printed") || "").trim() === "1"
      ? ["spot"]
      : [],
  );
  const [printSides, setPrintSides] = React.useState<1 | 2>(1);
  // Step 37N: panels printed (recorded on the quote and job ticket; not priced).
  const [printPanels, setPrintPanels] = React.useState<1 | 2 | 3 | 4>(2);
  // Step 39E: a die line part has no side panels (dlMode is set further down)
  const printSpecOut = () =>
    printColors.length > 0 && !dlMode
      ? { colors: printColors, sides: printSides, panels: printPanels }
      : { colors: printColors, sides: printSides };
  // Step 37N: the panels also go in the buyer's notes, so they reach the job
  // ticket on every kind of quote.
  const notesOut = () => {
    const base = customerNotes.trim();
    if (printColors.length === 0 || dlMode) return base || null;
    const line = `Printed panels: ${printPanels === 4 ? "all 4" : printPanels}`;
    return [base, line].filter(Boolean).join("\n");
  };
  const setPrintColorCount = (n: number) => {
    setPrintColors((c) => Array.from({ length: n }, (_, i) => c[i] ?? "spot"));
    setPrinted(n > 0);
  };
  const [prefillPackagingSku, setPrefillPackagingSku] = React.useState<string>(
    searchParams.get("box_sku") || "",
  );

  // Real stock box candidates for the box being specced (Complete Pack only).
  // Deliberately no price shown here (unlike the rep intake form) — this is
  // a fit-only aid for customers. Picking a candidate writes its SKU into
  // prefillPackagingSku directly, the same state an externally-prefilled
  // box_sku (from the chat widget) already seeds — so the editor-side submit
  // logic that reads prefillPackagingSku doesn't need to know which path set
  // it. boxChoice only exists to know when the customer explicitly declined
  // every stock match, so submit can tell the editor via box_choice=custom.
  const [stockCandidates, setStockCandidates] = React.useState<StockCandidate[]>([]);
  const [stockCandidatesLoading, setStockCandidatesLoading] = React.useState<boolean>(false);
  // Step 8: the buyer's own size is the default; a stock size is an optional pick.
  const [boxChoice, setBoxChoice] = React.useState<"" | "stock" | "custom">(() =>
    (searchParams.get("box_sku") || "").trim() ? "stock" : "custom",
  );

  // Board grade for a custom-size RSC (Corrugated Step 3A). "" = "Not sure —
  // recommend one" (the shop's default grade). Options are the shop's active
  // grades; the picker is hidden when the shop has none.
  type GradeOption = { id: number; name: string; flute: string; ect_label: string; is_default: boolean };
  const [boxGrades, setBoxGrades] = React.useState<GradeOption[]>([]);
  const [boxGradeId, setBoxGradeId] = React.useState<string>((searchParams.get("box_grade") || "").trim());
  // Step 37G: the board grade the buyer named in the chat, waiting for the shop's grades to load.
  const [pendingGrade, setPendingGrade] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (quoteType !== "complete_pack" && quoteType !== "boxes_only") return;
    let cancelled = false;
    const tenant = (searchParams.get("tenant") || searchParams.get("t") || "").trim().toLowerCase();
    const qs = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
    fetch(`/api/public/corrugated/grades${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && j?.ok && Array.isArray(j.grades)) setBoxGrades(j.grades);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [quoteType, searchParams]);
  // Step 37G: pick the shop grade the buyer named in the chat; if the shop has
  // no match, keep their words in the notes so the shop sees them.
  React.useEffect(() => {
    if (!pendingGrade || !boxGrades.length) return;
    const id = matchGrade(pendingGrade, boxGrades);
    if (id != null) setBoxGradeId(String(id));
    else {
      const line = `Board grade asked for: ${pendingGrade}`;
      setCustomerNotes((n) => (n.includes(line) ? n : [n.trim(), line].filter(Boolean).join("\n")));
    }
    setPendingGrade(null);
  }, [pendingGrade, boxGrades]);
  // Step 27: every custom boxes-only style is engine-priced with a grade;
  // foam + box keeps the grade picker for RSC only (as before).
  const customRscBox = !prefillPackagingSku.trim() && (quoteType === "boxes_only" || boxStyle === "rsc");
  const styleInfo = boxStyleInfo(boxStyle);
  const usesDepth = quoteType !== "boxes_only" || styleInfo.usesDepth;
  const partitionCells = quoteType === "boxes_only" && styleInfo.cells ? parseCells(Number(cellsAcross), Number(cellsDown)) : null;
  // Step 27: foam + box only offers the RSC and mailer cards.
  React.useEffect(() => {
    if (quoteType === "complete_pack" && boxStyle !== "rsc" && boxStyle !== "mailer") setBoxStyle("rsc");
  }, [quoteType, boxStyle]);

  // Boxes only (Corrugated Step 4): contact details are collected on the
  // review step, and the quote is created + priced by /api/quote/boxes-only.
  const [boName, setBoName] = React.useState<string>("");
  const [boEmail, setBoEmail] = React.useState<string>("");
  const [boCompany, setBoCompany] = React.useState<string>("");
  const [boPhone, setBoPhone] = React.useState<string>("");
  const [boBusy, setBoBusy] = React.useState<boolean>(false);
  // Up to 3 more quantities to compare on the quote (Corrugated Step 5).
  const [boBreaks, setBoBreaks] = React.useState<string[]>(["", "", ""]);
  // Print artwork picked on the review step; uploaded once the quote exists (Step 6).
  const [boArtwork, setBoArtwork] = React.useState<File[]>([]);
  const [boArtworkNote, setBoArtworkNote] = React.useState<string | null>(null);
  const [boError, setBoError] = React.useState<string | null>(null);
  // Step 9B: sizes 2..10 on a boxes-only quote. Size 1 is the box fields above.
  const [extraSizes, setExtraSizes] = React.useState<ExtraBoxSize[]>([]);
  const extraSizesProblemText = extraSizesProblem(extraSizes);
  const extraSizesOk = !extraSizesProblemText;
  const boAnyPrinted = printColors.length > 0 || extraSizes.some((s) => s.colors.length > 0);

  // Step 39E: the buyer's own die line (DXF). Read here in the browser to show
  // what was found; the server reads it again and prices it when the quote is made.
  // Step 39P: inches unless the buyer picks mm; "This file is One part / A display".
  const [dlUnits, setDlUnits] = React.useState<DielineUnitsPick>("in");
  const [dlAs, setDlAs] = React.useState<DielineAsPick>("single");
  const [dlFile, setDlFile] = React.useState<File | null>(null);
  const [dlRead, setDlRead] = React.useState<DielineRead | null>(null);
  const [dlError, setDlError] = React.useState<string | null>(null);
  // Step 39X: grade = the part's own board grade id ("" = the quote's Board grade)
  const [dlParts, setDlParts] = React.useState<Record<number, { label: string; per: string; grade?: string }>>({});
  const [dlInputKey, setDlInputKey] = React.useState(0);
  // The chat said the buyer has a die line: the form opens on Box Setup to upload it.
  const [dlWanted, setDlWanted] = React.useState(false);
  const dlMode = quoteType === "boxes_only" && !!dlFile && !!dlRead;
  const dlDisplay = dlMode && dlAs === "display" && (dlRead?.pieces.length ?? 0) > 1;
  const dlPartsOk =
    !dielineDisplayBlocked(dlRead, dlAs) &&
    (!dlDisplay || Object.values(dlParts).every((p) => /^\d+$/.test(p.per) && Number(p.per) >= 1));
  const dlSpecHref = (() => {
    const t = (searchParams.get("tenant") || searchParams.get("t") || "").trim().toLowerCase();
    return t ? `/t/${encodeURIComponent(t)}/specs` : null;
  })();
  const pickDieline = async (f: File | null) => {
    setDlError(null);
    setDlRead(null);
    setDlParts({});
    setDlFile(null);
    setDlUnits("in");
    if (!f) {
      setDlInputKey((k) => k + 1);
      return;
    }
    if (!/\.(dxf|pdf)$/i.test(f.name)) {
      setDlError("Upload your die line as a .dxf file or a vector .pdf. For a DWG or STEP drawing, send it to the shop.");
      return;
    }
    await loadDieline(f, "in", null);
  };
  // Step 39P: read (or re-read with a new units pick) the file; names and counts
  // are kept when the same parts come back.
  const loadDieline = async (f: File, units: DielineUnitsPick, prev: { read: DielineRead; as: DielineAsPick } | null) => {
    const r = await readDielineFile(f, { units });
    if (!r.ok) {
      setDlError(`${r.message} You can send it to the shop instead and they'll quote it.`);
      return;
    }
    setDlError(null);
    const read = r.read;
    const same = !!prev && prev.read.pieces.length === read.pieces.length;
    setDlParts((old) =>
      read.pieces.length > 1
        ? Object.fromEntries(read.pieces.map((p) => [p.piece, (same ? old[p.piece] : null) ?? { label: "", per: "1" }]))
        : {},
    );
    setDlAs(prev ? prev.as : read.pieces.length > 1 ? "display" : "single");
    setDlUnits(units);
    setDlRead(read);
    setDlFile(f);
    // A die line quote is just this file: no stock box, no extra sizes.
    setExtraSizes([]);
    setPrefillPackagingSku("");
    setBoxChoice("custom");
  };
  const setDielineUnits = (u: DielineUnitsPick) => {
    if (dlFile && dlRead) void loadDieline(dlFile, u, { read: dlRead, as: dlAs });
  };

  // ---------- Seed all state from prefillData once it resolves ----------
  // prefillData comes from useMemo(searchParams) which may be null on first render
  // in Next.js App Router. This effect fires as soon as it's available.
  // Step 12: a chat hand-off can choose where the form opens for its quote type
  // (Boxes only -> the review step). The quote-type reset effect honors it once.
  const prefillStepRef = React.useRef<{
    type: QuoteType;
    step: "type" | "box" | "foam" | "specs" | "cav" | "mat" | "rev";
    done: string[];
  } | null>(null);
  const prefillSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (!prefillData || prefillSeededRef.current) return;
    prefillSeededRef.current = true;

    // Qty
    if (prefillData.qty) setQty(String(prefillData.qty));

    // Step 12: boxes-only chat hand-off — size, style, printing and contact go
    // straight into Boxes only, and the form opens on the review step.
    if (prefillData.quoteKind === "boxes") {
      const b = prefillData.box || {};
      if (b.l) setBoxL(String(b.l));
      if (b.w) setBoxW(String(b.w));
      if (b.d) setBoxD(String(b.d));
      setBoxStyle(parseBoxStyle(b.style) ?? "rsc");
      const colors: ("spot" | "flood")[] = Array.isArray(prefillData.print?.colors)
        ? prefillData.print.colors
            .filter((c: unknown) => c === "spot" || c === "flood")
            .slice(0, 4)
        : [];
      setPrintColors(colors);
      setPrinted(colors.length > 0);
      setPrintSides(prefillData.print?.sides === 2 ? 2 : 1);
      {
        const pn = Number(prefillData.print?.panels);
        if (pn === 1 || pn === 2 || pn === 3 || pn === 4) setPrintPanels(pn);
      }
      if (typeof prefillData.customerName === "string" && prefillData.customerName.trim()) {
        setBoName(prefillData.customerName.trim());
      }
      if (typeof prefillData.customerEmail === "string" && prefillData.customerEmail.trim()) {
        setBoEmail(prefillData.customerEmail.trim());
      }
      // Step 37G: the chat's notes, and its board grade (matched once the shop's grades load).
      if (typeof prefillData.notes === "string" && prefillData.notes.trim()) {
        setCustomerNotes(prefillData.notes.trim());
      }
      if (typeof b.grade === "string" && b.grade.trim()) setPendingGrade(b.grade.trim());
      // Step 39E: a buyer with a die line opens on Box Setup to upload it.
      const dlStep = prefillData.dieline === true;
      if (dlStep) setDlWanted(true);
      prefillStepRef.current = { type: "boxes_only", step: dlStep ? "box" : "rev", done: dlStep ? ["type"] : ["type", "box"] };
      if (quoteType === "boxes_only") {
        // Step 14: already Boxes only (e.g. ?quote_type=boxes_only), so the type
        // won't change — open the review step directly.
        setActiveStep(dlStep ? "box" : "rev");
        setCompletedSteps(new Set(dlStep ? ["type"] : ["type", "box"]));
        setTimeout(() => {
          prefillStepRef.current = null;
        }, 0);
      }
      setQuoteType("boxes_only");
      return;
    }

    // Material
    if (prefillData.material?.text) setMaterialText(prefillData.material.text);
    if (prefillData.material?.id != null) setMaterialId(String(prefillData.material.id));

    // Cavity seed (multi-cavity string)
    if (prefillData.cavities) setCavitySeed(prefillData.cavities);

    // Printing preference
    if (prefillData.printed === true) {
      setPrinted(true);
      setPrintColors((c) => (c.length ? c : ["spot"]));
    }

    // Stock box SKU (only present if customer chose it in the widget)
    if (prefillData.packagingSku) setPrefillPackagingSku(prefillData.packagingSku);

    // Ship mode → quote type + box dims
    const isCompletePack =
      prefillData.shipMode === "box" || prefillData.shipMode === "mailer";

    if (isCompletePack) {
      // Seed layer thicknesses BEFORE calling setQuoteType so the quoteType-change
      // effect (which resets topThk to the default) sees prefillSeededRef.current = true
      // and skips the reset. Convention: thks[0] = bottom, thks[last] = top pad.
      const thks = Array.isArray(prefillData.layerThicknesses) ? prefillData.layerThicknesses : [];
      if (thks.length >= 2) {
        const bottomVal = String(thks[0] ?? "").trim();
        const topVal = String(thks[thks.length - 1] ?? "").trim();
        if (bottomVal && Number(bottomVal) > 0) setBottomThk(bottomVal);
        if (topVal && Number(topVal) > 0) setTopThk(topVal);
        // Mark as manual so freezeFoamFitFromCurrentBox doesn't overwrite
        // these widget-seeded values with auto-calculated round numbers when
        // the user clicks Next on the box step.
        setThicknessMode("manual");
      } else if (thks.length === 1) {
        const bottomVal = String(thks[0] ?? "").trim();
        if (bottomVal && Number(bottomVal) > 0) {
          setBottomThk(bottomVal);
          setThicknessMode("manual");
        }
      }

      // Step 14: the quote-type reset would send the form back to step 1; make it
      // honor Box Setup once (the box and foam details are already filled in).
      prefillStepRef.current = { type: "complete_pack", step: "box", done: ["type"] };
      if (quoteType === "complete_pack") {
        setTimeout(() => {
          prefillStepRef.current = null;
        }, 0);
      }
      setQuoteType("complete_pack");
      setActiveStep("box");
      setCompletedSteps(new Set(["type"]));

      if (prefillData.outside?.l) setBoxL(String(prefillData.outside.l));
      if (prefillData.outside?.w) setBoxW(String(prefillData.outside.w));
      if (prefillData.outside?.h) setBoxD(String(prefillData.outside.h));

      const style = prefillData.shipMode === "box" ? "rsc" : "mailer";
      setBoxStyle(style);

      // Seed foam config from insertType: "set" → bottom_top, "single" → bottom_only
      if (prefillData.insertType === "set") {
        setFoamConfig("bottom_top");
      } else if (prefillData.insertType === "single") {
        setFoamConfig("bottom_only");
      }
    } else {
      // Foam insert — seed insert dims from outside
      if (prefillData.outside?.l) setInsertL(String(prefillData.outside.l));
      if (prefillData.outside?.w) setInsertW(String(prefillData.outside.w));
      if (prefillData.outside?.h) setInsertD(String(prefillData.outside.h));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per prefill; reads quoteType at that moment
  }, [prefillData]);

// Seed insert dims from URL params (non-prefill path)
  React.useEffect(() => {
    if (prefillData) return; // prefill useEffect handles this case
    const dims = (searchParams.get("dims") || "").trim();
    if (!dims) return;
    const m = dims
      .replace(/[×\*]/g, "x")
      .match(
        /^\s*(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*$/i,
      );
    if (!m) return;
    if (!seededIsCompletePack) {
      setInsertL(m[1]);
      setInsertW(m[2]);
      setInsertD(m[3]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Complete Pack: Foam config
  const [foamConfig, setFoamConfig] = React.useState<FoamConfig>("bottom_top");

  // Fit freeze
  const [foamFitFrozen, setFoamFitFrozen] = React.useState<boolean>(false);
  const [foamFitDirty, setFoamFitDirty] = React.useState<boolean>(false);
  const [foamFitLenIn, setFoamFitLenIn] = React.useState<number | null>(null);
  const [foamFitWidIn, setFoamFitWidIn] = React.useState<number | null>(null);

  // Thickness
  const [thicknessMode, setThicknessMode] =
    React.useState<"auto" | "manual">("auto");
  const [bottomThk, setBottomThk] = React.useState<string>("");
  const [topThk, setTopThk] = React.useState<string>(
    String(DEFAULT_TOP_PAD_IN),
  );

  // Debounced (500ms) lookup of real stock candidates once box L/W/D are
  // filled in. Same /api/boxes/suggest endpoint the rep intake form and the
  // layout editor's own auto-pick use, but qty is intentionally omitted —
  // nothing here needs pricing, so the response's candidates come back
  // unpriced. Unlike the rep form, this does NOT reset boxChoice or
  // prefillPackagingSku when dims change: prefillPackagingSku already had a
  // "sticky" contract with the chat-widget prefill path (an externally-set
  // box_sku was never invalidated by later dimension edits), and this effect
  // preserves that instead of introducing a new reset behavior.
  React.useEffect(() => {
    if (quoteType !== "complete_pack" && quoteType !== "boxes_only") {
      setStockCandidates([]);
      setStockCandidatesLoading(false);
      return;
    }

    const boxLNum = toNumOrNull(boxL);
    const boxWNum = toNumOrNull(boxW);
    const boxDNum = toNumOrNull(boxD);

    if (!boxLNum || !boxWNum || !boxDNum) {
      setStockCandidates([]);
      setStockCandidatesLoading(false);
      return;
    }

    setStockCandidatesLoading(true);

    const bottomThkNum = toNumOrNull(bottomThk) ?? 0;
    const topThkNum = foamConfig === "bottom_top" ? (toNumOrNull(topThk) ?? 0) : 0;
    // Boxes only: no foam stack — match on the box's own depth.
    const stackDepth = quoteType === "boxes_only" ? 0 : bottomThkNum + topThkNum;

    // Boxes only: the entered size is the box inside size, so no foam fit
    // allowance comes off it (the suggester is told via inside_match).
    const footprintL = quoteType === "boxes_only" ? boxLNum : Math.max(0, boxLNum - FIT_ALLOW_IN);
    const footprintW = quoteType === "boxes_only" ? boxWNum : Math.max(0, boxWNum - FIT_ALLOW_IN);

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/boxes/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            footprint_length_in: footprintL,
            footprint_width_in: footprintW,
            stack_depth_in: stackDepth > 0 ? stackDepth : boxDNum,
            inside_match: quoteType === "boxes_only",
          }),
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;

        if (json?.ok) {
          // Step 27: the stock catalog has RSCs and mailers only.
          const list = boxStyle === "rsc" ? json.candidatesRsc : boxStyle === "mailer" ? json.candidatesMailer : [];
          setStockCandidates(Array.isArray(list) ? list : []);
        } else {
          setStockCandidates([]);
        }
      } catch {
        if (!cancelled) setStockCandidates([]);
      } finally {
        if (!cancelled) setStockCandidatesLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quoteType, boxL, boxW, boxD, boxStyle, foamConfig, bottomThk, topThk]);

  // ----- Materials (Step C) -----
  const [materialsLoading, setMaterialsLoading] =
    React.useState<boolean>(false);
  const [materialsError, setMaterialsError] = React.useState<string>("");
  const [materials, setMaterials] = React.useState<MaterialRow[]>([]);
  const [activeFamily, setActiveFamily] = React.useState<string>("");

  const loadMaterials = React.useCallback(async () => {
    setMaterialsLoading(true);
    setMaterialsError("");

    try {
      const res = await fetch(`/api/materials?t=${Math.random()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.toLowerCase().includes("application/json")) {
        throw new Error("Materials endpoint did not return JSON.");
      }

      const json = (await res.json()) as any;
      if (!json?.ok || !Array.isArray(json?.materials)) {
        throw new Error("Unable to load materials list.");
      }

      const rows: MaterialRow[] = json.materials;
      // Active-only (treat null as active to avoid hiding legacy rows unexpectedly)
      const activeOnly = rows.filter((r) => r.is_active !== false);

      setMaterials(activeOnly);

      // Default family selection:
      // - if selected materialId exists, pick its family
      // - else pick first family in list
      let fam = "";
      const idNum = Number(materialId);
      if (Number.isFinite(idNum) && idNum > 0) {
        const hit = activeOnly.find((r) => r.id === idNum);
        fam = familyLabel(hit?.material_family ?? null);
      }
      if (!fam) {
        const first = activeOnly[0];
        fam = familyLabel(first?.material_family ?? null);
      }
      setActiveFamily(fam);
    } catch (e: any) {
      setMaterialsError(e?.message || "Unable to load materials.");
      setMaterials([]);
      setActiveFamily("");
    } finally {
      setMaterialsLoading(false);
    }
  }, [materialId]);

  // Load materials when entering the Material step (and only once unless refresh requested)
  React.useEffect(() => {
    if (activeStep !== "mat") return;
    if (materialsLoading) return;
    if (materials.length > 0 || materialsError) return;
    void loadMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);

  const families = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of materials) set.add(familyLabel(r.material_family));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [materials]);

  const familyMaterials = React.useMemo(() => {
    const fam = activeFamily || (families[0] || "");
    const list = materials.filter(
      (m) => familyLabel(m.material_family) === fam,
    );
    // sort by density then name (stable, predictable)
    return list.sort((a, b) => {
      const da = a.density_lb_ft3 ?? 9999;
      const db = b.density_lb_ft3 ?? 9999;
      if (da !== db) return da - db;
      return a.material_name.localeCompare(b.material_name);
    });
  }, [materials, activeFamily, families]);

  const onSelectMaterial = (m: MaterialRow) => {
    setMaterialId(String(m.id));
    setMaterialText(m.material_name);
    // Keep family synced so selection stays visible
    setActiveFamily(familyLabel(m.material_family));
  };

  const clearMaterial = () => {
    setMaterialId("");
    setMaterialText("");
  };

  // Derived foam L/W during Box step (if not frozen)
  const boxLNum = toNumOrNull(boxL);
  const boxWNum = toNumOrNull(boxW);
  const boxDNum = toNumOrNull(boxD);

  const liveFoamLen = boxLNum ? Math.max(0, boxLNum - FIT_ALLOW_IN) : null;
  const liveFoamWid = boxWNum ? Math.max(0, boxWNum - FIT_ALLOW_IN) : null;

  // When quote type switches, reset pack state cleanly
  React.useEffect(() => {
    // Step 12: a chat hand-off picked its own starting step for this type — honor it once.
    const pending = prefillStepRef.current;
    if (pending && pending.type === quoteType) {
      prefillStepRef.current = null;
      setActiveStep(pending.step);
      setCompletedSteps(new Set(pending.done));
      return;
    }
    setActiveStep("type");
    setCompletedSteps(new Set());
    if (quoteType === "foam_insert") {
      setFoamFitFrozen(false);
      setFoamFitDirty(false);
      setFoamFitLenIn(null);
      setFoamFitWidIn(null);
      // Don't reset thicknesses, thicknessMode, or foamConfig if prefill already
      // seeded them. If we reset thicknessMode to 'auto' here, freezeFoamFitFromCurrentBox
      // will overwrite the widget values with rounded auto-calculated numbers on Next.
      // foamConfig in particular must stay guarded too — this effect fires on mount
      // with quoteType still at its "foam_insert" default (seededIsCompletePack only
      // checks URL params, not prefillData), so without the guard it clobbers the
      // prefill effect's setFoamConfig("bottom_only") for insertType: "single".
      if (!prefillSeededRef.current) {
        setThicknessMode("auto");
        setBottomThk("");
        setTopThk(String(DEFAULT_TOP_PAD_IN));
        setFoamConfig("bottom_top");
      }
    }
  }, [quoteType]);

  // Box edits after frozen mark dirty (B behavior)
  React.useEffect(() => {
    if (quoteType !== "complete_pack") return;
    if (!foamFitFrozen) return;
    setFoamFitDirty(true);
  }, [boxL, boxW, boxD, quoteType, foamFitFrozen]);

  const freezeFoamFitFromCurrentBox = React.useCallback(() => {
    const L = toNumOrNull(boxL);
    const W = toNumOrNull(boxW);
    const D = toNumOrNull(boxD);
    if (!L || !W || !D) return false;

    const fL = Math.max(0, L - FIT_ALLOW_IN);
    const fW = Math.max(0, W - FIT_ALLOW_IN);

    setFoamFitLenIn(fL);
    setFoamFitWidIn(fW);
    setFoamFitFrozen(true);
    setFoamFitDirty(false);

    if (thicknessMode === "auto") {
      if (foamConfig === "bottom_top") {
        const top = Math.min(DEFAULT_TOP_PAD_IN, D);
        const bottom = Math.max(0, D - top);
        setTopThk(String(top));
        setBottomThk(String(bottom));
      } else if (foamConfig === "bottom_only") {
        setTopThk(String(DEFAULT_TOP_PAD_IN));
        setBottomThk(String(D));
      }
    }

    return true;
  }, [boxL, boxW, boxD, thicknessMode, foamConfig]);

  const onRecalcFoamFit = React.useCallback(() => {
    const ok = freezeFoamFitFromCurrentBox();
    if (!ok) return;
  }, [freezeFoamFitFromCurrentBox]);

  const onBottomThkChange = (v: string) => {
    setBottomThk(v);
    setThicknessMode("manual");
  };
  const onTopThkChange = (v: string) => {
    setTopThk(v);
    setThicknessMode("manual");
  };

  // ---------- Step completion / gating ----------
  const qtyNum = toNumOrNull(qty);
  const qtyOk = !!qtyNum;

  const insertDimsOk =
    quoteType === "foam_insert"
      ? !!(toNumOrNull(insertL) && toNumOrNull(insertW) && toNumOrNull(insertD)) &&
        extraInsertLayers.every((l) => !!toNumOrNull(l.thicknessIn))
      : true;

  const boxOk = dlMode
    ? dlPartsOk // Step 39E: the die line file is the box
    : quoteType === "complete_pack" || quoteType === "boxes_only"
      ? !!(
          toNumOrNull(boxL) &&
          toNumOrNull(boxW) &&
          (!usesDepth || toNumOrNull(boxD)) &&
          toNumOrNull(boxL)! > FIT_ALLOW_IN &&
          toNumOrNull(boxW)! > FIT_ALLOW_IN &&
          // Step 27: partition sets need their cells
          (!(quoteType === "boxes_only" && styleInfo.cells) || !!partitionCells)
        )
      : true;
  // Step 27: "12x10x8", or "12x10" for pads.
  const boxSizeText = usesDepth
    ? normalizeDims3(boxLNum, boxWNum, boxDNum)
    : boxLNum && boxWNum
      ? `${boxLNum}x${boxWNum}`
      : "";

  const foamConfigOk = quoteType === "complete_pack" ? !!foamConfig : true;

  const thicknessOk =
    quoteType === "complete_pack"
      ? (() => {
          const b = toNumOrNull(bottomThk);
          const t = foamConfig === "bottom_top" ? toNumOrNull(topThk) : 0;
          const D = toNumOrNull(boxD);
          if (!D) return false;
          if (foamConfig === "bottom_top") {
            if (!b || !t) return false;
            return b >= 0 && t >= 0 && b + t <= D + 0.0001;
          }
          if (foamConfig === "bottom_only") {
            if (!b) return false;
            return b >= 0 && b <= D + 0.0001;
          }
          if (!b) return false;
          return b >= 0 && b <= D + 0.0001;
        })()
      : true;

  const foamFitOk =
    quoteType === "complete_pack"
      ? !!(
          foamFitFrozen &&
          foamFitLenIn &&
          foamFitWidIn &&
          foamFitLenIn > 0 &&
          foamFitWidIn > 0
        )
      : true;

  const canGoNext = (step: typeof activeStep) => {
    // We want qty in-flow (not just "optional"): require it before leaving Type.
    if (step === "type") return qtyOk;

    if (quoteType === "foam_insert") {
      if (step === "specs") return qtyOk && insertDimsOk;
      if (step === "cav") return qtyOk && insertDimsOk;
      if (step === "mat") return qtyOk && insertDimsOk;
      if (step === "rev") return qtyOk && insertDimsOk;
      return qtyOk;
    }

    if (quoteType === "boxes_only") {
      if (step === "box" || step === "rev") return qtyOk && boxOk && extraSizesOk;
      return qtyOk;
    }

    if (step === "box") return qtyOk && boxOk;
    if (step === "foam") return qtyOk && boxOk && foamFitOk && foamConfigOk && thicknessOk;
    if (step === "cav") return qtyOk && boxOk && foamFitOk && foamConfigOk && thicknessOk;
    if (step === "mat") return qtyOk && boxOk && foamFitOk && foamConfigOk && thicknessOk;
    if (step === "rev") return qtyOk && boxOk && foamFitOk && foamConfigOk && thicknessOk;
    return qtyOk;
  };

  const nextStep = (step: typeof activeStep): typeof activeStep => {
    if (quoteType === "foam_insert") {
      if (step === "type") return "specs";
      if (step === "specs") return "cav";
      if (step === "cav") return "mat";
      if (step === "mat") return "rev";
      return "rev";
    }
    if (quoteType === "boxes_only") return step === "type" ? "box" : "rev";
    if (step === "type") return "box";
    if (step === "box") return "foam";
    if (step === "foam") return "cav";
    if (step === "cav") return "mat";
    if (step === "mat") return "rev";
    return "rev";
  };

  const prevStep = (step: typeof activeStep): typeof activeStep => {
    if (quoteType === "foam_insert") {
      if (step === "rev") return "mat";
      if (step === "mat") return "cav";
      if (step === "cav") return "specs";
      if (step === "specs") return "type";
      return "type";
    }
    if (quoteType === "boxes_only") return step === "rev" ? "box" : "type";
    if (step === "rev") return "mat";
    if (step === "mat") return "cav";
    if (step === "cav") return "foam";
    if (step === "foam") return "box";
    if (step === "box") return "type";
    return "type";
  };

  const markStepComplete = (key: string) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  // Steps for rail (dynamic)
  const railSteps: ProgressStep[] = (() => {
    const mk = (
      key: ProgressStep["key"],
      label: string,
      state: ProgressState,
    ): ProgressStep => ({
      key,
      label,
      state,
    });

    const steps: ProgressStep[] = [];

    steps.push(
      mk(
        "type",
        offeredTypes.length > 1 ? "Quote Type" : "Quantity",
        activeStep === "type" ? "active" : qtyOk ? "done" : "upcoming",
      ),
    );

    if (quoteType === "foam_insert") {
      steps.push(
        mk(
          "specs",
          "Foam Specs",
          activeStep === "specs"
            ? "active"
            : insertDimsOk && qtyOk
              ? "done"
              : "upcoming",
        ),
      );

      // Cavities/material are optional — consider "done" once user has progressed past them.
      steps.push(
        mk(
          "cav",
          "Cavities",
          activeStep === "cav"
            ? "active"
            : completedSteps.has("cav")
              ? "done"
              : "upcoming",
        ),
      );
      steps.push(
        mk(
          "mat",
          "Material",
          activeStep === "mat"
            ? "active"
            : completedSteps.has("mat")
              ? "done"
              : "upcoming",
        ),
      );
      steps.push(
        mk(
          "rev",
          "Review",
          activeStep === "rev"
            ? "active"
            : completedSteps.has("rev")
              ? "done"
              : "upcoming",
        ),
      );
      return steps;
    }

    if (quoteType === "boxes_only") {
      steps.push(
        mk(
          "box",
          "Box Setup",
          activeStep === "box" ? "active" : boxOk && qtyOk && completedSteps.has("box") ? "done" : "upcoming",
        ),
      );
      steps.push(mk("rev", "Review", activeStep === "rev" ? "active" : "upcoming"));
      return steps;
    }

    steps.push(
      mk(
        "box",
        "Box Setup",
        activeStep === "box"
          ? "active"
          : boxOk && foamFitFrozen && qtyOk
            ? "done"
            : "upcoming",
      ),
    );
    steps.push(
      mk(
        "foam",
        "Foam Structure",
        activeStep === "foam"
          ? "active"
          : completedSteps.has("foam")
            ? "done"
            : "upcoming",
      ),
    );
    steps.push(
      mk(
        "cav",
        "Cavities",
        activeStep === "cav"
          ? "active"
          : completedSteps.has("cav")
            ? "done"
            : "upcoming",
      ),
    );
    steps.push(
      mk(
        "mat",
        "Material",
        activeStep === "mat"
          ? "active"
          : completedSteps.has("mat")
            ? "done"
            : "upcoming",
      ),
    );
    steps.push(
      mk(
        "rev",
        "Review",
        activeStep === "rev"
          ? "active"
          : completedSteps.has("rev")
            ? "done"
            : "upcoming",
      ),
    );
    return steps;
  })();

  const normalizedSeed = React.useMemo(() => {
    return parseSeedCavities(cavitySeed).normalized;
  }, [cavitySeed]);

  const cavitySeedInvalid =
    cavitySeed.trim().length > 0 && !parseSeedCavities(cavitySeed).isValid;

  // ---------- Launch (seed editor URL) ----------
  const onLaunchEditor = async () => {
    if (!qtyOk) return;

    if (quoteType === "foam_insert") {
      if (!insertDimsOk) return;
    } else {
      if (!boxOk || !foamFitOk || !thicknessOk) return;
    }

    // If prefill supplied a demo quote_no (Q-D- or legacy Q-DEMO-, from the
    // landing page demo flow), use it so the Apply route can find the
    // already-created DB row. Otherwise get a fresh, collision-checked
    // Q-A- number. Quote-center and chat quotes always take this path, so
    // they are real quotes.
    const prefillQuoteNo =
      typeof prefillData?.quoteNo === "string" && isDemoQuoteNo(prefillData.quoteNo)
        ? prefillData.quoteNo.trim()
        : null;
    const quote_no = prefillQuoteNo ?? (await fetchNewQuoteNo("A"));

    const p = new URLSearchParams();

    const salesSlugFromPrefill =
      typeof prefillData?.salesRepSlug === "string" ? prefillData.salesRepSlug : "";
    const salesSlugFromUrl = (
      searchParams.get("sales_rep_slug") ||
      searchParams.get("sales") ||
      searchParams.get("rep") ||
      salesSlugFromPrefill ||
      ""
    ).trim();
    if (salesSlugFromUrl) p.set("sales_rep_slug", salesSlugFromUrl);

    if (quoteSource) p.set("quote_source", quoteSource);

    const tenantFromUrl = (searchParams.get("tenant") || searchParams.get("t") || "").trim();
    if (tenantFromUrl) p.set("tenant", tenantFromUrl);

    // Thread demo flag through to the editor URL so the editor knows to use
    // /api/quote/layout/apply without auth.
    const demoFromUrl = (searchParams.get("demo") || "").trim();
    if (demoFromUrl === "1" || prefillQuoteNo) p.set("demo", "1");

    p.set("quote_no", quote_no);

    if (qtyNum) p.set("qty", String(qtyNum));

    // Step 24: up to 3 more quantities to compare on the quote (foam paths).
    const foamBreaks = boBreaks
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n !== qtyNum);
    if (foamBreaks.length > 0) p.set("qty_breaks", Array.from(new Set(foamBreaks)).slice(0, 3).join(","));


    const matIdNum = Number(materialId);
    const hasMaterialId = Number.isFinite(matIdNum) && matIdNum > 0;
    if (hasMaterialId) {
      p.set("material_id", String(matIdNum));
      p.set("material_mode", "known");
    }
    if (materialText.trim()) p.set("material_text", materialText.trim());

    const seedCav = parseSeedCavities(cavitySeed).normalized;

    if (quoteType === "foam_insert") {
      const L = toNumOrNull(insertL);
      const W = toNumOrNull(insertW);
      const D = toNumOrNull(insertD);
      const dims = normalizeDims3(L, W, D);
      if (dims) p.set("dims", dims);

      p.set("layer_count", String(1 + extraInsertLayers.length));
      p.append("layer_thicknesses", String(D || 1));
      p.append("layer_label", "Layer 1");
      p.append("layer_crop", insertCropCorners ? "1" : "0");
      extraInsertLayers.forEach((layer, i) => {
        p.append("layer_thicknesses", String(toNumOrNull(layer.thicknessIn) || 1));
        p.append("layer_label", `Layer ${i + 2}`);
        p.append("layer_crop", insertCropCorners ? "1" : "0");
      });
      p.set("layer_cavity_layer_index", "1");
      p.set("activeLayer", "1");
      p.set("active_layer", "1");

      if (seedCav) p.set("cavities", seedCav);
    } else {
      // Bottom insert dims always based on FOAM FIT (L/W) and bottom thickness (D)
      const L = foamFitLenIn;
      const W = foamFitWidIn;
      const bottomD = toNumOrNull(bottomThk);
      const dims = normalizeDims3(L, W, bottomD);
      if (dims) p.set("dims", dims);

      // IMPORTANT: seed top pad as a second layer when bottom+top is chosen.
      if (foamConfig === "bottom_top") {
        const t = toNumOrNull(topThk);
        p.set("layer_count", "2");
        p.append("layer_thicknesses", String(bottomD || 1));
        p.append("layer_label", "Bottom Insert");
        p.append("layer_thicknesses", String(t || DEFAULT_TOP_PAD_IN));
        p.append("layer_label", "Top Pad");
        p.set("layer_cavity_layer_index", "1"); // cavities apply to bottom insert
        p.set("activeLayer", "1");
        p.set("active_layer", "1");
        if (t) p.set("top_pad_in", String(t));
      } else {
        p.set("layer_count", "1");
        p.append("layer_thicknesses", String(bottomD || 1));
        p.append("layer_label", "Layer 1");
        p.set("layer_cavity_layer_index", "1");
        p.set("activeLayer", "1");
        p.set("active_layer", "1");
      }

      if (seedCav) p.set("cavities", seedCav);

      if (boxLNum) p.set("box_l", String(boxLNum));
      if (boxWNum) p.set("box_w", String(boxWNum));
      if (boxDNum) p.set("box_d", String(boxDNum));
      p.set("box_style", boxStyle);
      // A stock pick (from the chat-widget prefill OR the pick-list below)
      // always wins; otherwise, if the customer explicitly declined every
      // stock match, tell the editor to skip auto-suggestion and commit the
      // typed dims as a real kind='custom' selection instead — same param
      // the layout editor already respects from the rep-form work.
      if (prefillPackagingSku.trim()) {
        p.set("box_sku", prefillPackagingSku.trim());
      } else if (boxChoice === "custom") {
        p.set("box_choice", "custom");
      }
      if (customRscBox && /^\d+$/.test(boxGradeId)) {
        p.set("box_grade", boxGradeId);
      }
      p.set("print_colors", printColors.join(","));
      p.set("print_sides", String(printSides));
      if (printColors.length > 0) p.set("print_panels", String(printPanels)); // Step 37N
      p.set("printed", printColors.length > 0 ? "1" : "0");
      p.set("pack_type", "complete_pack");
      p.set("foam_config", foamConfig);
      p.set("fit_allow_in", String(FIT_ALLOW_IN));

      // Pre-seed customer_box_in and printed into facts so the quote page
      // can show them immediately without waiting for the editor to open.
      // NOTE: uses /api/quote/customer-box (public route) — /api/admin/mem
      // requires admin auth and would silently fail for public customers here.
      if (boxLNum && boxWNum && boxDNum) {
        fetch("/api/quote/customer-box", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no,
            box: { L: boxLNum, W: boxWNum, H: boxDNum, style: boxStyle },
            printed: printColors.length > 0 ? 1 : 0,
            print_spec: printSpecOut(),
          }),
        }).catch(() => null);
      }
    }

    // Internal hints (fit tips, box suggestions) are stored in internalHints, not notes.
    {
      const n = notesOut();
      if (n) p.set("notes", n);
    }

    router.push(`/quote/layout?${p.toString()}`);
  };

  // ---------- Boxes only: create + price the quote, then show it ----------
  const onSubmitBoxesOnly = async () => {
    if (!qtyOk || !boxOk || boBusy) return;
    if (!extraSizesOk) {
      setBoError(extraSizesProblemText);
      return;
    }
    const name = boName.trim();
    const email = boEmail.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setBoError("Enter your name and a valid email so we can save your quote.");
      return;
    }
    setBoBusy(true);
    setBoError(null);
    try {
      const quote_no = await fetchNewQuoteNo("A");
      const salesSlug = (
        searchParams.get("sales_rep_slug") ||
        searchParams.get("sales") ||
        searchParams.get("rep") ||
        (typeof prefillData?.salesRepSlug === "string" ? prefillData.salesRepSlug : "") ||
        ""
      ).trim();
      const tenantSlug = (searchParams.get("tenant") || searchParams.get("t") || "").trim().toLowerCase();
      // Size 1 = the box fields; Step 9B extra sizes go to /multi with it.
      const size1Box = prefillPackagingSku.trim()
        ? { sku: prefillPackagingSku.trim() }
        : {
            L: boxLNum,
            W: boxWNum,
            D: usesDepth ? boxDNum : 0,
            style: boxStyle,
            ...(partitionCells ? { cells_across: partitionCells.across, cells_down: partitionCells.down } : {}),
            grade_id: customRscBox && /^\d+$/.test(boxGradeId) ? Number(boxGradeId) : null,
          };
      const size1Breaks = boBreaks
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      const boCustomer = { name, email, company: boCompany.trim() || null, phone: boPhone.trim() || null };
      // Step 39E: a die line quote sends the file with the same details.
      const dielineForm = () => {
        const fd = new FormData();
        fd.set(
          "payload",
          JSON.stringify({
            quote_no,
            tenant_slug: tenantSlug || null,
            quote_source: quoteSource || null,
            sales_rep_slug: salesSlug || null,
            customer: boCustomer,
            qty: qtyNum,
            box: { grade_id: /^\d+$/.test(boxGradeId) ? Number(boxGradeId) : null },
            parts: dlDisplay
              ? Object.entries(dlParts).map(([piece, v]) => ({
                  piece: Number(piece),
                  label: v.label.trim() || null,
                  per_display: Number(v.per) || 1,
                  grade_id: /^\d+$/.test(v.grade ?? "") ? Number(v.grade) : null, // Step 39X
                }))
              : [],
            dieline_units: dlUnits, // Step 39P
            dieline_as: dlDisplay ? "display" : "single",
            print_spec: printSpecOut(),
            qty_breaks: size1Breaks,
            notes: notesOut(),
          }),
        );
        if (dlFile) fd.set("file", dlFile);
        return fd;
      };
      const res = dlMode
        ? await fetch("/api/quote/boxes-only", { method: "POST", body: dielineForm() })
        : extraSizes.length > 0
          ? await fetch("/api/quote/boxes-only/multi", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                quote_no,
                tenant_slug: tenantSlug || null,
                quote_source: quoteSource || null,
                sales_rep_slug: salesSlug || null,
                customer: boCustomer,
                notes: notesOut(),
                boxes: [
                  {
                    qty: qtyNum,
                    ...size1Box,
                    print_spec: printSpecOut(),
                    qty_breaks: size1Breaks,
                  },
                  ...extraSizes.map(extraSizePayload),
                ],
              }),
            })
          : await fetch("/api/quote/boxes-only", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                quote_no,
                tenant_slug: tenantSlug || null,
                quote_source: quoteSource || null,
                sales_rep_slug: salesSlug || null,
                customer: boCustomer,
                qty: qtyNum,
                box: size1Box,
                print_spec: printSpecOut(),
                qty_breaks: size1Breaks,
                notes: notesOut(),
              }),
            });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) {
        setBoError(j?.message || `We couldn't save your quote (HTTP ${res.status}). Please try again.`);
        return;
      }
      if (boAnyPrinted && boArtwork.length > 0) {
        // Upload after the quote exists. Anything that fails can be re-uploaded
        // from the quote page's "Artwork for printing" card.
        await uploadArtwork(j.quote_no, boArtwork);
      }
      router.push(`/quote?quote_no=${encodeURIComponent(j.quote_no)}`);
    } catch (e: any) {
      setBoError(String(e?.message || e));
    } finally {
      setBoBusy(false);
    }
  };

  // ---------- Step handlers ----------
  const onNext = () => {
    if (!canGoNext(activeStep)) return;

    // mark this step as completed
    markStepComplete(activeStep);

    if (quoteType === "complete_pack" && activeStep === "box") {
      const ok = freezeFoamFitFromCurrentBox();
      if (!ok) return;
    }

    const nxt = nextStep(activeStep);
    setActiveStep(nxt);
  };

  const onBack = () => {
    setActiveStep(prevStep(activeStep));
  };

  // ---------- UI ----------
  const selectedMaterialIdNum = Number(materialId);

  return (
    <div className={embedded ? "relative" : "fixed inset-0 z-50"}>
      <style jsx global>{`
        /* Start Quote modal: bind tenant-brand accents onto the graphite action tokens (local override) */
        .border-\[var\(--action-primary\)\],
        .border-\[var\(--border-strong\)\] {
          border-color: color-mix(in srgb, var(--tenant-secondary) 70%, transparent) !important;
        }

        .bg-\[var\(--surface-subtle\)\] {
          background-color: color-mix(in srgb, var(--tenant-secondary) 10%, var(--surface-card)) !important;
        }

        .bg-\[var\(--action-primary\)\] {
          background-color: var(--tenant-primary) !important;
        }

        .hover\:bg-\[var\(--action-primary-hover\)\]:hover {
          background-color: color-mix(in srgb, var(--tenant-primary) 85%, white) !important;
        }

        /* Input focus */
        .focus\:border-\[var\(--action-primary\)\]:focus {
          border-color: color-mix(in srgb, var(--tenant-secondary) 70%, transparent) !important;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--tenant-secondary) 22%, transparent) !important;
        }
      `}</style>
      {/* Backdrop */}
      {!embedded && (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Modal wrapper */}
      <div
        className={
          embedded
            ? "relative mx-auto w-full max-w-5xl"
            : "relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10"
        }
      >
        <div className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-page)] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.25)]">
          {/* Header */}
          <div className="relative flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div>
              <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                START A QUOTE
              </div>
              <div className="mt-1 text-xl font-medium text-[var(--text-primary)]">
                Guided setup
              </div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                {quoteType === "complete_pack"
                  ? "Complete Pack: box + foam (bottom insert + optional top pad)."
                  : quoteType === "boxes_only"
                    ? "Boxes only: corrugated boxes, plain or printed."
                    : "Foam Insert: foam only (block + cavities)."}
              </div>
            </div>

            {!embedded && (
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
                aria-label="Close"
              >
                Close
              </button>
            )}
          </div>

          {/* Body: scrollable area in modal mode; natural flow (for iframe resize) when embedded */}
          <div className={embedded ? "relative flex flex-col" : "relative flex max-h-[calc(100vh-180px)] flex-col"}>
            <div className={embedded ? "flex-1 px-6 py-6" : "flex-1 overflow-y-auto px-6 py-6"}>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
                {/* Left rail */}
                <div className="md:pr-2">
                  <ProgressRail steps={railSteps} />

                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                    <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                      DETAILS
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Qty</div>
                        <div className="mt-1 text-sm text-[var(--text-primary)]">{qty || "—"}</div>
                      </div>
                      {quoteType === "boxes_only" ? (
                        <>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">
                              {dlMode ? "Die line" : "Box ID"}
                            </div>
                            <div className="mt-1 break-words text-sm text-[var(--text-primary)]">
                              {dlMode ? dlFile?.name : prefillPackagingSku.trim() || boxSizeText || "—"}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Style</div>
                            <div className="mt-1 text-sm text-[var(--text-primary)]">
                              {/* Step 39E */}
                              {dlMode ? (dlDisplay ? `Display, ${dlRead?.pieces.length} parts` : "Die-cut part") : styleInfo.label}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Printing</div>
                            <div className="mt-1 text-sm text-[var(--text-primary)]">
                              {printColors.length
                                ? `${printColors.length} color${printColors.length > 1 ? "s" : ""}`
                                : "No print"}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Cavities</div>
                            <div className="mt-1 text-sm text-[var(--text-primary)]">{normalizedSeed || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Material</div>
                            <div className="mt-1 text-sm text-[var(--text-primary)]">{materialText || "—"}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">Material ID</div>
                            <div className="mt-1 text-sm text-[var(--text-primary)]">{materialId || "—"}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                    <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                      WHAT HAPPENS NEXT
                    </div>
                    <div className="mt-3 space-y-3">
                      <ReassuranceItem
                        title="A real, saved quote number"
                        desc="Come back to it anytime — no account needed."
                      />
                      <ReassuranceItem
                        title="You review before anything's final"
                        desc="See layout and pricing, adjust as needed, then submit when ready."
                      />
                      <ReassuranceItem
                        title="No payment to get a quote"
                        desc="Pricing is free to see — nothing is charged here."
                      />
                    </div>
                  </div>
                </div>

                {/* Right panel (active step) */}
                <div>
                  {activeStep === "type" ? (
                    <StepCard
                      title={offeredTypes.length > 1 ? "Quote Type" : "Quantity"}
                      hint={
                        offeredTypes.length > 1
                          ? "Choose what you're quoting"
                          : `Quoting: ${QUOTE_TYPE_LABELS[offeredTypes[0]]}`
                      }
                    >
                      <div className="space-y-4">
                        {offeredTypes.length > 1 ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          {offeredTypes.includes("foam_insert") ? (
                          <ChoiceCard
                            title="Foam Insert"
                            desc="Foam only (block + cavities)"
                            selected={quoteType === "foam_insert"}
                            onClick={() => setQuoteType("foam_insert")}
                          />
                          ) : null}
                          {offeredTypes.includes("complete_pack") ? (
                          <ChoiceCard
                            title="Complete Pack"
                            desc="Box + foam (mailer/RSC + optional printing)"
                            selected={quoteType === "complete_pack"}
                            onClick={() => setQuoteType("complete_pack")}
                          />
                          ) : null}
                          {offeredTypes.includes("boxes_only") ? (
                          <ChoiceCard
                            title="Boxes only"
                            desc="Corrugated boxes, plain or printed — no foam"
                            selected={quoteType === "boxes_only"}
                            onClick={() => setQuoteType("boxes_only")}
                          />
                          ) : null}
                        </div>
                        ) : null}

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            QUANTITY
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DimInput label="Quantity" value={qty} onChange={setQty} />
                          </div>

                          {!qtyOk ? (
                            <div className="mt-3 text-sm text-[var(--attention)]">
                              Enter a quantity to continue.
                            </div>
                          ) : null}
                        </div>

                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "box" && (quoteType === "complete_pack" || quoteType === "boxes_only") ? (
                    <StepCard
                      title="Box Setup"
                      hint="Internal box size (ID) + style + printing"
                    >
                      <div className="space-y-4">
                        {/* Step 39E: price from the buyer's own die line */}
                        {quoteType === "boxes_only" ? (
                          <div
                            className={[
                              "rounded-xl border bg-[var(--surface-card)] p-4",
                              dlWanted && !dlFile ? "border-[var(--action-primary)]" : "border-[var(--border)]",
                            ].join(" ")}
                            data-dieline-upload
                          >
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              HAVE A DIE LINE FILE? (OPTIONAL)
                            </div>
                            <div className="mt-1 text-sm text-[var(--text-secondary)]">
                              Upload your die line (a DXF, or a vector PDF from your CAD program) for a box, a display or
                              any die-cut part, and we&apos;ll measure it and price it. Files are read in inches unless you pick
                              millimeters. For a display with several separate parts, pick &quot;A display&quot;: your quantity is the
                              number of displays.
                            </div>
                            {dlWanted && !dlFile ? (
                              <div className="mt-2 text-sm font-medium text-[var(--text-primary)]">
                                Upload your die line here to get your price.
                              </div>
                            ) : null}
                            <input
                              key={dlInputKey}
                              type="file"
                              accept=".dxf,.pdf"
                              aria-label="Die line file"
                              data-dieline-input
                              onChange={(e) => void pickDieline(e.target.files?.[0] || null)}
                              className="mt-3 block w-full text-sm text-[var(--text-secondary)]"
                            />
                            {dlError ? (
                              <div className="mt-2 text-sm text-[var(--attention)]" data-dieline-error>
                                {dlError}
                                {dlSpecHref ? (
                                  <>
                                    {" "}
                                    <a href={dlSpecHref} className="underline">
                                      Open the spec request form
                                    </a>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                            {dlMode && dlRead ? (
                              <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]" data-dieline-read>
                                <DielineChoices
                                  read={dlRead}
                                  units={dlUnits}
                                  as={dlAs}
                                  onUnits={setDielineUnits}
                                  onAs={setDlAs}
                                  dataPrefix="dieline"
                                />
                                {dlDisplay ? (
                                  <>
                                    <div>
                                      Your file has{" "}
                                      <span className="font-medium text-[var(--text-primary)]">{dlRead.pieces.length} parts</span>.
                                      Name them if you like, say how many of each go in one display, and pick a board for any
                                      part that needs a different one.
                                    </div>
                                    <table className="w-full text-xs" data-dieline-parts>
                                      <thead>
                                        <tr className="text-left text-[var(--text-muted)]">
                                          <th className="py-1 pr-2 font-medium">Part</th>
                                          <th className="py-1 pr-2 font-medium">Name</th>
                                          <th className="py-1 pr-2 font-medium">Blank</th>
                                          <th className="py-1 pr-2 font-medium">Per display</th>
                                          {boxGrades.length ? <th className="py-1 font-medium">Board</th> : null}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {dlRead.pieces.map((p) => (
                                          <tr key={p.piece} className="border-t border-[var(--border)]">
                                            {/* Step 39W: what the part looks like */}
                                            <td className="py-1 pr-2">
                                              <DielinePartThumb piece={p} name={dlParts[p.piece]?.label.trim() || `Part ${p.piece}`} />
                                            </td>
                                            <td className="py-1 pr-2">
                                              <input
                                                aria-label={`Part ${p.piece} name`}
                                                placeholder={`Part ${p.piece}`}
                                                value={dlParts[p.piece]?.label ?? ""}
                                                onChange={(e) =>
                                                  setDlParts((x) => ({
                                                    ...x,
                                                    [p.piece]: { ...x[p.piece], per: x[p.piece]?.per ?? "1", label: e.target.value.slice(0, 60) },
                                                  }))
                                                }
                                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                              />
                                            </td>
                                            <td className="py-1 pr-2 whitespace-nowrap">
                                              {p.length_in} × {p.width_in} in
                                            </td>
                                            <td className="py-1">
                                              <input
                                                aria-label={`Part ${p.piece} per display`}
                                                inputMode="numeric"
                                                value={dlParts[p.piece]?.per ?? "1"}
                                                onChange={(e) =>
                                                  setDlParts((x) => ({
                                                    ...x,
                                                    [p.piece]: {
                                                      ...x[p.piece],
                                                      label: x[p.piece]?.label ?? "",
                                                      per: e.target.value.replace(/[^\d]/g, "").slice(0, 5),
                                                    },
                                                  }))
                                                }
                                                className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                              />
                                            </td>
                                            {/* Step 39X: this part's own board */}
                                            {boxGrades.length ? (
                                              <td className="py-1">
                                                <select
                                                  aria-label={`Part ${p.piece} board`}
                                                  value={dlParts[p.piece]?.grade ?? ""}
                                                  onChange={(e) =>
                                                    setDlParts((x) => ({
                                                      ...x,
                                                      [p.piece]: {
                                                        label: x[p.piece]?.label ?? "",
                                                        per: x[p.piece]?.per ?? "1",
                                                        grade: e.target.value,
                                                      },
                                                    }))
                                                  }
                                                  className="max-w-[140px] rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-1.5 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                                  data-dieline-part-grade={p.piece}
                                                >
                                                  <option value="">Same as the quote</option>
                                                  {boxGrades.map((g) => (
                                                    <option key={g.id} value={String(g.id)}>
                                                      {g.name}
                                                    </option>
                                                  ))}
                                                </select>
                                              </td>
                                            ) : null}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {!dlPartsOk ? (
                                      <div className="text-xs text-[var(--attention)]">Enter at least 1 of each part per display.</div>
                                    ) : null}
                                    <div className="text-xs text-[var(--text-muted)]">
                                      Assembly and packing is added as its own line.
                                    </div>
                                  </>
                                ) : dielineDisplayBlocked(dlRead, dlAs) ? null : (
                                  <div>
                                    Read as one part:{" "}
                                    <span className="font-medium text-[var(--text-primary)]">
                                      {dlRead.length_in} × {dlRead.width_in} in blank
                                    </span>
                                    , {Math.round(dlRead.rule_in)} in of cutting and creasing rule.
                                  </div>
                                )}
                                {dielineWarnings(dlRead, dlAs).length ? (
                                  <ul className="list-disc pl-5 text-xs text-[var(--text-muted)]">
                                    {dielineWarnings(dlRead, dlAs).map((w) => (
                                      <li key={w}>{w}</li>
                                    ))}
                                  </ul>
                                ) : null}
                                <div className="text-xs text-[var(--text-muted)]">
                                  Units: {dlRead.units_label}. The shop checks the lines before your order goes ahead.
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void pickDieline(null)}
                                  className="text-xs text-[var(--text-secondary)] underline"
                                  data-dieline-remove
                                >
                                  Remove the file and enter a box size instead
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {!dlMode ? (
                        <>
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            BOX INTERNAL DIMENSIONS
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DimInput label="Length (in)" value={boxL} onChange={setBoxL} />
                            <DimInput label="Width (in)" value={boxW} onChange={setBoxW} />
                            {usesDepth ? (
                              <DimInput label={`${quoteType === "boxes_only" ? styleInfo.depthLabel : "Depth"} (in)`} value={boxD} onChange={setBoxD} />
                            ) : null}
                          </div>

                          {/* Step 39B: a mailer / tray deeper than it is wide is almost always a typo. */}
                          <BoxShapeHint
                            style={boxStyle}
                            L={toNumOrNull(boxL)}
                            W={toNumOrNull(boxW)}
                            D={toNumOrNull(boxD)}
                            onUse={(d) => {
                              setBoxL(String(d.L));
                              setBoxW(String(d.W));
                              setBoxD(String(d.D));
                            }}
                          />

                          {!boxOk ? (
                            <div className="mt-3 text-sm text-[var(--attention)]">
                              {quoteType === "boxes_only"
                                ? styleInfo.cells && boxLNum && boxWNum && boxDNum
                                  ? "Enter the partition cells across and down (at least 2 cells)."
                                  : usesDepth
                                    ? `Enter the box inside length, width and ${styleInfo.depthLabel.toLowerCase()}.`
                                    : "Enter the pad length and width."
                                : `Box L/W/D are required, and L/W must be greater than ${FIT_ALLOW_IN}" (fit allowance).`}
                            </div>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <BoxStyleCard
                            title="Mailer box"
                            desc="Tuck-top lid, no tape needed. Great for e-commerce and unboxing."
                            imgSrc="/boxes/Mailer.png"
                            imgAlt="Mailer box open"
                            selected={boxStyle === "mailer"}
                            onClick={() => setBoxStyle("mailer")}
                          />
                          <BoxStyleCard
                            title="RSC / Shipper"
                            desc="Regular slotted container. Standard tape-sealed shipping box."
                            imgSrc="/boxes/RSC.png"
                            imgAlt="RSC shipper box open"
                            selected={boxStyle === "rsc"}
                            onClick={() => setBoxStyle("rsc")}
                          />
                        </div>

                        {/* Step 27: boxes only offers every corrugated style. */}
                        {quoteType === "boxes_only" ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4" data-more-styles>
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">MORE STYLES</div>
                            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {BOX_STYLES.filter((st) => st.key !== "rsc" && st.key !== "mailer").map((st) => (
                                <button
                                  key={st.key}
                                  type="button"
                                  data-style={st.key}
                                  onClick={() => {
                                    setBoxStyle(st.key);
                                    // Stock sizes are RSCs and mailers only.
                                    setBoxChoice("custom");
                                    setPrefillPackagingSku("");
                                  }}
                                  className={[
                                    "rounded-lg border px-3 py-2 text-left transition",
                                    boxStyle === st.key
                                      ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                                      : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                  ].join(" ")}
                                >
                                  <div className="text-sm font-medium text-[var(--text-primary)]">
                                    {st.label}
                                    {boxStyle === st.key ? " ✓" : ""}
                                  </div>
                                  <div className="text-xs text-[var(--text-secondary)]">{st.desc}</div>
                                </button>
                              ))}
                            </div>
                            {styleInfo.cells ? (
                              <div className="mt-3 grid grid-cols-2 gap-3">
                                <label className="block">
                                  <div className="mb-1 text-xs text-[var(--text-muted)]">Cells across (along the length)</div>
                                  <input
                                    aria-label="Cells across"
                                    inputMode="numeric"
                                    value={cellsAcross}
                                    onChange={(e) => setCellsAcross(e.target.value.replace(/[^\d]/g, ""))}
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                  />
                                </label>
                                <label className="block">
                                  <div className="mb-1 text-xs text-[var(--text-muted)]">Cells down (along the width)</div>
                                  <input
                                    aria-label="Cells down"
                                    inputMode="numeric"
                                    value={cellsDown}
                                    onChange={(e) => setCellsDown(e.target.value.replace(/[^\d]/g, ""))}
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                  />
                                </label>
                                <div className="col-span-2 text-xs text-[var(--text-muted)]">
                                  Length and width are the inside of the box the partitions go in; height is the
                                  partition height. Partitions are quoted unprinted.
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            BOX SIZE
                          </div>

                          {!boxSizeText ? (
                            <div className="mt-2 text-xs text-[var(--text-muted)]">
                              Enter the box size above.
                            </div>
                          ) : (
                            <div className="mt-2 space-y-3">
                              <div className="text-sm text-[var(--text-secondary)]">
                                {prefillPackagingSku.trim() ? (
                                  <>
                                    Quoting stock box <span className="font-medium text-[var(--text-primary)]">{prefillPackagingSku.trim()}</span>.
                                  </>
                                ) : (
                                  <>
                                    We&apos;ll quote your size:{" "}
                                    <span className="font-medium text-[var(--text-primary)]">
                                      {boxSizeText} in
                                    </span>
                                    .
                                  </>
                                )}
                              </div>

                              {/* Step 8: stock sizes are an optional dropdown for buyers, not a
                                  list that looks like it must be picked from. Your own size is
                                  the default (boxChoice "custom"). */}
                              {stockCandidatesLoading ? (
                                <div className="text-xs text-[var(--text-muted)]">Checking stock sizes…</div>
                              ) : stockCandidates.length > 0 ? (
                                <label className="block">
                                  <div className="mb-1 text-xs text-[var(--text-muted)]">
                                    Stock sizes that fit (optional)
                                  </div>
                                  <select
                                    aria-label="Stock sizes that fit (optional)"
                                    value={boxChoice === "stock" ? prefillPackagingSku : ""}
                                    onChange={(e) => {
                                      const sku = e.target.value;
                                      if (sku) {
                                        setBoxChoice("stock");
                                        setPrefillPackagingSku(sku);
                                      } else {
                                        setBoxChoice("custom");
                                        setPrefillPackagingSku("");
                                      }
                                    }}
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                  >
                                    <option value="">Use my size ({normalizeDims3(boxLNum, boxWNum, boxDNum)} in)</option>
                                    {stockCandidates.map((c) => (
                                      <option key={c.sku} value={c.sku}>
                                        {(c.description || c.sku) +
                                          ` — inside ${c.inside_length_in} x ${c.inside_width_in} x ${c.inside_height_in} in`}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              ) : null}
                            </div>
                          )}
                        </div>

                        </>
                        ) : null}

                        {customRscBox && boxGrades.length > 0 ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              BOARD GRADE
                            </div>
                            <div className="mt-1 text-sm text-[var(--text-secondary)]">
                              The corrugated board for your custom box. Not sure? We&apos;ll recommend one.
                            </div>
                            <select
                              aria-label="Board grade"
                              value={boxGradeId}
                              onChange={(e) => setBoxGradeId(e.target.value)}
                              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                            >
                              <option value="">Not sure — recommend one</option>
                              {boxGrades.map((g) => (
                                <option key={g.id} value={String(g.id)}>
                                  {g.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            PRINTING
                          </div>
                          <div className="mt-1 text-sm text-[var(--text-secondary)]">
                            Print on the box? Choose the colors. Spot is text, lines and logos; flood covers large
                            solid areas.
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <label className="block">
                              <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                COLORS
                              </div>
                              <select
                                aria-label="Print colors"
                                value={String(printColors.length)}
                                onChange={(e) => setPrintColorCount(Number(e.target.value))}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              >
                                <option value="0">No print</option>
                                <option value="1">1 color</option>
                                <option value="2">2 colors</option>
                                <option value="3">3 colors</option>
                                <option value="4">4 colors</option>
                              </select>
                            </label>
                            {printColors.length > 0 ? (
                              <label className="block">
                                <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                  PRINTED ON
                                </div>
                                <select
                                  aria-label="Print sides"
                                  value={String(printSides)}
                                  onChange={(e) => setPrintSides(e.target.value === "2" ? 2 : 1)}
                                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                >
                                  <option value="1">Outside</option>
                                  <option value="2">Outside + inside</option>
                                </select>
                              </label>
                            ) : null}
                            {/* Step 37N: how many panels carry print (Step 39E: not for a die line part) */}
                            {printColors.length > 0 && !dlMode ? (
                              <label className="block">
                                <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                  PANELS PRINTED
                                </div>
                                <select
                                  aria-label="Panels printed"
                                  value={String(printPanels)}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setPrintPanels(v === 1 || v === 3 || v === 4 ? v : 2);
                                  }}
                                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                >
                                  <option value="1">1 panel</option>
                                  <option value="2">2 panels</option>
                                  <option value="3">3 panels</option>
                                  <option value="4">All 4 panels</option>
                                </select>
                              </label>
                            ) : null}
                          </div>
                          {printColors.length > 0 ? (
                            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                              {printColors.map((c, i) => (
                                <label key={i} className="block">
                                  <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                    COLOR {i + 1}
                                  </div>
                                  <select
                                    aria-label={`Color ${i + 1} coverage`}
                                    value={c}
                                    onChange={(e) => {
                                      const v: "spot" | "flood" = e.target.value === "flood" ? "flood" : "spot";
                                      setPrintColors((cs) => cs.map((x, j) => (j === i ? v : x)));
                                    }}
                                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                                  >
                                    <option value="spot">Spot</option>
                                    <option value="flood">Flood</option>
                                  </select>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        {quoteType === "boxes_only" && !dlMode ? (
                          <BoxSizesEditor
                            sizes={extraSizes}
                            onChange={setExtraSizes}
                            grades={boxGrades}
                            gradeDefaultLabel="Not sure — recommend one"
                            seed={() => ({
                              style: boxStyle,
                              gradeId: boxGradeId,
                              colors: [...printColors],
                              sides: printSides,
                            })}
                            size1Summary={
                              prefillPackagingSku.trim()
                                ? `stock box ${prefillPackagingSku.trim()}${qtyNum ? `, qty ${qtyNum}` : ""}`
                                : boxSizeText
                                  ? `${boxSizeText} in ${styleInfo.label}${partitionCells ? `, ${partitionCells.across} x ${partitionCells.down} cells` : ""}${qtyNum ? `, qty ${qtyNum}` : ""}`
                                  : undefined
                            }
                          />
                        ) : null}

                        {quoteType === "complete_pack" ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              FOAM FIT (AUTO)
                            </div>
                            <div className="mt-2 text-sm text-[var(--text-secondary)]">
                              Foam L/W = Box ID − {FIT_ALLOW_IN}" for fit.
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <MiniStat label="Foam Length (in)" value={fmtIn(liveFoamLen)} />
                              <MiniStat label="Foam Width (in)" value={fmtIn(liveFoamWid)} />
                              <MiniStat label="Max Depth (in)" value={fmtIn(boxDNum)} />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "foam" && quoteType === "complete_pack" ? (
                    <StepCard
                      title="Foam Structure"
                      hint="Top pad is flat; cavities apply to bottom insert only"
                    >
                      <div className="space-y-4">
                        {foamFitFrozen ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              FROZEN FOAM FIT
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <MiniStat label="Foam Length (in)" value={fmtIn(foamFitLenIn)} />
                              <MiniStat label="Foam Width (in)" value={fmtIn(foamFitWidIn)} />
                              <MiniStat label="Box Depth (in)" value={fmtIn(boxDNum)} />
                            </div>

                            {foamFitDirty ? (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-3">
                                <div className="text-sm text-[var(--attention)]">
                                  Box dimensions changed. Foam fit has not been recalculated.
                                </div>
                                <button
                                  type="button"
                                  onClick={onRecalcFoamFit}
                                  className="rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-4 py-2 text-sm font-medium text-[var(--attention)] hover:opacity-80"
                                >
                                  Recalculate foam fit
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
                            Foam fit will freeze after Box Setup.
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <ChoiceCard
                            title="Bottom + Top Pad"
                            desc={`Standard mailer setup (top pad defaults to ${DEFAULT_TOP_PAD_IN}")`}
                            selected={foamConfig === "bottom_top"}
                            onClick={() => {
                              setFoamConfig("bottom_top");
                              if (thicknessMode === "auto" && boxDNum) {
                                const top = Math.min(DEFAULT_TOP_PAD_IN, boxDNum);
                                const bottom = Math.max(0, boxDNum - top);
                                setTopThk(String(top));
                                setBottomThk(String(bottom));
                              }
                            }}
                          />
                          <ChoiceCard
                            title="Bottom Only"
                            desc="No top pad"
                            selected={foamConfig === "bottom_only"}
                            onClick={() => {
                              setFoamConfig("bottom_only");
                              if (thicknessMode === "auto" && boxDNum) {
                                setBottomThk(String(boxDNum));
                              }
                            }}
                          />
                          <ChoiceCard
                            title="Custom"
                            desc="Advanced (placeholder)"
                            selected={foamConfig === "custom"}
                            onClick={() => setFoamConfig("custom")}
                          />
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            THICKNESS (IN)
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DimInput
                              label="Bottom insert"
                              value={bottomThk}
                              onChange={onBottomThkChange}
                            />
                            <DimInput
                              label="Top pad"
                              value={foamConfig === "bottom_top" ? topThk : ""}
                              onChange={onTopThkChange}
                              disabled={foamConfig !== "bottom_top"}
                            />
                            <MiniStat
                              label="Total vs Box Depth"
                              value={(() => {
                                const b = toNumOrNull(bottomThk) || 0;
                                const t =
                                  foamConfig === "bottom_top"
                                    ? toNumOrNull(topThk) || 0
                                    : 0;
                                const total = b + t;
                                return boxDNum
                                  ? `${fmtIn(total)} / ${fmtIn(boxDNum)}`
                                  : fmtIn(total);
                              })()}
                            />
                          </div>

                          {!thicknessOk ? (
                            <div className="mt-3 text-sm text-[var(--attention)]">
                              Thickness must fit within Box Depth.
                            </div>
                          ) : null}

                          {foamConfig === "bottom_top" ? (
                            <div className="mt-3 text-sm text-[var(--text-secondary)]">
                              Cavities apply to the{" "}
                              <span className="font-medium text-[var(--text-primary)]">
                                bottom insert
                              </span>{" "}
                              only. Top pad is flat.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "specs" && quoteType === "foam_insert" ? (
                    <StepCard title="Foam Specs" hint="Block size (L × W × D)">
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                        <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                          FOAM BLOCK DIMENSIONS
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <DimInput label="Length (in)" value={insertL} onChange={setInsertL} />
                          <DimInput label="Width (in)" value={insertW} onChange={setInsertW} />
                          <DimInput
                            label={extraInsertLayers.length > 0 ? "Part 1 thickness (in)" : "Depth (in)"}
                            value={insertD}
                            onChange={setInsertD}
                          />
                        </div>
                        {!insertDimsOk ? (
                          <div className="mt-3 text-sm text-[var(--attention)]">
                            Length/Width/Depth are required for Foam Insert.
                          </div>
                        ) : null}

                        {extraInsertLayers.length > 0 ? (
                          <div className="mt-4 space-y-3">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              MORE PARTS (on top of part 1)
                            </div>
                            {extraInsertLayers.map((layer, i) => (
                              <div key={layer.id} className="flex items-end gap-3">
                                <div className="flex-1">
                                  <DimInput
                                    label={`Part ${i + 2} thickness (in)`}
                                    value={layer.thicknessIn}
                                    onChange={(v) => updateExtraInsertLayerThickness(layer.id, v)}
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeExtraInsertLayer(layer.id)}
                                  className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={addExtraInsertLayer}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                          >
                            + Add part
                          </button>
                          <div className="mt-2 text-xs text-[var(--text-muted)]">
                            Add another foam part on top of the one above (e.g. a top pad). Parts share the same length/width; the top part is packed loose and the others are glued, which you can change in the layout editor.
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                CROPPED CORNERS
                              </div>
                              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                                Chamfer-cut corners on every part above. No price change.
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setInsertCropCorners((c) => !c)}
                              className={[
                                "rounded-md border px-4 py-2 text-sm font-medium",
                                insertCropCorners
                                  ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
                                  : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                              ].join(" ")}
                            >
                              {insertCropCorners ? "Cropped" : "Square"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "cav" ? (
                    <StepCard
                      title="Cavities"
                      hint={
                        quoteType === "complete_pack" && foamConfig === "bottom_top"
                          ? "Bottom insert only"
                          : "Optional"
                      }
                    >
                      <GuidedCavityBuilder
                        value={cavitySeed}
                        onChange={setCavitySeed}
                        normalizedSeed={normalizedSeed}
                        isInvalid={cavitySeedInvalid}
                      />
                    </StepCard>
                  ) : null}

                  {activeStep === "mat" ? (
                    <StepCard
                      title="Material"
                      hint="Select from your DB, grouped by family"
                    >
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm text-[var(--text-secondary)]">
                            {materialsLoading
                              ? "Loading materials…"
                              : materialsError
                                ? "Materials unavailable"
                                : `${materials.length} materials`}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={clearMaterial}
                              className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={loadMaterials}
                              className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                            >
                              Refresh
                            </button>
                          </div>
                        </div>

                        {materialsError ? (
                          <div className="rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] p-4 text-sm text-[var(--attention)]">
                            {materialsError}
                          </div>
                        ) : null}

                        {/* Family tabs */}
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3">
                          <div className="flex flex-wrap gap-2">
                            {families.length === 0 ? (
                              <div className="text-sm text-[var(--text-muted)]">No materials.</div>
                            ) : (
                              families.map((fam) => {
                                const isActive = fam === activeFamily;
                                return (
                                  <button
                                    key={fam}
                                    type="button"
                                    onClick={() => setActiveFamily(fam)}
                                    className={[
                                      "rounded-md border px-3 py-2 text-sm",
                                      isActive
                                        ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
                                        : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                                    ].join(" ")}
                                  >
                                    {fam}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>

                        {/* Materials grid */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {materialsLoading && materials.length === 0 ? (
                            <>
                              <SkeletonCard />
                              <SkeletonCard />
                              <SkeletonCard />
                              <SkeletonCard />
                            </>
                          ) : familyMaterials.length === 0 ? (
                            <div className="col-span-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 text-sm text-[var(--text-secondary)]">
                              No materials in this family.
                            </div>
                          ) : (
                            familyMaterials.map((m) => {
                              const selected = Number.isFinite(selectedMaterialIdNum)
                                ? m.id === selectedMaterialIdNum
                                : false;

                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() => onSelectMaterial(m)}
                                  className={[
                                    "text-left rounded-xl border p-4 transition",
                                    selected
                                      ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] shadow-[0_0_0_3px_rgba(43,43,40,0.08)]"
                                      : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                  ].join(" ")}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-medium text-[var(--text-primary)]">
                                        {m.material_name}
                                      </div>
                                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                                        {familyLabel(m.material_family)}
                                      </div>
                                    </div>

                                    {m.density_lb_ft3 != null ? (
                                      <div className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                                        {fmtIn(m.density_lb_ft3)}#
                                      </div>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>

                        {/* Selected summary */}
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            SELECTED
                          </div>
                          <div className="mt-2 text-sm text-[var(--text-secondary)]">
                            <div>
                              <span className="text-[var(--text-muted)]">Material ID: </span>
                              <span className="text-[var(--text-primary)] font-medium">
                                {materialId || "-"}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="text-[var(--text-muted)]">Material: </span>
                              <span className="text-[var(--text-primary)] font-medium">
                                {materialText || "-"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "rev" && quoteType === "boxes_only" ? (
                    <StepCard title="Review" hint="Check your boxes and get your price">
                      <div className="space-y-4">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            SUMMARY
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                            <Row k="Quote type" v="Boxes only" />
                            {dlMode && dlRead ? (
                              <>
                                {/* Step 39E */}
                                <Row k="Die line" v={dlFile?.name || "Your file"} />
                                <Row
                                  k={dlDisplay ? "Display parts" : "Blank"}
                                  v={
                                    dlDisplay
                                      ? dlRead.pieces
                                          .map((p) => {
                                            const g = boxGrades.find((x) => String(x.id) === dlParts[p.piece]?.grade); // Step 39X
                                            return `${dlParts[p.piece]?.label.trim() || `Part ${p.piece}`} ×${dlParts[p.piece]?.per || "1"}${g ? ` (${g.name})` : ""}`;
                                          })
                                          .join(", ")
                                      : `${dlRead.length_in} × ${dlRead.width_in} in`
                                  }
                                />
                                {customRscBox && boxGrades.length > 0 ? (
                                  <Row
                                    k="Board grade"
                                    v={boxGrades.find((g) => String(g.id) === boxGradeId)?.name || "Recommended by the shop"}
                                  />
                                ) : null}
                              </>
                            ) : prefillPackagingSku.trim() ? (
                              <Row k="Stock box" v={prefillPackagingSku.trim()} />
                            ) : (
                              <>
                                <Row k="Box ID" v={boxSizeText || "(missing)"} />
                                <Row k="Style" v={styleInfo.label} />
                                {partitionCells ? <Row k="Cells" v={`${partitionCells.across} across x ${partitionCells.down} down`} /> : null}
                                {customRscBox && boxGrades.length > 0 ? (
                                  <Row
                                    k="Board grade"
                                    v={boxGrades.find((g) => String(g.id) === boxGradeId)?.name || "Recommended by the shop"}
                                  />
                                ) : null}
                              </>
                            )}
                            <Row
                              k="Printing"
                              v={
                                printColors.length
                                  ? `${printColors.length} color${printColors.length > 1 ? "s" : ""} (${printColors.join(", ")}), ${printSides === 2 ? "outside + inside" : "outside"}${dlMode ? "" : `, ${printPanels === 4 ? "all 4 panels" : printPanels === 1 ? "1 panel" : `${printPanels} panels`}`}`
                                  : "No print"
                              }
                            />
                            <Row k={dlDisplay ? "Displays" : "Qty"} v={qtyNum ? String(qtyNum) : "(missing)"} />
                            {extraSizes.map((s, i) => (
                              <Row
                                key={s.key}
                                k={`Size ${i + 2}`}
                                v={describeExtraSize(s, boxGrades, "Recommended by the shop")}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            {extraSizes.length > 0
                              ? "COMPARE OTHER QUANTITIES FOR SIZE 1 (OPTIONAL)"
                              : "COMPARE OTHER QUANTITIES (OPTIONAL)"}
                          </div>
                          <div className="mt-1 text-sm text-[var(--text-secondary)]">
                            Add up to 3 more quantities. Your quote will show the price at each one, and you can switch to any of them.
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-3">
                            {boBreaks.map((v, i) => (
                              <input
                                key={i}
                                value={v}
                                inputMode="numeric"
                                aria-label={`Other quantity ${i + 1}`}
                                placeholder={`e.g. ${["1000", "2500", "5000"][i]}`}
                                onChange={(e) => {
                                  const next = [...boBreaks];
                                  next[i] = e.target.value.replace(/[^\d]/g, "");
                                  setBoBreaks(next);
                                }}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            ))}
                          </div>
                        </div>

                        {boAnyPrinted ? (
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              ARTWORK (OPTIONAL)
                            </div>
                            <div className="mt-1 text-sm text-[var(--text-secondary)]">
                              Have your print art ready? Attach it here. PDF, AI or EPS print best; PNG, JPG, TIFF and SVG also work. Up to 8 MB each. You can also add it later from your quote.
                            </div>
                            <input
                              type="file"
                              multiple
                              accept={ARTWORK_ACCEPT}
                              aria-label="Artwork files"
                              onChange={(e) => {
                                const picked = Array.from(e.target.files || []);
                                const problems = picked
                                  .map((f) => artworkProblem(f.name, f.size))
                                  .filter((p): p is string => !!p);
                                setBoArtwork(picked.filter((f) => !artworkProblem(f.name, f.size)));
                                setBoArtworkNote(problems.length ? problems.join(" ") : null);
                              }}
                              className="mt-3 block w-full text-sm text-[var(--text-secondary)]"
                            />
                            {boArtwork.length > 0 ? (
                              <div className="mt-2 text-xs text-[var(--text-muted)]">
                                {boArtwork.map((f) => f.name).join(", ")}
                              </div>
                            ) : null}
                            {boArtworkNote ? (
                              <div className="mt-2 text-sm text-[var(--attention)]">{boArtworkNote}</div>
                            ) : null}
                          </div>
                        ) : null}

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            WHERE SHOULD WE SEND YOUR QUOTE?
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="block">
                              <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">NAME *</div>
                              <input
                                value={boName}
                                onChange={(e) => setBoName(e.target.value)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            </label>
                            <label className="block">
                              <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">EMAIL *</div>
                              <input
                                type="email"
                                value={boEmail}
                                onChange={(e) => setBoEmail(e.target.value)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            </label>
                            <label className="block">
                              <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">COMPANY</div>
                              <input
                                value={boCompany}
                                onChange={(e) => setBoCompany(e.target.value)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            </label>
                            <label className="block">
                              <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">PHONE</div>
                              <input
                                value={boPhone}
                                onChange={(e) => setBoPhone(e.target.value)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            NOTES
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            Anything we should know about this order?
                          </div>
                          <textarea
                            value={customerNotes}
                            onChange={(e) => setCustomerNotes(e.target.value)}
                            rows={3}
                            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)] focus:outline-none"
                            placeholder="e.g. artwork coming separately, needs to ship by a certain date..."
                          />
                        </div>

                        {boError ? (
                          <div className="rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-sm text-[var(--attention)]">
                            {boError}
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={onBack}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={onSubmitBoxesOnly}
                            disabled={!qtyOk || !boxOk || !extraSizesOk || boBusy}
                            className={[
                              "rounded-md px-6 py-3 text-sm font-medium",
                              qtyOk && boxOk && extraSizesOk && !boBusy
                                ? "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]"
                                : "cursor-not-allowed bg-[var(--action-primary)]/30 text-white/60",
                            ].join(" ")}
                          >
                            {boBusy ? (dlMode ? "Pricing your parts…" : "Pricing your boxes…") : dlMode ? "Get my price" : "Get my box price"}
                          </button>
                        </div>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "rev" && quoteType !== "boxes_only" ? (
                    <StepCard title="Review" hint="Confirm setup and launch the editor">
                      <div className="space-y-4">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            SUMMARY
                          </div>

                          <div className="mt-3 space-y-2 text-sm text-[var(--text-secondary)]">
                            <Row
                              k="Quote type"
                              v={
                                quoteType === "complete_pack"
                                  ? "Complete Pack"
                                  : "Foam Insert"
                              }
                            />

                            {quoteType === "foam_insert" ? (
                              <Row
                                k="Foam dims"
                                v={
                                  normalizeDims3(
                                    toNumOrNull(insertL),
                                    toNumOrNull(insertW),
                                    toNumOrNull(insertD),
                                  ) || "(missing)"
                                }
                              />
                            ) : (
                              <>
                                <Row
                                  k="Box ID"
                                  v={normalizeDims3(boxLNum, boxWNum, boxDNum) || "(missing)"}
                                />
                                <Row k="Style" v={styleInfo.label} />
                                {customRscBox && boxGrades.length > 0 ? (
                                  <Row
                                    k="Board grade"
                                    v={boxGrades.find((g) => String(g.id) === boxGradeId)?.name || "Recommended by the shop"}
                                  />
                                ) : null}
                                <Row
                                  k="Printing"
                                  v={
                                    printColors.length
                                      ? `${printColors.length} color${printColors.length > 1 ? "s" : ""} (${printColors.join(", ")}), ${printSides === 2 ? "outside + inside" : "outside"}, ${printPanels === 4 ? "all 4 panels" : printPanels === 1 ? "1 panel" : `${printPanels} panels`}`
                                      : "No print"
                                  }
                                />
                                <Row
                                  k="Foam fit (L/W)"
                                  v={
                                    foamFitLenIn && foamFitWidIn
                                      ? `${fmtIn(foamFitLenIn)} x ${fmtIn(foamFitWidIn)}`
                                      : "(missing)"
                                  }
                                />
                                <Row
                                  k="Foam config"
                                  v={
                                    foamConfig === "bottom_top"
                                      ? "Bottom + Top Pad"
                                      : foamConfig === "bottom_only"
                                        ? "Bottom Only"
                                        : "Custom"
                                  }
                                />
                                <Row
                                  k="Bottom thickness"
                                  v={fmtIn(toNumOrNull(bottomThk)) || "(missing)"}
                                />
                                {foamConfig === "bottom_top" ? (
                                  <Row k="Top pad" v={fmtIn(toNumOrNull(topThk)) || String(DEFAULT_TOP_PAD_IN)} />
                                ) : null}
                              </>
                            )}

                            <Row k="Qty" v={qtyNum ? String(qtyNum) : "(missing)"} />

                            <Row k="Material" v={materialText || "-"} />
                            <Row k="Material ID" v={materialId || "-"} />
                            <Row
                              k="Cavity seed"
                              v={normalizedSeed || "-"}
                            />
                          </div>
                        </div>

                        {/* Step 24: foam "Price by quantity" */}
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            COMPARE OTHER QUANTITIES (OPTIONAL)
                          </div>
                          <div className="mt-1 text-sm text-[var(--text-secondary)]">
                            Add up to 3 more quantities. Your quote will show the price at each one, and you can switch to any of them.
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-3">
                            {boBreaks.map((v, i) => (
                              <input
                                key={i}
                                value={v}
                                inputMode="numeric"
                                aria-label={`Other quantity ${i + 1}`}
                                placeholder={`e.g. ${["250", "500", "1000"][i]}`}
                                onChange={(e) => {
                                  const next = [...boBreaks];
                                  next[i] = e.target.value.replace(/[^\d]/g, "");
                                  setBoBreaks(next);
                                }}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            NOTES
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            Anything we should know about this order?
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                            This will appear on the final quote you see — packing needs, timing, anything else worth flagging.
                          </div>
                          <textarea
                            value={customerNotes}
                            onChange={(e) => setCustomerNotes(e.target.value)}
                            rows={3}
                            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--surface-page)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)] focus:outline-none"
                            placeholder="e.g. fragile, needs to ship by a certain date, special packaging request..."
                          />
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={onBack}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                          >
                            Back
                          </button>

                          <button
                            type="button"
                            onClick={close}
                            className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                          >
                            Cancel
                          </button>

                          <button
                            type="button"
                            onClick={onLaunchEditor}
                            disabled={!qtyOk || (quoteType === "foam_insert" ? !insertDimsOk : (!boxOk || !foamFitOk || !thicknessOk))}
                            className={[
                              "rounded-md px-6 py-3 text-sm font-medium",
                              qtyOk && (quoteType === "foam_insert" ? insertDimsOk : (boxOk && foamFitOk && thicknessOk))
                                ? "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]"
                                : "cursor-not-allowed bg-[var(--action-primary)]/30 text-white/60",
                            ].join(" ")}
                          >
                            Launch Layout Editor
                          </button>
                        </div>
                      </div>
                    </StepCard>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Sticky footer nav (B) */}
            {activeStep !== "rev" ? (
              <div className="relative border-t border-[var(--border)] bg-[var(--surface-page)]/90 px-6 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={onBack}
                    disabled={activeStep === "type"}
                    className={[
                      "rounded-md border px-4 py-2 text-sm",
                      activeStep === "type"
                        ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-faint)]"
                        : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                    ].join(" ")}
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!canGoNext(activeStep)}
                    className={[
                      "rounded-md px-4 py-2 text-sm font-medium",
                      canGoNext(activeStep)
                        ? "bg-[var(--action-primary)] text-white hover:bg-[var(--action-primary-hover)]"
                        : "cursor-not-allowed bg-[var(--action-primary)]/30 text-white/70",
                    ].join(" ")}
                  >
                    Next
                  </button>
                </div>

                {cavitySeedInvalid ? (
                  <div className="mt-2 text-sm text-[var(--attention)]">
                    Cavity seed format invalid. Use <b>3x2x1</b> (rect) or <b>Ø2.5x1</b> (round). Separate multiple with semicolons.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Small UI helpers ---------- */

function ChoiceCard({
  title,
  desc,
  selected,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left rounded-xl border p-4 transition",
        selected
          ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] shadow-[0_0_0_3px_rgba(43,43,40,0.08)]"
          : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
      ].join(" ")}
    >
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">{desc}</div>
    </button>
  );
}

function ReassuranceItem({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[11px] text-[var(--text-primary)]">
        ✓
      </div>
      <div>
        <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
        <div className="text-xs text-[var(--text-muted)]">{desc}</div>
      </div>
    </div>
  );
}

function DimInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        disabled={!!disabled}
        className={[
          "w-full rounded-md border px-3 py-3 text-sm outline-none",
          disabled
            ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-faint)]"
            : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-primary)] focus:border-[var(--action-primary)]",
        ].join(" ")}
        placeholder={disabled ? "-" : "0"}
      />
    </div>
  );
}

function MiniField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] p-3">
      <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{value || "-"}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] py-2 last:border-b-0">
      <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
        {k}
      </div>
      <div className="text-sm text-[var(--text-primary)] text-right">{v}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
      <div className="h-4 w-2/3 rounded bg-[var(--surface-subtle)]" />
      <div className="mt-2 h-3 w-1/2 rounded bg-[var(--surface-subtle)]" />
      <div className="mt-3 h-7 w-16 rounded bg-[var(--surface-subtle)]" />
    </div>
  );
}

function GuidedCavityBuilder({
  value,
  onChange,
  normalizedSeed,
  isInvalid,
}: {
  value: string;
  onChange: (v: string) => void;
  normalizedSeed: string;
  isInvalid: boolean;
}) {
  const [shape, setShape] = React.useState<"rect" | "circle">("rect");
  const [L, setL] = React.useState("");
  const [W, setW] = React.useState("");
  const [D, setD] = React.useState("");
  const [dia, setDia] = React.useState("");
  const [dep, setDep] = React.useState("");
  const [addError, setAddError] = React.useState("");

  const tokens = normalizedSeed
    ? normalizedSeed.split(";").filter(Boolean)
    : [];

  const removeToken = (idx: number) => {
    const next = tokens.filter((_, i) => i !== idx).join(";");
    onChange(next);
  };

  const handleAdd = () => {
    setAddError("");
    if (shape === "rect") {
      const lv = Number(L), wv = Number(W), dv = Number(D);
      if (!(lv > 0 && wv > 0 && dv > 0)) {
        setAddError("L, W, and D must all be positive numbers.");
        return;
      }
      const token = `${lv}x${wv}x${dv}`;
      const next = tokens.length > 0 ? `${tokens.join(";")};${token}` : token;
      onChange(next);
      setL(""); setW(""); setD("");
    } else {
      const diaV = Number(dia), depV = Number(dep);
      if (!(diaV > 0 && depV > 0)) {
        setAddError("Diameter and Depth must both be positive numbers.");
        return;
      }
      const token = `Ø${diaV}x${depV}`;
      const next = tokens.length > 0 ? `${tokens.join(";")};${token}` : token;
      onChange(next);
      setDia(""); setDep("");
    }
  };

  const inputCls =
    "flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]";

  return (
    <div className="space-y-4">
      {/* Cavity list */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
        <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
          CAVITY LIST
        </div>
        {tokens.length === 0 ? (
          <p className="mt-3 text-sm italic text-[var(--text-muted)]">
            No cavities yet — add one below, or skip to let the editor start blank.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {tokens.map((tok, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
              >
                <span className="font-mono">{tok}</span>
                <button
                  type="button"
                  aria-label={`Remove cavity ${tok}`}
                  onClick={() => removeToken(i)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add a cavity */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
        <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
          ADD A CAVITY
        </div>

        {/* Shape toggle */}
        <div className="mt-3 flex gap-2">
          {(["rect", "circle"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setShape(s); setAddError(""); }}
              className={[
                "rounded-md border px-4 py-2 text-sm font-medium",
                shape === s
                  ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
                  : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
              ].join(" ")}
            >
              {s === "rect" ? "Rectangular" : "Round"}
            </button>
          ))}
        </div>

        {/* Dimension inputs */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {shape === "rect" ? (
            <>
              <div className="flex min-w-[72px] flex-1 flex-col gap-1">
                <label className="text-xs font-medium tracking-widest text-[var(--text-muted)]">L (in)</label>
                <input value={L} onChange={(e) => setL(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
              </div>
              <div className="flex min-w-[72px] flex-1 flex-col gap-1">
                <label className="text-xs font-medium tracking-widest text-[var(--text-muted)]">W (in)</label>
                <input value={W} onChange={(e) => setW(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
              </div>
              <div className="flex min-w-[72px] flex-1 flex-col gap-1">
                <label className="text-xs font-medium tracking-widest text-[var(--text-muted)]">D (in)</label>
                <input value={D} onChange={(e) => setD(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
              </div>
            </>
          ) : (
            <>
              <div className="flex min-w-[100px] flex-1 flex-col gap-1">
                <label className="text-xs font-medium tracking-widest text-[var(--text-muted)]">Diameter (in)</label>
                <input value={dia} onChange={(e) => setDia(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
              </div>
              <div className="flex min-w-[100px] flex-1 flex-col gap-1">
                <label className="text-xs font-medium tracking-widest text-[var(--text-muted)]">Depth (in)</label>
                <input value={dep} onChange={(e) => setDep(e.target.value)} inputMode="decimal" className={inputCls} placeholder="0" />
              </div>
            </>
          )}
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-md bg-[var(--action-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)]"
          >
            + Add
          </button>
        </div>

        {addError ? (
          <div className="mt-2 text-xs text-[var(--attention)]">{addError}</div>
        ) : null}

        <div className="mt-2 text-xs text-[var(--text-faint)]">
          {shape === "rect"
            ? "Creates a rectangular pocket — enter length, width, and depth."
            : "Creates a round pocket — enter diameter and depth."}
        </div>
        <div className="mt-2 text-xs text-[var(--text-muted)]">
          Fine-tune cavity placement in the layout editor.
        </div>
      </div>

      {/* Raw seed string */}
      {tokens.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-3 text-xs">
          <span className="text-[var(--text-muted)]">Seed string: </span>
          <span className="font-mono text-[var(--text-secondary)]">{normalizedSeed}</span>
        </div>
      ) : null}
    </div>
  );
}

function BoxStyleCard({
  title,
  desc,
  imgSrc,
  imgAlt,
  selected,
  onClick,
}: {
  title: string;
  desc: string;
  imgSrc: string;
  imgAlt: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left rounded-xl border p-4 transition",
        selected
          ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] shadow-[0_0_0_3px_rgba(43,43,40,0.08)]"
          : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
      ].join(" ")}
    >
      <div
        className="overflow-hidden rounded-lg flex items-center justify-center"
        style={{ backgroundColor: "#F7F0E4", height: "120px" }}
      >
        <img
          src={imgSrc}
          alt={imgAlt}
          style={{ maxHeight: "108px", maxWidth: "90%", objectFit: "contain" }}
        />
      </div>
      <div className="mt-3 text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">{desc}</div>
      {selected ? (
        <div className="mt-2 inline-block rounded-full border border-[var(--border-strong)] bg-[var(--surface-card)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)]">
          ✓ Selected
        </div>
      ) : null}
    </button>
  );
}