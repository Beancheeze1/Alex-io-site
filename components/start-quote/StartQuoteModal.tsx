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

type QuoteType = "foam_insert" | "complete_pack";
type BoxStyle = "mailer" | "rsc";
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildQuoteNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  return `Q-AI-${y}${m}${day}-${hh}${mm}${ss}`;
}

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

export default function StartQuoteModal() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---------- Parse prefill data from chatbot ----------
  const prefillData = React.useMemo(() => {
    const prefillRaw = searchParams.get("prefill");
    if (!prefillRaw) return null;
    
    try {
      const decoded = decodeURIComponent(prefillRaw);
      const parsed = JSON.parse(decoded);
      return parsed;
    } catch (err) {
      console.warn("Failed to parse prefill data:", err);
      return null;
    }
  }, [searchParams]);

  // ---------- Close behavior ----------
  const close = React.useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/admin");
  }, [router]);

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

  // ---------- State ----------
  const [activeStep, setActiveStep] = React.useState<
    "type" | "box" | "foam" | "specs" | "cav" | "mat" | "rev"
  >(seededIsCompletePack ? "box" : "type");

  const [completedSteps, setCompletedSteps] = React.useState<Set<string>>(
    () => seededIsCompletePack ? new Set<string>(["type"]) : new Set<string>(),
  );

  const [quoteType, setQuoteType] = React.useState<QuoteType>(
    seededIsCompletePack ? "complete_pack" : "foam_insert",
  );

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
    (searchParams.get("box_style") || "").toLowerCase() === "rsc" ? "rsc" : "mailer",
  );
  const [printed, setPrinted] = React.useState<boolean>(
    (searchParams.get("printed") || "").trim() === "1" ||
      (searchParams.get("box_printed") || "").trim() === "1",
  );
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
  const [boxChoice, setBoxChoice] = React.useState<"" | "stock" | "custom">("");

  // ---------- Seed all state from prefillData once it resolves ----------
  // prefillData comes from useMemo(searchParams) which may be null on first render
  // in Next.js App Router. This effect fires as soon as it's available.
  const prefillSeededRef = React.useRef(false);
  React.useEffect(() => {
    if (!prefillData || prefillSeededRef.current) return;
    prefillSeededRef.current = true;

    // Qty
    if (prefillData.qty) setQty(String(prefillData.qty));

    // Material
    if (prefillData.material?.text) setMaterialText(prefillData.material.text);
    if (prefillData.material?.id != null) setMaterialId(String(prefillData.material.id));

    // Cavity seed (multi-cavity string)
    if (prefillData.cavities) setCavitySeed(prefillData.cavities);

    // Printing preference
    if (prefillData.printed === true) setPrinted(true);

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
    if (quoteType !== "complete_pack") {
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
    const stackDepth = bottomThkNum + topThkNum;

    const footprintL = Math.max(0, boxLNum - FIT_ALLOW_IN);
    const footprintW = Math.max(0, boxWNum - FIT_ALLOW_IN);

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
          }),
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;

        if (json?.ok) {
          const list = boxStyle === "rsc" ? json.candidatesRsc : json.candidatesMailer;
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

  const boxOk =
    quoteType === "complete_pack"
      ? !!(
          toNumOrNull(boxL) &&
          toNumOrNull(boxW) &&
          toNumOrNull(boxD) &&
          toNumOrNull(boxL)! > FIT_ALLOW_IN &&
          toNumOrNull(boxW)! > FIT_ALLOW_IN
        )
      : true;

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
        "Quote Type",
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
  const onLaunchEditor = () => {
    if (!qtyOk) return;

    if (quoteType === "foam_insert") {
      if (!insertDimsOk) return;
    } else {
      if (!boxOk || !foamFitOk || !thicknessOk) return;
    }

    // If prefill supplied a Q-DEMO- quote_no (from the landing page demo flow),
    // use it so the Apply route can find the already-created DB row.
    // Otherwise generate a fresh Q-AI- number as normal.
    const prefillQuoteNo =
      typeof prefillData?.quoteNo === "string" && prefillData.quoteNo.startsWith("Q-DEMO-")
        ? prefillData.quoteNo.trim()
        : null;
    const quote_no = prefillQuoteNo ?? buildQuoteNo();

    const p = new URLSearchParams();

    const salesSlugFromUrl = (searchParams.get("sales_rep_slug") || searchParams.get("sales") || searchParams.get("rep") || "").trim();
    if (salesSlugFromUrl) p.set("sales_rep_slug", salesSlugFromUrl);

    const tenantFromUrl = (searchParams.get("tenant") || searchParams.get("t") || "").trim();
    if (tenantFromUrl) p.set("tenant", tenantFromUrl);

    // Thread demo flag through to the editor URL so the editor knows to use
    // /api/quote/layout/apply without auth.
    const demoFromUrl = (searchParams.get("demo") || "").trim();
    if (demoFromUrl === "1" || prefillQuoteNo) p.set("demo", "1");

    p.set("quote_no", quote_no);

    if (qtyNum) p.set("qty", String(qtyNum));


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
      extraInsertLayers.forEach((layer, i) => {
        p.append("layer_thicknesses", String(toNumOrNull(layer.thicknessIn) || 1));
        p.append("layer_label", `Layer ${i + 2}`);
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
      p.set("printed", printed ? "1" : "0");
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
            printed: printed ? 1 : 0,
          }),
        }).catch(() => null);
      }
    }

    // Internal hints (fit tips, box suggestions) are stored in internalHints, not notes.
    if (customerNotes.trim()) p.set("notes", customerNotes.trim());

    router.push(`/quote/layout?${p.toString()}`);
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
    <div className="fixed inset-0 z-50">
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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Modal wrapper */}
      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
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
                  : "Foam Insert: foam only (block + cavities)."}
              </div>
            </div>

            <button
              type="button"
              onClick={close}
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              aria-label="Close"
            >
              Close
            </button>
          </div>

          {/* Body: make scrollable area */}
          <div className="relative flex max-h-[calc(100vh-180px)] flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-6">
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
                    <StepCard title="Quote Type" hint="Choose what you're quoting">
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <ChoiceCard
                            title="Foam Insert"
                            desc="Foam only (block + cavities)"
                            selected={quoteType === "foam_insert"}
                            onClick={() => setQuoteType("foam_insert")}
                          />
                          <ChoiceCard
                            title="Complete Pack"
                            desc="Box + foam (mailer/RSC + optional printing)"
                            selected={quoteType === "complete_pack"}
                            onClick={() => setQuoteType("complete_pack")}
                          />
                        </div>

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

                  {activeStep === "box" && quoteType === "complete_pack" ? (
                    <StepCard
                      title="Box Setup"
                      hint="Internal box size (ID) + style + printing"
                    >
                      <div className="space-y-4">
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            BOX INTERNAL DIMENSIONS
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DimInput label="Length (in)" value={boxL} onChange={setBoxL} />
                            <DimInput label="Width (in)" value={boxW} onChange={setBoxW} />
                            <DimInput label="Depth (in)" value={boxD} onChange={setBoxD} />
                          </div>

                          {!boxOk ? (
                            <div className="mt-3 text-sm text-[var(--attention)]">
                              Box L/W/D are required, and L/W must be greater than {FIT_ALLOW_IN}" (fit allowance).
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

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            BOX SELECTION
                          </div>

                          {!boxLNum || !boxWNum || !boxDNum ? (
                            <div className="mt-2 text-xs text-[var(--text-muted)]">
                              Enter box L/W/D above to see matching stock cartons.
                            </div>
                          ) : stockCandidatesLoading ? (
                            <div className="mt-2 text-sm text-[var(--text-secondary)]">
                              Looking up matching cartons…
                            </div>
                          ) : (
                            <div className="mt-2 space-y-2">
                              {stockCandidates.length === 0 ? (
                                <div className="text-xs text-[var(--text-muted)]">
                                  No close stock matches found for these dimensions.
                                </div>
                              ) : (
                                stockCandidates.map((c) => {
                                  const selected = boxChoice === "stock" && prefillPackagingSku === c.sku;
                                  return (
                                    <button
                                      key={c.sku}
                                      type="button"
                                      onClick={() => {
                                        setBoxChoice("stock");
                                        setPrefillPackagingSku(c.sku);
                                      }}
                                      className={[
                                        "w-full rounded-md border px-3 py-2 text-left text-sm",
                                        selected
                                          ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                                          : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                      ].join(" ")}
                                    >
                                      <div className="font-medium text-[var(--text-primary)]">
                                        {c.description || c.sku}
                                      </div>
                                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                                        Inside {c.inside_length_in} x {c.inside_width_in} x {c.inside_height_in} in · {c.sku}
                                      </div>
                                    </button>
                                  );
                                })
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setBoxChoice("custom");
                                  setPrefillPackagingSku("");
                                }}
                                className={[
                                  "w-full rounded-md border px-3 py-2 text-left text-sm",
                                  boxChoice === "custom"
                                    ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                                    : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                ].join(" ")}
                              >
                                <div className="font-medium text-[var(--text-primary)]">
                                  Use my own size instead
                                </div>
                                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                                  Skip stock matching — use the box dimensions entered above as-is.
                                </div>
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                PRINTED BOX
                              </div>
                              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                                If printed, add a $50 upcharge (shown in review).
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setPrinted((p) => !p)}
                              className={[
                                "rounded-md border px-4 py-2 text-sm font-medium",
                                printed
                                  ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
                                  : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                              ].join(" ")}
                            >
                              {printed ? "Printed  +$50" : "Not printed"}
                            </button>
                          </div>
                        </div>

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
                            label={extraInsertLayers.length > 0 ? "Layer 1 thickness (in)" : "Depth (in)"}
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
                              ADDITIONAL LAYERS (bonded on top of Layer 1)
                            </div>
                            {extraInsertLayers.map((layer, i) => (
                              <div key={layer.id} className="flex items-end gap-3">
                                <div className="flex-1">
                                  <DimInput
                                    label={`Layer ${i + 2} thickness (in)`}
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
                            + Add layer
                          </button>
                          <div className="mt-2 text-xs text-[var(--text-muted)]">
                            Add a bonded foam layer (e.g. a top pad) on top of the block above. Layers share the same length/width and can be fine-tuned further in the layout editor.
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

                  {activeStep === "rev" ? (
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
                                <Row k="Style" v={boxStyle.toUpperCase()} />
                                <Row k="Printed" v={printed ? "Yes (+$50)" : "No"} />
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