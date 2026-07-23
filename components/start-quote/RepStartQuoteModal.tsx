// components/start-quote/RepStartQuoteModal.tsx
//
// Internal rep quote intake modal — launched from "Start new quote" on
// /admin/quotes (Quotes & layouts). This is a SEPARATE component from
// StartQuoteModal.tsx (the customer-facing / AI-parsed flow) and does not
// modify it in any way. It reuses the same visual building blocks
// (ProgressRail, StepCard) for consistency, but is a deeper, rep-facing
// form: customer + sales info, order details (PO, rush, qty + qty/price
// breaks, internal notes), quote type, specs, cavities, material, review.
//
// On submit:
//  1. POST /api/quotes to create the quote row (customer_name, email, phone,
//     sales_rep_slug, po_number, is_rush, qty, qty_breaks, internal_notes).
//  2. router.push to /quote/layout?... using the same URL param contract
//     StartQuoteModal already uses, so the layout editor opens pre-filled.
//
// NOTE: unlike StartQuoteModal, there is no "foam fit freeze" auto-calc for
// complete_pack box → foam dims here. Reps enter box + foam dims directly.
// This keeps the form's logic simple and predictable for internal use.

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

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
const DEFAULT_ROUND_RADIUS_IN = 0.25;

type MaterialRow = {
  id: number;
  material_name: string;
  material_family: string | null;
  density_lb_ft3: number | null;
  is_active: boolean | null;
};

type QtyBreak = {
  id: string;
  qty: string;
  price: string;
};

type CavityShape = "rect" | "circle" | "roundedRect";

type CavityRow = {
  id: string;
  shape: CavityShape;
  l: string;
  w: string;
  d: string;
  dia: string;
  depth: string;
  radius: string;
  count: string;
  layer: string;
};

type LayerOption = { index: number; label: string };

type CustomerOption = {
  name: string;
  email: string | null;
  phone: string | null;
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
  unit_price_usd?: number | null;
  extended_price_usd?: number | null;
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
  // Distinct prefix from Q-AI- (customer/AI flow) and Q-DEMO- (sales demo)
  // so rep-created quotes are easy to filter/report on later.
  return `Q-REP-${y}${m}${day}-${hh}${mm}${ss}`;
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

function familyLabel(fam: string | null) {
  const t = (fam || "").trim();
  if (!t) return "Other";
  // Display-only: drop a trailing "Foam" word (e.g. "Polyurethane Foam" ->
  // "Polyurethane"). The underlying material_family string is untouched —
  // other files still filter/match on the full "... Foam" value.
  const stripped = t.replace(/\s*foam\s*$/i, "").trim();
  return stripped || t;
}

function newQtyBreakRow(): QtyBreak {
  return { id: Math.random().toString(36).slice(2), qty: "", price: "" };
}

function newCavityRow(): CavityRow {
  return {
    id: Math.random().toString(36).slice(2),
    shape: "rect",
    l: "",
    w: "",
    d: "",
    dia: "",
    depth: "",
    radius: "",
    count: "1",
    layer: "1",
  };
}

/** Resolve a row's effective layer index against the currently-available
 * layer options, clamping out-of-range values (e.g. a row left on layer 2
 * after the quote type/foam config changed back to a single layer). */
function resolveRowLayerIndex(row: CavityRow, layerOptions: LayerOption[]): number {
  const raw = Math.round(Number(row.layer) || 1);
  const maxLayer = Math.max(1, layerOptions.length);
  return Math.min(Math.max(1, raw), maxLayer);
}

type CavityBuildResult = {
  /** layer index (1-based) -> ordered list of cavity tokens for that layer */
  tokensByLayer: Map<number, string[]>;
  /** row ids that could not produce a valid token even after the depth fallback */
  incompleteRowIds: Set<string>;
};

/** Turn structured cavity rows into per-layer token lists.
 * - rect: LxWxD
 * - circle: Ø{diameter}x{depth}
 * - roundedRect: rr{L}x{W}x{D}x{radius} (radius falls back to 0, matching
 *   the layout editor's own corner-radius fallback)
 * A row's explicit depth always wins; if left blank, `defaultDepthForLayer`
 * supplies the layer's configured thickness. A row with count > 1 is
 * repeated that many times in its layer's token list, since the URL
 * contract has no per-token quantity concept of its own. Rows that still
 * can't produce a token (no L/W or diameter at all) are tracked as
 * "incomplete" instead of silently vanishing. */
function buildCavityTokensByLayer(
  rows: CavityRow[],
  layerOptions: LayerOption[],
  defaultDepthForLayer: (layerIndex: number) => string,
): CavityBuildResult {
  const tokensByLayer = new Map<number, string[]>();
  const incompleteRowIds = new Set<string>();

  for (const row of rows) {
    const layerIndex = resolveRowLayerIndex(row, layerOptions);
    const count = Math.max(1, Math.round(Number(row.count) || 1));
    const fallbackDepth = () => toNumOrNull(defaultDepthForLayer(layerIndex));

    let token = "";
    if (row.shape === "rect" || row.shape === "roundedRect") {
      const L = toNumOrNull(row.l);
      const W = toNumOrNull(row.w);
      const D = toNumOrNull(row.d) ?? fallbackDepth();
      if (L && W && D) {
        if (row.shape === "roundedRect") {
          const radiusNum = Number(row.radius);
          const radius = Number.isFinite(radiusNum) && radiusNum >= 0 ? radiusNum : 0;
          token = `rr${L}x${W}x${D}x${radius}`;
        } else {
          token = `${L}x${W}x${D}`;
        }
      }
    } else {
      const dia = toNumOrNull(row.dia);
      const depth = toNumOrNull(row.depth) ?? fallbackDepth();
      if (dia && depth) token = `Ø${dia}x${depth}`;
    }

    if (!token) {
      incompleteRowIds.add(row.id);
      continue;
    }

    const list = tokensByLayer.get(layerIndex) ?? [];
    for (let i = 0; i < count; i++) list.push(token);
    tokensByLayer.set(layerIndex, list);
  }

  return { tokensByLayer, incompleteRowIds };
}

type StepKey = "customer" | "order" | "type" | "specs" | "cav" | "mat" | "rev";

const STEP_ORDER: StepKey[] = ["customer", "order", "type", "specs", "cav", "mat", "rev"];

const STEP_LABELS: Record<StepKey, string> = {
  customer: "Customer & sales",
  order: "Order details",
  type: "Quote type",
  specs: "Specs & dimensions",
  cav: "Cavities",
  mat: "Material",
  rev: "Review",
};

export default function RepStartQuoteModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();

  const [activeStep, setActiveStep] = React.useState<StepKey>("customer");
  const [completedSteps, setCompletedSteps] = React.useState<Set<StepKey>>(new Set());
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string>("");

  // ----- Step 1: Customer & sales -----
  const [customerName, setCustomerName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [salesRepSlug, setSalesRepSlug] = React.useState("");

  const [customerOptions, setCustomerOptions] = React.useState<CustomerOption[]>([]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/quotes/customers?t=${Math.random()}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const json = await res.json().catch(() => null);
        if (!cancelled && json?.ok && Array.isArray(json.customers)) {
          setCustomerOptions(json.customers);
        }
      } catch {
        // Non-fatal — the field still works as free text without suggestions.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // If the typed name exactly matches a known customer, offer to fill in
  // their email/phone (only into fields that are currently empty).
  function handleCustomerNameChange(v: string) {
    setCustomerName(v);
    const match = customerOptions.find(
      (c) => c.name.trim().toLowerCase() === v.trim().toLowerCase(),
    );
    if (match) {
      if (!email.trim() && match.email) setEmail(match.email);
      if (!phone.trim() && match.phone) setPhone(match.phone);
    }
  }

  // ----- Step 2: Order details -----
  const [poNumber, setPoNumber] = React.useState("");
  const [isRush, setIsRush] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [qtyBreaks, setQtyBreaks] = React.useState<QtyBreak[]>([newQtyBreakRow()]);
  const [internalNotes, setInternalNotes] = React.useState("");
  // Customer-visible notes — separate from internalNotes above. This is the
  // ONLY field on this form that feeds the "notes" URL param (the pipe that
  // flows into quote_layout_packages.notes and renders on the customer print
  // page). internalNotes must never touch that param — see the comment at
  // its usage site in onLaunchEditor below.
  const [customerNotes, setCustomerNotes] = React.useState("");

  // ----- Step 3: Quote type -----
  const [quoteType, setQuoteType] = React.useState<QuoteType>("foam_insert");

  // ----- Step 4: Specs -----
  const [insertL, setInsertL] = React.useState("");
  const [insertW, setInsertW] = React.useState("");
  const [insertD, setInsertD] = React.useState("");

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

  const [boxL, setBoxL] = React.useState("");
  const [boxW, setBoxW] = React.useState("");
  const [boxD, setBoxD] = React.useState("");
  const [boxStyle, setBoxStyle] = React.useState<BoxStyle>("mailer");
  const [printed, setPrinted] = React.useState(false);
  const [foamConfig, setFoamConfig] = React.useState<FoamConfig>("bottom_top");
  const [bottomThk, setBottomThk] = React.useState("");
  const [topThk, setTopThk] = React.useState(String(DEFAULT_TOP_PAD_IN));
  const [topPadCropCorners, setTopPadCropCorners] = React.useState(false);
  const [roundCorners, setRoundCorners] = React.useState(false);
  const [roundRadiusIn, setRoundRadiusIn] = React.useState(String(DEFAULT_ROUND_RADIUS_IN));

  // Real stock box candidates for the box being specced (Complete Pack only).
  // Nothing is pre-selected — the rep must explicitly pick a candidate or
  // "use custom instead" before moving on; see the Next-button guard below.
  const [stockCandidates, setStockCandidates] = React.useState<StockCandidate[]>([]);
  const [stockCandidatesLoading, setStockCandidatesLoading] = React.useState(false);
  const [boxChoice, setBoxChoice] = React.useState<"" | "stock" | "custom">("");
  const [selectedStockSku, setSelectedStockSku] = React.useState("");

  // Debounced (500ms) lookup of real stock candidates once box L/W/D and qty
  // are all filled in. Reuses the same 0.5" clearance-aware /api/boxes/suggest
  // endpoint the layout editor's own auto-pick uses, fed the same foam
  // footprint (box L/W minus FIT_ALLOW_IN) this form already computes for
  // `dims` on submit, so the candidates shown here match what the editor
  // would independently suggest for the same inputs.
  React.useEffect(() => {
    if (quoteType !== "complete_pack") {
      setStockCandidates([]);
      setStockCandidatesLoading(false);
      return;
    }

    const boxLNum = toNumOrNull(boxL);
    const boxWNum = toNumOrNull(boxW);
    const boxDNum = toNumOrNull(boxD);
    const qtyNum = toNumOrNull(qty);

    if (!boxLNum || !boxWNum || !boxDNum || !qtyNum) {
      setStockCandidates([]);
      setStockCandidatesLoading(false);
      return;
    }

    // A pick only applies to the exact dims/qty/style it was made for — reset
    // it whenever any of those change so a stale choice can't silently carry
    // over onto a different box. A real choice is always required again.
    setBoxChoice("");
    setSelectedStockSku("");
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
            // Fall back to the rep's box depth guess if foam thickness fields
            // aren't filled in yet, so the lookup still runs instead of
            // failing on a zero/blank stack depth.
            stack_depth_in: stackDepth > 0 ? stackDepth : boxDNum,
            qty: qtyNum,
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
  }, [quoteType, boxL, boxW, boxD, qty, boxStyle, foamConfig, bottomThk, topThk]);

  // ----- Step 5: Cavities -----
  const [cavityRows, setCavityRows] = React.useState<CavityRow[]>([newCavityRow()]);

  // Available layers a cavity row can be assigned to. Complete Pack with
  // "Bottom + Top" foam config is the only case with more than one physical
  // layer; every other combination is a single layer, so there's no real
  // choice to offer (labels mirror the layer_label values sent on submit).
  const layerOptions: LayerOption[] = React.useMemo(() => {
    if (quoteType === "complete_pack" && foamConfig === "bottom_top") {
      return [
        { index: 1, label: "Bottom Insert" },
        { index: 2, label: "Top Pad" },
      ];
    }
    return [{ index: 1, label: "Layer 1" }];
  }, [quoteType, foamConfig]);

  // Sensible default depth for cavities on a given layer, sourced from the
  // matching Specs-step thickness field. Only used as a placeholder/fallback
  // — an explicit depth typed on the row always wins.
  const defaultDepthForLayer = React.useCallback(
    (layerIndex: number): string => {
      if (quoteType === "foam_insert") return insertD;
      if (foamConfig === "bottom_top" && layerIndex === 2) return topThk;
      return bottomThk;
    },
    [quoteType, foamConfig, insertD, bottomThk, topThk],
  );

  const cavityBuild = React.useMemo(
    () => buildCavityTokensByLayer(cavityRows, layerOptions, defaultDepthForLayer),
    [cavityRows, layerOptions, defaultDepthForLayer],
  );

  // ----- Step 6: Material -----
  const [materialsLoading, setMaterialsLoading] = React.useState(false);
  const [materialsError, setMaterialsError] = React.useState("");
  const [materials, setMaterials] = React.useState<MaterialRow[]>([]);
  const [activeFamily, setActiveFamily] = React.useState("");
  const [materialText, setMaterialText] = React.useState("");
  const [materialId, setMaterialId] = React.useState("");

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
      const activeOnly = rows.filter((r) => r.is_active !== false);
      setMaterials(activeOnly);

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
    } catch (err: any) {
      setMaterialsError(String(err?.message ?? err) || "Failed to load materials.");
    } finally {
      setMaterialsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (open) loadMaterials();
  }, [open, loadMaterials]);

  const materialsByFamily = React.useMemo(() => {
    const map = new Map<string, MaterialRow[]>();
    for (const m of materials) {
      const fam = familyLabel(m.material_family);
      if (!map.has(fam)) map.set(fam, []);
      map.get(fam)!.push(m);
    }
    return map;
  }, [materials]);

  const familyNames = React.useMemo(
    () => Array.from(materialsByFamily.keys()).sort(),
    [materialsByFamily],
  );

  // ---------- Step machine ----------
  const stepIndex = STEP_ORDER.indexOf(activeStep);

  const railSteps: ProgressStep[] = STEP_ORDER.map((key) => {
    let state: ProgressState = "upcoming";
    if (key === activeStep) state = "active";
    else if (completedSteps.has(key)) state = "done";
    return { key, label: STEP_LABELS[key], state };
  });

  function goNext() {
    setCompletedSteps((prev) => new Set(prev).add(activeStep));
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setActiveStep(next);
  }

  function goBack() {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setActiveStep(prev);
  }

  function resetForm() {
    setActiveStep("customer");
    setCompletedSteps(new Set());
    setSubmitError("");
    setCustomerName("");
    setEmail("");
    setPhone("");
    setSalesRepSlug("");
    setPoNumber("");
    setIsRush(false);
    setQty("");
    setQtyBreaks([newQtyBreakRow()]);
    setInternalNotes("");
    setCustomerNotes("");
    setQuoteType("foam_insert");
    setInsertL("");
    setInsertW("");
    setInsertD("");
    setBoxL("");
    setBoxW("");
    setBoxD("");
    setBoxStyle("mailer");
    setPrinted(false);
    setFoamConfig("bottom_top");
    setBottomThk("");
    setTopThk(String(DEFAULT_TOP_PAD_IN));
    setTopPadCropCorners(false);
    setRoundCorners(false);
    setRoundRadiusIn(String(DEFAULT_ROUND_RADIUS_IN));
    setStockCandidates([]);
    setStockCandidatesLoading(false);
    setBoxChoice("");
    setSelectedStockSku("");
    setCavityRows([newCavityRow()]);
    setMaterialText("");
    setMaterialId("");
  }

  function handleClose() {
    if (submitting) return;
    resetForm();
    onClose();
  }

  // ---------- Submit ----------
  async function handleSubmit() {
    if (submitting) return;
    setSubmitError("");

    if (!customerName.trim()) {
      setSubmitError("Customer name is required.");
      setActiveStep("customer");
      return;
    }

    if (quoteType === "complete_pack" && !boxChoice) {
      setSubmitError('Choose a stock box or "Use custom instead" before creating the quote.');
      setActiveStep("specs");
      return;
    }

    setSubmitting(true);
    try {
      const quote_no = buildQuoteNo();

      const cleanBreaks = qtyBreaks
        .map((b) => ({
          qty: toNumOrNull(b.qty),
          price: b.price.trim() ? Number(b.price.trim()) : null,
        }))
        .filter((b) => b.qty != null);

      const createRes = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote_no,
          customer_name: customerName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          status: "draft",
          sales_rep_slug: salesRepSlug.trim() || undefined,
          po_number: poNumber.trim() || null,
          is_rush: isRush,
          qty: toNumOrNull(qty),
          qty_breaks: cleanBreaks.length ? cleanBreaks : null,
          internal_notes: internalNotes.trim() || null,
        }),
      });

      const json = await createRes.json().catch(() => null);
      if (!createRes.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to create quote.");
      }

      // Build the same URL param contract StartQuoteModal uses so
      // /quote/layout opens pre-filled.
      const p = new URLSearchParams();
      p.set("quote_no", quote_no);
      if (salesRepSlug.trim()) p.set("sales_rep_slug", salesRepSlug.trim());
      if (toNumOrNull(qty)) p.set("qty", String(toNumOrNull(qty)));
      // internalNotes is staff-only (persisted separately via internal_notes
      // above) and must NEVER be threaded into the editor's "notes" param —
      // that field seeds quote_layout_packages.notes, which is customer-facing
      // (returned by /api/quote/print and rendered on the print page).
      // customerNotes is the deliberate, clearly-labeled customer-visible
      // field for this — it's the only thing allowed to set "notes" here.
      if (customerNotes.trim()) p.set("notes", customerNotes.trim());

      const matIdNum = Number(materialId);
      const hasMaterialId = Number.isFinite(matIdNum) && matIdNum > 0;
      if (hasMaterialId) {
        p.set("material_id", String(matIdNum));
        p.set("material_mode", "known");
      }
      if (materialText.trim()) p.set("material_text", materialText.trim());

      const roundRadiusNum = toNumOrNull(roundRadiusIn) ?? DEFAULT_ROUND_RADIUS_IN;

      if (quoteType === "foam_insert") {
        const L = toNumOrNull(insertL);
        const W = toNumOrNull(insertW);
        const D = toNumOrNull(insertD);
        const dims = normalizeDims3(L, W, D);
        if (dims) p.set("dims", dims);

        p.set("layer_count", String(1 + extraInsertLayers.length));
        p.append("layer_thicknesses", String(D || 1));
        p.append("layer_label", "Layer 1");
        p.append("layer_crop", "0");
        p.append("layer_round", roundCorners ? "1" : "0");
        p.append("layer_round_radius", String(roundRadiusNum));
        extraInsertLayers.forEach((layer, i) => {
          p.append("layer_thicknesses", String(toNumOrNull(layer.thicknessIn) || 1));
          p.append("layer_label", `Layer ${i + 2}`);
          p.append("layer_crop", "0");
          p.append("layer_round", roundCorners ? "1" : "0");
          p.append("layer_round_radius", String(roundRadiusNum));
        });
        p.set("activeLayer", "1");
        p.set("active_layer", "1");
      } else {
        // Foam block is cut FIT_ALLOW_IN smaller than the box in both L/W so
        // it actually fits inside the box, matching StartQuoteModal.
        const boxLNum = toNumOrNull(boxL);
        const boxWNum = toNumOrNull(boxW);
        const L = boxLNum != null ? Math.max(0, boxLNum - FIT_ALLOW_IN) : null;
        const W = boxWNum != null ? Math.max(0, boxWNum - FIT_ALLOW_IN) : null;
        const bottomD = toNumOrNull(bottomThk);
        const dims = normalizeDims3(L, W, bottomD);
        if (dims) p.set("dims", dims);

        if (foamConfig === "bottom_top") {
          const t = toNumOrNull(topThk);
          p.set("layer_count", "2");
          p.append("layer_thicknesses", String(bottomD || 1));
          p.append("layer_label", "Bottom Insert");
          p.append("layer_crop", "0");
          p.append("layer_round", roundCorners ? "1" : "0");
          p.append("layer_round_radius", String(roundRadiusNum));
          p.append("layer_thicknesses", String(t || DEFAULT_TOP_PAD_IN));
          p.append("layer_label", "Top Pad");
          p.append("layer_crop", topPadCropCorners ? "1" : "0");
          p.append("layer_round", roundCorners ? "1" : "0");
          p.append("layer_round_radius", String(roundRadiusNum));
          p.set("activeLayer", "1");
          p.set("active_layer", "1");
          if (t) p.set("top_pad_in", String(t));
        } else {
          p.set("layer_count", "1");
          p.append("layer_thicknesses", String(bottomD || 1));
          p.append("layer_label", "Layer 1");
          p.append("layer_crop", "0");
          p.append("layer_round", roundCorners ? "1" : "0");
          p.append("layer_round_radius", String(roundRadiusNum));
          p.set("activeLayer", "1");
          p.set("active_layer", "1");
        }

        if (toNumOrNull(boxL)) p.set("box_l", String(toNumOrNull(boxL)));
        if (toNumOrNull(boxW)) p.set("box_w", String(toNumOrNull(boxW)));
        if (toNumOrNull(boxD)) p.set("box_d", String(toNumOrNull(boxD)));
        p.set("box_style", boxStyle);
        p.set("printed", printed ? "1" : "0");
        p.set("pack_type", "complete_pack");
        p.set("foam_config", foamConfig);
        p.set("fit_allow_in", String(FIT_ALLOW_IN));

        // Carry the rep's explicit box choice through so the editor commits
        // exactly what was picked here instead of re-suggesting or silently
        // defaulting: a stock pick names its real SKU; a custom choice tells
        // the editor to skip stock auto-pick and commit the typed dims as a
        // real kind='custom' selection instead.
        if (boxChoice === "stock" && selectedStockSku) {
          p.set("box_sku", selectedStockSku);
        } else if (boxChoice === "custom") {
          p.set("box_choice", "custom");
        }
      }

      // Per-layer cavity params (cavities_l1, cavities_l2, ...) — matches the
      // layout editor's readLayerCavitiesFromUrl contract (cavities_l{n} /
      // cavity_l{n}) so cavities land on exactly the layer the rep picked
      // instead of being guessed at by the editor.
      for (const [layerIndex, tokens] of cavityBuild.tokensByLayer.entries()) {
        if (!tokens.length) continue;
        p.set(`cavities_l${layerIndex}`, tokens.join(";"));
      }

      resetForm();
      onClose();
      router.push(`/quote/layout?${p.toString()}`);
    } catch (err: any) {
      setSubmitError(String(err?.message ?? err) || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal wrapper */}
      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10">
        <div className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-page)] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.25)]">
          {/* Header */}
          <div className="relative flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div>
              <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                START NEW QUOTE
              </div>
              <div className="mt-1 text-xl font-medium text-[var(--text-primary)]">
                Rep intake
              </div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                Full quote details before opening the layout editor.
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]"
              aria-label="Close"
              disabled={submitting}
            >
              Close
            </button>
          </div>

          {/* Body */}
          <div className="relative flex max-h-[calc(100vh-180px)] flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
                {/* Left rail */}
                <div className="md:pr-2">
                  <ProgressRail steps={railSteps} />
                </div>

                {/* Right panel */}
                <div>
                  {activeStep === "customer" ? (
                    <StepCard title="Customer & sales" hint="Who this quote is for">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Customer name *">
                          <Input
                            value={customerName}
                            onChange={handleCustomerNameChange}
                            placeholder="Acme Corp"
                            listId="rep-customer-options"
                          />
                          <datalist id="rep-customer-options">
                            {customerOptions.map((c) => (
                              <option key={c.name} value={c.name} />
                            ))}
                          </datalist>
                        </Field>
                        <Field label="Sales rep slug">
                          <Input value={salesRepSlug} onChange={setSalesRepSlug} placeholder="chuck" />
                        </Field>
                        <Field label="Email">
                          <Input value={email} onChange={setEmail} placeholder="buyer@acme.com" />
                        </Field>
                        <Field label="Phone">
                          <Input value={phone} onChange={setPhone} placeholder="555-123-4567" />
                        </Field>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "order" ? (
                    <StepCard title="Order details" hint="PO, rush status, quantity, and internal notes">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="PO / reference number">
                          <Input value={poNumber} onChange={setPoNumber} placeholder="PO-10293" />
                        </Field>
                        <Field label="Quantity">
                          <Input value={qty} onChange={setQty} placeholder="500" />
                        </Field>
                      </div>

                      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={isRush}
                          onChange={(e) => setIsRush(e.target.checked)}
                          className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-card)]"
                        />
                        Rush order
                      </label>

                      <div className="mt-5">
                        <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                          QTY / PRICE BREAKS
                        </div>
                        <div className="mt-2 space-y-2">
                          {qtyBreaks.map((row, i) => (
                            <div key={row.id} className="flex items-center gap-2">
                              <Input
                                value={row.qty}
                                onChange={(v) =>
                                  setQtyBreaks((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, qty: v } : r)),
                                  )
                                }
                                placeholder="Qty"
                              />
                              <Input
                                value={row.price}
                                onChange={(v) =>
                                  setQtyBreaks((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, price: v } : r)),
                                  )
                                }
                                placeholder="Price / unit"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setQtyBreaks((prev) =>
                                    prev.length > 1 ? prev.filter((r) => r.id !== row.id) : prev,
                                  )
                                }
                                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                                disabled={qtyBreaks.length <= 1}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setQtyBreaks((prev) => [...prev, newQtyBreakRow()])}
                          className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                        >
                          + Add qty break
                        </button>
                      </div>

                      <div className="mt-5">
                        <Field label="Internal notes">
                          <div className="mb-1 text-[11px] text-[var(--text-faint)]">
                            Staff only — never shown to the customer.
                          </div>
                          <textarea
                            value={internalNotes}
                            onChange={(e) => setInternalNotes(e.target.value)}
                            rows={4}
                            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)] focus:outline-none"
                            placeholder="Anything the layout editor / next rep should know"
                          />
                        </Field>
                      </div>

                      <div className="mt-5">
                        <Field label="Notes for the customer's quote">
                          <div className="mb-1 text-[11px] text-[var(--attention)]">
                            This will appear on the final quote the customer sees.
                          </div>
                          <textarea
                            value={customerNotes}
                            onChange={(e) => setCustomerNotes(e.target.value)}
                            rows={4}
                            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)] focus:outline-none"
                            placeholder="Anything we should tell the customer about this order (packing notes, lead time, etc.)"
                          />
                        </Field>
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "type" ? (
                    <StepCard title="Quote type" hint="Choose what you're quoting">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ChoiceCard
                          title="Foam Insert"
                          desc="Foam only (block + cavities)"
                          selected={quoteType === "foam_insert"}
                          onClick={() => setQuoteType("foam_insert")}
                        />
                        <ChoiceCard
                          title="Complete Pack"
                          desc="Box + foam (bottom insert + optional top pad)"
                          selected={quoteType === "complete_pack"}
                          onClick={() => setQuoteType("complete_pack")}
                        />
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "specs" ? (
                    <StepCard
                      title="Specs & dimensions"
                      hint={
                        quoteType === "foam_insert"
                          ? "Foam block outside dimensions"
                          : "Box dimensions + foam thickness"
                      }
                    >
                      {quoteType === "foam_insert" ? (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <Field label="Length (in)">
                              <Input value={insertL} onChange={setInsertL} placeholder="12" />
                            </Field>
                            <Field label="Width (in)">
                              <Input value={insertW} onChange={setInsertW} placeholder="10" />
                            </Field>
                            <Field label={extraInsertLayers.length > 0 ? "Layer 1 thickness (in)" : "Depth (in)"}>
                              <Input value={insertD} onChange={setInsertD} placeholder="2" />
                            </Field>
                          </div>

                          {extraInsertLayers.length > 0 ? (
                            <div className="mt-4 space-y-3">
                              <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                                ADDITIONAL LAYERS (bonded on top of Layer 1)
                              </div>
                              {extraInsertLayers.map((layer, i) => (
                                <div key={layer.id} className="flex items-end gap-3">
                                  <div className="flex-1">
                                    <Field label={`Layer ${i + 2} thickness (in)`}>
                                      <Input
                                        value={layer.thicknessIn}
                                        onChange={(v) => updateExtraInsertLayerThickness(layer.id, v)}
                                        placeholder="1"
                                      />
                                    </Field>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeExtraInsertLayer(layer.id)}
                                    className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
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
                              className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                            >
                              + Add layer
                            </button>
                            <div className="mt-2 text-xs text-[var(--text-muted)]">
                              Add a bonded foam layer (e.g. a top pad) on top of the block above. Layers share the same length/width and can be fine-tuned further in the layout editor.
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <Field label="Box L (in)">
                              <Input value={boxL} onChange={setBoxL} placeholder="14" />
                            </Field>
                            <Field label="Box W (in)">
                              <Input value={boxW} onChange={setBoxW} placeholder="12" />
                            </Field>
                            <Field label="Box D (in)">
                              <Input value={boxD} onChange={setBoxD} placeholder="6" />
                            </Field>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <Field label="Box style">
                              <select
                                value={boxStyle}
                                onChange={(e) => setBoxStyle(e.target.value as BoxStyle)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--action-primary)] focus:outline-none"
                              >
                                <option value="mailer" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Mailer</option>
                                <option value="rsc" style={{ color: "#0f172a", backgroundColor: "#fff" }}>RSC</option>
                              </select>
                            </Field>
                            <Field label="Foam config">
                              <select
                                value={foamConfig}
                                onChange={(e) => setFoamConfig(e.target.value as FoamConfig)}
                                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--action-primary)] focus:outline-none"
                              >
                                <option value="bottom_top" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Bottom + Top</option>
                                <option value="bottom_only" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Bottom only</option>
                                <option value="custom" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Custom</option>
                              </select>
                            </Field>
                          </div>

                          <div className="mt-4">
                            <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                              BOX SELECTION
                            </div>

                            {!toNumOrNull(boxL) || !toNumOrNull(boxW) || !toNumOrNull(boxD) || !toNumOrNull(qty) ? (
                              <div className="mt-2 text-xs text-[var(--text-muted)]">
                                Enter box L/W/D and quantity above to see matching stock cartons.
                              </div>
                            ) : stockCandidatesLoading ? (
                              <div className="mt-2 text-sm text-[var(--text-muted)]">
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
                                    const selected = boxChoice === "stock" && selectedStockSku === c.sku;
                                    return (
                                      <button
                                        key={c.sku}
                                        type="button"
                                        onClick={() => {
                                          setBoxChoice("stock");
                                          setSelectedStockSku(c.sku);
                                        }}
                                        className={[
                                          "w-full rounded-md border px-3 py-2 text-left text-sm",
                                          selected
                                            ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                                            : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                        ].join(" ")}
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div>
                                            <div className="font-medium text-[var(--text-primary)]">
                                              {c.description || c.sku}
                                            </div>
                                            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                                              Inside {c.inside_length_in} x {c.inside_width_in} x {c.inside_height_in} in · {c.sku}
                                            </div>
                                          </div>
                                          <div className="shrink-0 text-right text-xs text-[var(--text-secondary)]">
                                            {c.unit_price_usd != null ? (
                                              <>
                                                <div>${Number(c.unit_price_usd).toFixed(2)}/ea</div>
                                                {c.extended_price_usd != null ? (
                                                  <div className="font-medium text-[var(--text-primary)]">
                                                    ${Number(c.extended_price_usd).toFixed(2)}
                                                  </div>
                                                ) : null}
                                              </>
                                            ) : (
                                              <div className="text-[var(--text-faint)]">—</div>
                                            )}
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  })
                                )}

                                <button
                                  type="button"
                                  onClick={() => {
                                    setBoxChoice("custom");
                                    setSelectedStockSku("");
                                  }}
                                  className={[
                                    "w-full rounded-md border px-3 py-2 text-left text-sm",
                                    boxChoice === "custom"
                                      ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
                                      : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
                                  ].join(" ")}
                                >
                                  <div className="font-medium text-[var(--text-primary)]">Use custom instead</div>
                                  <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                                    Skip stock matching — use the box dimensions entered above as-is.
                                  </div>
                                </button>

                                {!boxChoice ? (
                                  <div className="text-xs text-[var(--attention)]">
                                    Choose a stock box or "Use custom instead" before continuing.
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <Field label="Bottom thickness (in)">
                              <Input value={bottomThk} onChange={setBottomThk} placeholder="1" />
                            </Field>
                            {foamConfig === "bottom_top" ? (
                              <Field label="Top pad thickness (in)">
                                <Input value={topThk} onChange={setTopThk} placeholder="1" />
                              </Field>
                            ) : null}
                          </div>

                          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={printed}
                              onChange={(e) => setPrinted(e.target.checked)}
                              className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-card)]"
                            />
                            Printed box
                          </label>

                          {foamConfig === "bottom_top" ? (
                            <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                              <input
                                type="checkbox"
                                checked={topPadCropCorners}
                                onChange={(e) => setTopPadCropCorners(e.target.checked)}
                                className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-card)]"
                              />
                              Top pad cropped corners?
                            </label>
                          ) : null}
                        </>
                      )}

                      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={roundCorners}
                          onChange={(e) => setRoundCorners(e.target.checked)}
                          className="h-4 w-4 rounded border-[var(--border-strong)] bg-[var(--surface-card)]"
                        />
                        Rounded corners?
                      </label>
                      {roundCorners ? (
                        <div className="mt-3 w-32">
                          <Field label="Radius (in)">
                            <Input
                              value={roundRadiusIn}
                              onChange={setRoundRadiusIn}
                              placeholder={String(DEFAULT_ROUND_RADIUS_IN)}
                            />
                          </Field>
                        </div>
                      ) : null}
                    </StepCard>
                  ) : null}

                  {activeStep === "cav" ? (
                    <StepCard
                      title="Cavities"
                      hint="Add one row per distinct cavity shape/size"
                    >
                      <div className="space-y-3">
                        {cavityRows.map((row) => {
                          const layerIndex = resolveRowLayerIndex(row, layerOptions);
                          const depthPlaceholder = defaultDepthForLayer(layerIndex) || "1";
                          const isIncomplete = cavityBuild.incompleteRowIds.has(row.id);

                          return (
                          <div
                            key={row.id}
                            className={[
                              "rounded-xl border p-3",
                              isIncomplete
                                ? "border-[var(--attention-border)] bg-[var(--attention-bg)]"
                                : "border-[var(--border)] bg-[var(--surface-card)]",
                            ].join(" ")}
                          >
                            <div className="flex flex-wrap items-end gap-3">
                              <Field label="Shape">
                                <select
                                  value={row.shape}
                                  onChange={(e) =>
                                    setCavityRows((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id
                                          ? { ...r, shape: e.target.value as CavityShape }
                                          : r,
                                      ),
                                    )
                                  }
                                  className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--action-primary)] focus:outline-none"
                                >
                                  <option value="rect" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Rectangle</option>
                                  <option value="circle" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Circle</option>
                                  <option value="roundedRect" style={{ color: "#0f172a", backgroundColor: "#fff" }}>Rounded rectangle</option>
                                </select>
                              </Field>

                              {layerOptions.length > 1 ? (
                                <div className="w-36">
                                  <Field label="Layer">
                                    <select
                                      value={String(layerIndex)}
                                      onChange={(e) =>
                                        setCavityRows((prev) =>
                                          prev.map((r) =>
                                            r.id === row.id ? { ...r, layer: e.target.value } : r,
                                          ),
                                        )
                                      }
                                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--action-primary)] focus:outline-none"
                                    >
                                      {layerOptions.map((opt) => (
                                        <option
                                          key={opt.index}
                                          value={String(opt.index)}
                                          style={{ color: "#0f172a", backgroundColor: "#fff" }}
                                        >
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </Field>
                                </div>
                              ) : null}

                              {row.shape === "rect" || row.shape === "roundedRect" ? (
                                <>
                                  <div className="w-20">
                                    <Field label="L (in)">
                                      <Input
                                        value={row.l}
                                        onChange={(v) =>
                                          setCavityRows((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, l: v } : r)),
                                          )
                                        }
                                        placeholder="3"
                                      />
                                    </Field>
                                  </div>
                                  <div className="w-20">
                                    <Field label="W (in)">
                                      <Input
                                        value={row.w}
                                        onChange={(v) =>
                                          setCavityRows((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, w: v } : r)),
                                          )
                                        }
                                        placeholder="2"
                                      />
                                    </Field>
                                  </div>
                                  <div className="w-20">
                                    <Field label="D (in)">
                                      <Input
                                        value={row.d}
                                        onChange={(v) =>
                                          setCavityRows((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, d: v } : r)),
                                          )
                                        }
                                        placeholder={depthPlaceholder}
                                      />
                                    </Field>
                                  </div>
                                  {row.shape === "roundedRect" ? (
                                    <div className="w-24">
                                      <Field label="Corner radius (in)">
                                        <Input
                                          value={row.radius}
                                          onChange={(v) =>
                                            setCavityRows((prev) =>
                                              prev.map((r) => (r.id === row.id ? { ...r, radius: v } : r)),
                                            )
                                          }
                                          placeholder="0.25"
                                        />
                                      </Field>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <div className="w-24">
                                    <Field label="Diameter (in)">
                                      <Input
                                        value={row.dia}
                                        onChange={(v) =>
                                          setCavityRows((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, dia: v } : r)),
                                          )
                                        }
                                        placeholder="2.5"
                                      />
                                    </Field>
                                  </div>
                                  <div className="w-24">
                                    <Field label="Depth (in)">
                                      <Input
                                        value={row.depth}
                                        onChange={(v) =>
                                          setCavityRows((prev) =>
                                            prev.map((r) => (r.id === row.id ? { ...r, depth: v } : r)),
                                          )
                                        }
                                        placeholder={depthPlaceholder}
                                      />
                                    </Field>
                                  </div>
                                </>
                              )}

                              <div className="w-20">
                                <Field label="Count">
                                  <Input
                                    value={row.count}
                                    onChange={(v) =>
                                      setCavityRows((prev) =>
                                        prev.map((r) => (r.id === row.id ? { ...r, count: v } : r)),
                                      )
                                    }
                                    placeholder="1"
                                  />
                                </Field>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  setCavityRows((prev) =>
                                    prev.length > 1 ? prev.filter((r) => r.id !== row.id) : prev,
                                  )
                                }
                                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                                disabled={cavityRows.length <= 1}
                              >
                                Remove
                              </button>
                            </div>

                            {isIncomplete ? (
                              <div className="mt-2 text-xs text-[var(--attention)]">
                                Missing dimensions — this cavity will be excluded from the quote.
                              </div>
                            ) : null}
                          </div>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() => setCavityRows((prev) => [...prev, newCavityRow()])}
                        className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
                      >
                        + Add cavity
                      </button>

                      <div className="mt-3 text-xs text-[var(--text-muted)]">
                        Leave all rows blank to lay cavities out directly in the editor instead.
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-[var(--text-faint)]">
                        {layerOptions.map((opt) => (
                          <div key={opt.index}>
                            Preview ({opt.label}): {(cavityBuild.tokensByLayer.get(opt.index) || []).join(";") || "—"}
                          </div>
                        ))}
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "mat" ? (
                    <StepCard title="Material" hint="Pulled live from your materials list">
                      {materialsLoading ? (
                        <div className="text-sm text-[var(--text-muted)]">Loading materials…</div>
                      ) : materialsError ? (
                        <div className="text-sm text-[var(--attention)]">{materialsError}</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {familyNames.map((fam) => (
                              <button
                                key={fam}
                                type="button"
                                onClick={() => setActiveFamily(fam)}
                                className={[
                                  "rounded-full px-3 py-1.5 text-xs font-medium",
                                  activeFamily === fam
                                    ? "bg-[var(--action-primary)] text-white"
                                    : "border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                                ].join(" ")}
                              >
                                {fam}
                              </button>
                            ))}
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {(materialsByFamily.get(activeFamily) || []).map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setMaterialId(String(m.id));
                                  setMaterialText(m.material_name);
                                }}
                                className={[
                                  "rounded-md border px-3 py-2 text-left text-sm",
                                  Number(materialId) === m.id
                                    ? "border-[var(--action-primary)] bg-[var(--surface-subtle)] text-[var(--text-primary)]"
                                    : "border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]",
                                ].join(" ")}
                              >
                                <div className="font-medium">{m.material_name}</div>
                                {m.density_lb_ft3 ? (
                                  <div className="text-xs text-[var(--text-muted)]">
                                    {m.density_lb_ft3} lb/ft³
                                  </div>
                                ) : null}
                              </button>
                            ))}
                          </div>

                          <div className="mt-4">
                            <Field label="Or type a material description">
                              <Input value={materialText} onChange={setMaterialText} placeholder="2.2lb PE, charcoal" />
                            </Field>
                          </div>
                        </>
                      )}
                    </StepCard>
                  ) : null}

                  {activeStep === "rev" ? (
                    <StepCard title="Review" hint="Confirm before creating the quote">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <ReviewRow label="Customer" value={customerName || "—"} />
                        <ReviewRow label="Sales rep" value={salesRepSlug || "—"} />
                        <ReviewRow label="Email" value={email || "—"} />
                        <ReviewRow label="Phone" value={phone || "—"} />
                        <ReviewRow label="PO #" value={poNumber || "—"} />
                        <ReviewRow label="Rush" value={isRush ? "Yes" : "No"} />
                        <ReviewRow label="Qty" value={qty || "—"} />
                        <ReviewRow
                          label="Qty breaks"
                          value={
                            qtyBreaks.filter((b) => b.qty.trim()).length
                              ? qtyBreaks
                                  .filter((b) => b.qty.trim())
                                  .map((b) => `${b.qty}${b.price ? ` @ $${b.price}` : ""}`)
                                  .join(", ")
                              : "—"
                          }
                        />
                        <ReviewRow label="Quote type" value={quoteType === "foam_insert" ? "Foam Insert" : "Complete Pack"} />
                        <ReviewRow label="Material" value={materialText || "—"} />
                        {layerOptions.map((opt) => (
                          <ReviewRow
                            key={opt.index}
                            label={`Cavities — ${opt.label}`}
                            value={(cavityBuild.tokensByLayer.get(opt.index) || []).join(";") || "none"}
                          />
                        ))}
                      </div>

                      {cavityBuild.incompleteRowIds.size > 0 ? (
                        <div className="mt-4 rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-sm text-[var(--attention)]">
                          {cavityBuild.incompleteRowIds.size === 1
                            ? "1 cavity row is missing dimensions and will be excluded from the quote."
                            : `${cavityBuild.incompleteRowIds.size} cavity rows are missing dimensions and will be excluded from the quote.`}
                        </div>
                      ) : null}

                      {internalNotes.trim() ? (
                        <div className="mt-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            INTERNAL NOTES <span className="text-[var(--text-faint)]">(staff only)</span>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                            {internalNotes}
                          </div>
                        </div>
                      ) : null}

                      {customerNotes.trim() ? (
                        <div className="mt-4">
                          <div className="text-xs font-medium tracking-widest text-[var(--text-muted)]">
                            CUSTOMER-VISIBLE NOTES <span className="text-[var(--attention)]">(on the quote)</span>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                            {customerNotes}
                          </div>
                        </div>
                      ) : null}

                      {submitError ? (
                        <div className="mt-4 rounded-md border border-[var(--attention-border)] bg-[var(--attention-bg)] px-3 py-2 text-sm text-[var(--attention)]">
                          {submitError}
                        </div>
                      ) : null}
                    </StepCard>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-4">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0 || submitting}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] disabled:opacity-40"
              >
                Back
              </button>

              {activeStep === "rev" ? (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-md bg-[var(--action-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-60"
                >
                  {submitting ? "Creating…" : "Create quote & open editor"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={activeStep === "specs" && quoteType === "complete_pack" && !boxChoice}
                  className="rounded-md bg-[var(--action-primary)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--action-primary-hover)] disabled:opacity-40"
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Small presentational helpers ---------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium tracking-widest text-[var(--text-muted)]">{label}</div>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  listId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  listId?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      list={listId}
      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--action-primary)] focus:outline-none"
    />
  );
}

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
        "rounded-xl border px-4 py-3 text-left transition",
        selected
          ? "border-[var(--action-primary)] bg-[var(--surface-subtle)]"
          : "border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-subtle)]",
      ].join(" ")}
    >
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{desc}</div>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--text-primary)]">{value}</div>
    </div>
  );
}
