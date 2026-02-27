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

type QuoteType = "foam_insert" | "complete_pack";
type BoxStyle = "mailer" | "rsc";
type FoamConfig = "bottom_top" | "bottom_only" | "custom";

const FIT_ALLOW_IN = 0.125;
const DEFAULT_TOP_PAD_IN = 1.0;

type MaterialRow = {
  id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean | null;
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
 * Parse a single cavity seed.
 *
 * Supports:
 *  - Rect:   3x2x1
 *  - Circle: 2.5x1    (DIAMETER x DEPTH)  -> will be normalized to "Ø2.5x1"
 *
 * Returns:
 *  - normalized string for URL param + review display
 *  - or null if invalid
 */
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
  >("type");

  const [completedSteps, setCompletedSteps] = React.useState<Set<string>>(
    () => new Set<string>(),
  );

  const [quoteType, setQuoteType] = React.useState<QuoteType>(
    seededIsCompletePack ? "complete_pack" : "foam_insert",
  );

  // Common - prefer prefill data over URL params
  const [qty, setQty] = React.useState<string>(
    prefillData?.qty || searchParams.get("qty") || "",
  );
  const [name, setName] = React.useState<string>(
    searchParams.get("customer_name") || "",
  );
  const [email, setEmail] = React.useState<string>(
    searchParams.get("customer_email") || "",
  );
  const [company, setCompany] = React.useState<string>(
    searchParams.get("customer_company") || "",
  );
  const [phone, setPhone] = React.useState<string>(
    searchParams.get("customer_phone") || "",
  );

  // Material selection - prefer prefill data
  const [materialText, setMaterialText] = React.useState<string>(
    prefillData?.material?.text ||
    searchParams.get("material_text") ||
    searchParams.get("material") ||
    "",
  );
  const [materialId, setMaterialId] = React.useState<string>(
    searchParams.get("material_id") || "",
  );

  // Cavities seed - prefer prefill data
  const [cavitySeed, setCavitySeed] = React.useState<string>(
    prefillData?.firstCavity ||
    searchParams.get("cavity") ||
    "",
  );

  // Foam Insert specs
  const [insertL, setInsertL] = React.useState<string>("");
  const [insertW, setInsertW] = React.useState<string>("");
  const [insertD, setInsertD] = React.useState<string>("");

// Seed insert dims if provided (from URL params OR prefill data)
  React.useEffect(() => {
    // Check prefill data first
    if (prefillData?.outside?.l && prefillData?.outside?.w && prefillData?.outside?.h) {
      if (!seededIsCompletePack) {
        setInsertL(String(prefillData.outside.l));
        setInsertW(String(prefillData.outside.w));
        setInsertD(String(prefillData.outside.h));
      }
      return;
    }
    
    // Fall back to URL param
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
    ((searchParams.get("box_style") || "mailer").toLowerCase() as BoxStyle) ===
      "rsc"
      ? "rsc"
      : "mailer",
  );
  const [printed, setPrinted] = React.useState<boolean>(
    (searchParams.get("printed") || "").trim() === "1" ||
      (searchParams.get("box_printed") || "").trim() === "1",
  );

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
      setThicknessMode("auto");
      setBottomThk("");
      setTopThk(String(DEFAULT_TOP_PAD_IN));
      setFoamConfig("bottom_top");
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
      ? !!(toNumOrNull(insertL) && toNumOrNull(insertW) && toNumOrNull(insertD))
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
    const p = parseSeedCavity(cavitySeed);
    return p?.normalized || "";
  }, [cavitySeed]);

  const cavitySeedInvalid =
    cavitySeed.trim().length > 0 && !parseSeedCavity(cavitySeed);

  // ---------- Launch (seed editor URL) ----------
  const onLaunchEditor = () => {
    if (!qtyOk) return;

    if (quoteType === "foam_insert") {
      if (!insertDimsOk) return;
    } else {
      if (!boxOk || !foamFitOk || !thicknessOk) return;
    }

    const quote_no = buildQuoteNo();
    const p = new URLSearchParams();

    const salesSlugFromUrl = (searchParams.get("sales") || searchParams.get("rep") || "").trim();
    if (salesSlugFromUrl) p.set("sales_rep_slug", salesSlugFromUrl);

    const tenantFromUrl = (searchParams.get("tenant") || searchParams.get("t") || "").trim();
    if (tenantFromUrl) p.set("tenant", tenantFromUrl);

    p.set("quote_no", quote_no);

    if (qtyNum) p.set("qty", String(qtyNum));

    if (name.trim()) p.set("customer_name", name.trim());
    if (email.trim()) p.set("customer_email", email.trim());
    if (company.trim()) p.set("customer_company", company.trim());
    if (phone.trim()) p.set("customer_phone", phone.trim());

    const matIdNum = Number(materialId);
    const hasMaterialId = Number.isFinite(matIdNum) && matIdNum > 0;
    if (hasMaterialId) {
      p.set("material_id", String(matIdNum));
      p.set("material_mode", "known");
    }
    if (materialText.trim()) p.set("material_text", materialText.trim());

    const seedCav = parseSeedCavity(cavitySeed)?.normalized || "";

    if (quoteType === "foam_insert") {
      const L = toNumOrNull(insertL);
      const W = toNumOrNull(insertW);
      const D = toNumOrNull(insertD);
      const dims = normalizeDims3(L, W, D);
      if (dims) p.set("dims", dims);

      p.set("layer_count", "1");
      p.append("layer_thicknesses", String(D || 1));
      p.append("layer_label", "Layer 1");
      p.set("layer_cavity_layer_index", "1");
      p.set("activeLayer", "1");
      p.set("active_layer", "1");

      if (seedCav) p.set("cavity", seedCav);
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

      if (seedCav) p.set("cavity", seedCav);

      if (boxLNum) p.set("box_l", String(boxLNum));
      if (boxWNum) p.set("box_w", String(boxWNum));
      if (boxDNum) p.set("box_d", String(boxDNum));
      p.set("box_style", boxStyle);
      p.set("printed", printed ? "1" : "0");
      p.set("pack_type", "complete_pack");
      p.set("foam_config", foamConfig);
      p.set("fit_allow_in", String(FIT_ALLOW_IN));
    }

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
        /* Start Quote modal: bind leftover sky accents to tenant vars (local override) */
        .text-sky-300\/80,
        .text-sky-200,
        .text-sky-100,
        .text-sky-50 {
          color: color-mix(in srgb, var(--tenant-secondary) 78%, white) !important;
        }

        .border-sky-400\/60,
        .border-sky-400\/70,
        .border-sky-500\/60,
        .border-sky-500\/70,
        .border-sky-500\/80 {
          border-color: color-mix(in srgb, var(--tenant-secondary) 70%, transparent) !important;
        }

        .bg-sky-500\/10,
        .bg-sky-500\/15,
        .bg-sky-500\/20,
        .bg-sky-500\/30 {
          background-color: color-mix(in srgb, var(--tenant-secondary) 16%, transparent) !important;
        }

        .bg-sky-500\/80,
        .bg-sky-500 {
          background-color: var(--tenant-primary) !important;
        }

        .hover\:bg-sky-500:hover,
        .hover\:bg-sky-500\/10:hover {
          background-color: color-mix(in srgb, var(--tenant-primary) 85%, white) !important;
        }

        /* Input focus */
        .focus\:border-sky-400\/60:focus {
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
        <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0B1020] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]">
          {/* Grid background (subtle, matches app vibe) */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.18]">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
                backgroundPosition: "0 0",
              }}
            />
          </div>

          {/* Header */}
          <div className="relative flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div>
              <div className="text-xs font-semibold tracking-widest text-sky-300/80">
                START A QUOTE
              </div>
              <div className="mt-1 text-xl font-semibold text-white">
                Guided setup
              </div>
              <div className="mt-1 text-sm text-slate-300">
                {quoteType === "complete_pack"
                  ? "Complete Pack: box + foam (bottom insert + optional top pad)."
                  : "Foam Insert: foam only (block + cavities)."}
              </div>
            </div>

            <button
              type="button"
              onClick={close}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
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

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="text-xs font-semibold tracking-widest text-slate-400">
                      BASICS
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <MiniField label="Qty (required)">
                        <input
                          value={qty}
                          onChange={(e) => setQty(e.target.value)}
                          inputMode="numeric"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/60"
                          placeholder="0"
                        />
                        {!qtyOk ? (
                          <div className="mt-1 text-xs text-amber-200/90">
                            Required
                          </div>
                        ) : null}
                      </MiniField>

                      <MiniField label="Cavity seed (LxWxD or DiaxDepth)">
                        <input
                          value={cavitySeed}
                          onChange={(e) => setCavitySeed(e.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/60"
                          placeholder='e.g. 3x2x1 or 2.5x1'
                        />
                        {cavitySeed.trim() ? (
                          <div className="mt-1 text-xs text-slate-400">
                            Normalized:{" "}
                            <span className="text-slate-200">
                              {normalizedSeed || "—"}
                            </span>
                          </div>
                        ) : null}
                      </MiniField>

                      <MiniField label="Material text">
                        <input
                          value={materialText}
                          onChange={(e) => setMaterialText(e.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/60"
                          placeholder="(auto when selected)"
                        />
                      </MiniField>

                      <MiniField label="Material ID">
                        <input
                          value={materialId}
                          onChange={(e) => setMaterialId(e.target.value)}
                          inputMode="numeric"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/60"
                          placeholder="(auto when selected)"
                        />
                      </MiniField>
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

                        {/* Customer info (D) */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            CUSTOMER
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <TextInput label="Name" value={name} onChange={setName} />
                            <TextInput label="Email" value={email} onChange={setEmail} />
                            <TextInput label="Company" value={company} onChange={setCompany} />
                            <TextInput label="Phone" value={phone} onChange={setPhone} />
                          </div>
                          <div className="mt-3 text-sm text-slate-300">
                            This info will carry into the editor URL (for future recommendations).
                          </div>
                        </div>

                        {/* Qty in-flow (required) */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            QUANTITY (REQUIRED)
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <DimInput label="Qty" value={qty} onChange={setQty} />
                            <MiniStat label="Status" value={qtyOk ? "OK" : "Required"} />
                          </div>
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
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            BOX INTERNAL DIMENSIONS
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DimInput label="Length (in)" value={boxL} onChange={setBoxL} />
                            <DimInput label="Width (in)" value={boxW} onChange={setBoxW} />
                            <DimInput label="Depth (in)" value={boxD} onChange={setBoxD} />
                          </div>

                          {!boxOk ? (
                            <div className="mt-3 text-sm text-amber-200/90">
                              Box L/W/D are required, and L/W must be greater than {FIT_ALLOW_IN}" (fit allowance).
                            </div>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <ChoiceCard
                            title="Mailer"
                            desc="Most common (supports bottom+top pad workflow)"
                            selected={boxStyle === "mailer"}
                            onClick={() => setBoxStyle("mailer")}
                          />
                          <ChoiceCard
                            title="RSC"
                            desc="Regular slotted container"
                            selected={boxStyle === "rsc"}
                            onClick={() => setBoxStyle("rsc")}
                          />
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold tracking-widest text-slate-400">
                                PRINTED BOX
                              </div>
                              <div className="mt-1 text-sm text-slate-200">
                                If printed, add a $50 upcharge (shown in review).
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setPrinted((p) => !p)}
                              className={[
                                "rounded-xl border px-4 py-2 text-sm font-semibold",
                                printed
                                  ? "border-sky-400/60 bg-sky-500/20 text-white"
                                  : "border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
                              ].join(" ")}
                            >
                              {printed ? "Printed  +$50" : "Not printed"}
                            </button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            FOAM FIT (AUTO)
                          </div>
                          <div className="mt-2 text-sm text-slate-200">
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
                          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                            <div className="text-xs font-semibold tracking-widest text-slate-400">
                              FROZEN FOAM FIT
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <MiniStat label="Foam Length (in)" value={fmtIn(foamFitLenIn)} />
                              <MiniStat label="Foam Width (in)" value={fmtIn(foamFitWidIn)} />
                              <MiniStat label="Box Depth (in)" value={fmtIn(boxDNum)} />
                            </div>

                            {foamFitDirty ? (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3">
                                <div className="text-sm text-amber-200/90">
                                  Box dimensions changed. Foam fit has not been recalculated.
                                </div>
                                <button
                                  type="button"
                                  onClick={onRecalcFoamFit}
                                  className="rounded-xl border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/15"
                                >
                                  Recalculate foam fit
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-200">
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

                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
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
                            <div className="mt-3 text-sm text-amber-200/90">
                              Thickness must fit within Box Depth.
                            </div>
                          ) : null}

                          {foamConfig === "bottom_top" ? (
                            <div className="mt-3 text-sm text-slate-300">
                              Cavities apply to the{" "}
                              <span className="font-semibold text-white">
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
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="text-xs font-semibold tracking-widest text-slate-400">
                          FOAM BLOCK DIMENSIONS
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <DimInput label="Length (in)" value={insertL} onChange={setInsertL} />
                          <DimInput label="Width (in)" value={insertW} onChange={setInsertW} />
                          <DimInput label="Depth (in)" value={insertD} onChange={setInsertD} />
                        </div>
                        {!insertDimsOk ? (
                          <div className="mt-3 text-sm text-amber-200/90">
                            Length/Width/Depth are required for Foam Insert.
                          </div>
                        ) : null}
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
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="text-xs font-semibold tracking-widest text-slate-400">
                          SEED (OPTIONAL)
                        </div>
                        <div className="mt-2 text-sm text-slate-300">
                          Seed one cavity into the editor as a starting point.
                        </div>
                        <div className="mt-3">
                          <input
                            value={cavitySeed}
                            onChange={(e) => setCavitySeed(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white outline-none focus:border-sky-400/60"
                            placeholder='Rect: 3x2x1   |   Round: 2.5x1 (dia x depth)'
                          />
                        </div>

                        {cavitySeed.trim() ? (
                          <div className="mt-2 text-sm text-slate-300">
                            Normalized:{" "}
                            <span className="font-semibold text-white">
                              {normalizedSeed || "—"}
                            </span>
                          </div>
                        ) : null}

                        {cavitySeedInvalid ? (
                          <div className="mt-3 text-sm text-amber-200/90">
                            Format must be <b>LxWxD</b> (rect) or <b>DiaxDepth</b> (round). Examples: <b>3x2x1</b>, <b>2.5x1</b>.
                          </div>
                        ) : null}
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "mat" ? (
                    <StepCard
                      title="Material"
                      hint="Select from your DB, grouped by family"
                    >
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="text-sm text-slate-200">
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
                              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={loadMaterials}
                              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
                            >
                              Refresh
                            </button>
                          </div>
                        </div>

                        {materialsError ? (
                          <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-200/90">
                            {materialsError}
                          </div>
                        ) : null}

                        {/* Family tabs */}
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                          <div className="flex flex-wrap gap-2">
                            {families.length === 0 ? (
                              <div className="text-sm text-slate-400">No materials.</div>
                            ) : (
                              families.map((fam) => {
                                const isActive = fam === activeFamily;
                                return (
                                  <button
                                    key={fam}
                                    type="button"
                                    onClick={() => setActiveFamily(fam)}
                                    className={[
                                      "rounded-xl border px-3 py-2 text-sm",
                                      isActive
                                        ? "border-sky-400/60 bg-sky-500/10 text-white"
                                        : "border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
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
                            <div className="col-span-full rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">
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
                                    "text-left rounded-2xl border p-4 transition",
                                    selected
                                      ? "border-sky-400/60 bg-sky-500/10 shadow-[0_0_0_3px_rgba(56,189,248,0.12)]"
                                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
                                  ].join(" ")}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="text-sm font-semibold text-white">
                                        {m.material_name}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-400">
                                        {familyLabel(m.material_family)}
                                      </div>
                                    </div>

                                    {m.density_lb_ft3 != null ? (
                                      <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-slate-200">
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
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            SELECTED
                          </div>
                          <div className="mt-2 text-sm text-slate-200">
                            <div>
                              <span className="text-slate-400">Material ID: </span>
                              <span className="text-white font-semibold">
                                {materialId || "-"}
                              </span>
                            </div>
                            <div className="mt-1">
                              <span className="text-slate-400">Material: </span>
                              <span className="text-white font-semibold">
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
                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            SUMMARY
                          </div>

                          <div className="mt-3 space-y-2 text-sm text-slate-200">
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
                            <Row k="Customer" v={name.trim() ? name.trim() : "-"} />
                            <Row k="Email" v={email.trim() ? email.trim() : "-"} />
                            <Row k="Company" v={company.trim() ? company.trim() : "-"} />
                            <Row k="Phone" v={phone.trim() ? phone.trim() : "-"} />

                            <Row k="Material" v={materialText || "-"} />
                            <Row k="Material ID" v={materialId || "-"} />
                            <Row
                              k="Cavity seed"
                              v={normalizedSeed || "-"}
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={close}
                            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
                          >
                            Cancel
                          </button>

                          <button
                            type="button"
                            onClick={onLaunchEditor}
                            disabled={!qtyOk || (quoteType === "foam_insert" ? !insertDimsOk : (!boxOk || !foamFitOk || !thicknessOk))}
                            className={[
                              "rounded-xl px-5 py-2 text-sm font-semibold",
                              qtyOk && (quoteType === "foam_insert" ? insertDimsOk : (boxOk && foamFitOk && thicknessOk))
                                ? "bg-sky-500/80 text-white hover:bg-sky-500"
                                : "cursor-not-allowed bg-sky-500/30 text-white/70",
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
              <div className="relative border-t border-white/10 bg-[#0B1020]/90 px-6 py-4 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={onBack}
                    disabled={activeStep === "type"}
                    className={[
                      "rounded-xl border px-4 py-2 text-sm",
                      activeStep === "type"
                        ? "cursor-not-allowed border-white/10 bg-white/[0.02] text-slate-500"
                        : "border-white/10 bg-white/[0.03] text-slate-200 hover:bg-white/[0.06]",
                    ].join(" ")}
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={onNext}
                    disabled={!canGoNext(activeStep)}
                    className={[
                      "rounded-xl px-4 py-2 text-sm font-semibold",
                      canGoNext(activeStep)
                        ? "bg-sky-500/80 text-white hover:bg-sky-500"
                        : "cursor-not-allowed bg-sky-500/30 text-white/70",
                    ].join(" ")}
                  >
                    Next
                  </button>
                </div>

                {cavitySeedInvalid ? (
                  <div className="mt-2 text-sm text-amber-200/90">
                    Cavity seed format invalid. Use <b>3x2x1</b> or <b>2.5x1</b>.
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
        "text-left rounded-2xl border p-4 transition",
        selected
          ? "border-sky-400/60 bg-sky-500/10 shadow-[0_0_0_3px_rgba(56,189,248,0.12)]"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-sm text-slate-300">{desc}</div>
    </button>
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
      <div className="mb-1 text-xs font-semibold tracking-widest text-slate-400">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        disabled={!!disabled}
        className={[
          "w-full rounded-xl border px-3 py-3 text-sm outline-none",
          disabled
            ? "cursor-not-allowed border-white/10 bg-white/[0.02] text-slate-500"
            : "border-white/10 bg-white/[0.03] text-white focus:border-sky-400/60",
        ].join(" ")}
        placeholder={disabled ? "-" : "0"}
      />
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold tracking-widest text-slate-400">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white outline-none focus:border-sky-400/60"
        placeholder="-"
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
      <div className="mb-1 text-xs font-semibold tracking-widest text-slate-400">
        {label}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] font-semibold tracking-widest text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{value || "-"}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/10 py-2 last:border-b-0">
      <div className="text-xs font-semibold tracking-widest text-slate-400">
        {k}
      </div>
      <div className="text-sm text-white text-right">{v}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="h-4 w-2/3 rounded bg-white/10" />
      <div className="mt-2 h-3 w-1/2 rounded bg-white/10" />
      <div className="mt-3 h-7 w-16 rounded bg-white/10" />
    </div>
  );
}
