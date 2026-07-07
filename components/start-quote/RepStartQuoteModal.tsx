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

type QtyBreak = {
  id: string;
  qty: string;
  price: string;
};

type CavityShape = "rect" | "circle";

type CavityRow = {
  id: string;
  shape: CavityShape;
  l: string;
  w: string;
  d: string;
  dia: string;
  depth: string;
  count: string;
};

type CustomerOption = {
  name: string;
  email: string | null;
  phone: string | null;
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
  return t ? t : "Other";
}

function parseSingleCavity(raw: string): string | null {
  const s = String(raw || "")
    .replace(/[×\*]/g, "x")
    .replace(/\s+/g, "")
    .trim();
  if (!s) return null;

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

  const nums = s.match(/(\d+(?:\.\d+)?|\.\d+)/g);
  if (!nums) return null;

  if (nums.length >= 3) {
    const L = Number(nums[0]);
    const W = Number(nums[1]);
    const D = Number(nums[2]);
    if (![L, W, D].every((n) => Number.isFinite(n) && n > 0)) return null;
    return `${L}x${W}x${D}`;
  }

  if (nums.length === 2) {
    const dia = Number(nums[0]);
    const depth = Number(nums[1]);
    if (![dia, depth].every((n) => Number.isFinite(n) && n > 0)) return null;
    return `Ø${dia}x${depth}`;
  }

  return null;
}

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
    count: "1",
  };
}

/** Turn structured cavity rows into the semicolon-delimited seed string the
 * rest of the submit pipeline (parseSeedCavities → cavities= URL param)
 * already expects. A row with count > 1 is repeated that many times, since
 * the URL contract has no per-token quantity concept of its own. */
function buildCavitySeedFromRows(rows: CavityRow[]): string {
  const tokens: string[] = [];
  for (const row of rows) {
    const count = Math.max(1, Math.round(Number(row.count) || 1));
    let token = "";
    if (row.shape === "rect") {
      const L = toNumOrNull(row.l);
      const W = toNumOrNull(row.w);
      const D = toNumOrNull(row.d);
      if (L && W && D) token = `${L}x${W}x${D}`;
    } else {
      const dia = toNumOrNull(row.dia);
      const depth = toNumOrNull(row.depth);
      if (dia && depth) token = `Ø${dia}x${depth}`;
    }
    if (!token) continue;
    for (let i = 0; i < count; i++) tokens.push(token);
  }
  return tokens.join(";");
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

  // ----- Step 3: Quote type -----
  const [quoteType, setQuoteType] = React.useState<QuoteType>("foam_insert");

  // ----- Step 4: Specs -----
  const [insertL, setInsertL] = React.useState("");
  const [insertW, setInsertW] = React.useState("");
  const [insertD, setInsertD] = React.useState("");

  const [boxL, setBoxL] = React.useState("");
  const [boxW, setBoxW] = React.useState("");
  const [boxD, setBoxD] = React.useState("");
  const [boxStyle, setBoxStyle] = React.useState<BoxStyle>("mailer");
  const [printed, setPrinted] = React.useState(false);
  const [foamConfig, setFoamConfig] = React.useState<FoamConfig>("bottom_top");
  const [bottomThk, setBottomThk] = React.useState("");
  const [topThk, setTopThk] = React.useState(String(DEFAULT_TOP_PAD_IN));

  // ----- Step 5: Cavities -----
  const [cavityRows, setCavityRows] = React.useState<CavityRow[]>([newCavityRow()]);

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

      const matIdNum = Number(materialId);
      const hasMaterialId = Number.isFinite(matIdNum) && matIdNum > 0;
      if (hasMaterialId) {
        p.set("material_id", String(matIdNum));
        p.set("material_mode", "known");
      }
      if (materialText.trim()) p.set("material_text", materialText.trim());

      const seedCav = parseSeedCavities(buildCavitySeedFromRows(cavityRows)).normalized;

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

        if (seedCav) p.set("cavities", seedCav);
      } else {
        const L = toNumOrNull(boxL);
        const W = toNumOrNull(boxW);
        const bottomD = toNumOrNull(bottomThk);
        const dims = normalizeDims3(L, W, bottomD);
        if (dims) p.set("dims", dims);

        if (foamConfig === "bottom_top") {
          const t = toNumOrNull(topThk);
          p.set("layer_count", "2");
          p.append("layer_thicknesses", String(bottomD || 1));
          p.append("layer_label", "Bottom Insert");
          p.append("layer_thicknesses", String(t || DEFAULT_TOP_PAD_IN));
          p.append("layer_label", "Top Pad");
          p.set("layer_cavity_layer_index", "1");
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

        if (toNumOrNull(boxL)) p.set("box_l", String(toNumOrNull(boxL)));
        if (toNumOrNull(boxW)) p.set("box_w", String(toNumOrNull(boxW)));
        if (toNumOrNull(boxD)) p.set("box_d", String(toNumOrNull(boxD)));
        p.set("box_style", boxStyle);
        p.set("printed", printed ? "1" : "0");
        p.set("pack_type", "complete_pack");
        p.set("foam_config", foamConfig);
        p.set("fit_allow_in", String(FIT_ALLOW_IN));
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
        <div className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0B1020] shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)]">
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
                START NEW QUOTE
              </div>
              <div className="mt-1 text-xl font-semibold text-white">
                Rep intake
              </div>
              <div className="mt-1 text-sm text-slate-300">
                Full quote details before opening the layout editor.
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
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

                      <label className="mt-4 flex items-center gap-2 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={isRush}
                          onChange={(e) => setIsRush(e.target.checked)}
                          className="h-4 w-4 rounded border-white/20 bg-white/5"
                        />
                        Rush order
                      </label>

                      <div className="mt-5">
                        <div className="text-xs font-semibold tracking-widest text-slate-400">
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
                                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
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
                          className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
                        >
                          + Add qty break
                        </button>
                      </div>

                      <div className="mt-5">
                        <Field label="Internal notes">
                          <textarea
                            value={internalNotes}
                            onChange={(e) => setInternalNotes(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
                            placeholder="Anything the layout editor / next rep should know"
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
                        <div className="grid grid-cols-3 gap-3">
                          <Field label="Length (in)">
                            <Input value={insertL} onChange={setInsertL} placeholder="12" />
                          </Field>
                          <Field label="Width (in)">
                            <Input value={insertW} onChange={setInsertW} placeholder="10" />
                          </Field>
                          <Field label="Depth (in)">
                            <Input value={insertD} onChange={setInsertD} placeholder="2" />
                          </Field>
                        </div>
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
                                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-sky-400/60 focus:outline-none"
                              >
                                <option value="mailer">Mailer</option>
                                <option value="rsc">RSC</option>
                              </select>
                            </Field>
                            <Field label="Foam config">
                              <select
                                value={foamConfig}
                                onChange={(e) => setFoamConfig(e.target.value as FoamConfig)}
                                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-sky-400/60 focus:outline-none"
                              >
                                <option value="bottom_top">Bottom + Top</option>
                                <option value="bottom_only">Bottom only</option>
                                <option value="custom">Custom</option>
                              </select>
                            </Field>
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

                          <label className="mt-4 flex items-center gap-2 text-sm text-slate-200">
                            <input
                              type="checkbox"
                              checked={printed}
                              onChange={(e) => setPrinted(e.target.checked)}
                              className="h-4 w-4 rounded border-white/20 bg-white/5"
                            />
                            Printed box
                          </label>
                        </>
                      )}
                    </StepCard>
                  ) : null}

                  {activeStep === "cav" ? (
                    <StepCard
                      title="Cavities"
                      hint="Add one row per distinct cavity shape/size"
                    >
                      <div className="space-y-3">
                        {cavityRows.map((row) => (
                          <div
                            key={row.id}
                            className="rounded-2xl border border-white/10 bg-white/[0.02] p-3"
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
                                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-sky-400/60 focus:outline-none"
                                >
                                  <option value="rect">Rectangle</option>
                                  <option value="circle">Circle</option>
                                </select>
                              </Field>

                              {row.shape === "rect" ? (
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
                                        placeholder="1"
                                      />
                                    </Field>
                                  </div>
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
                                        placeholder="1"
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
                                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
                                disabled={cavityRows.length <= 1}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => setCavityRows((prev) => [...prev, newCavityRow()])}
                        className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.06]"
                      >
                        + Add cavity
                      </button>

                      <div className="mt-3 text-xs text-slate-400">
                        Leave all rows blank to lay cavities out directly in the editor instead.
                      </div>

                      <div className="mt-3 text-xs text-slate-500">
                        Preview: {buildCavitySeedFromRows(cavityRows) || "—"}
                      </div>
                    </StepCard>
                  ) : null}

                  {activeStep === "mat" ? (
                    <StepCard title="Material" hint="Pulled live from your materials list">
                      {materialsLoading ? (
                        <div className="text-sm text-slate-400">Loading materials…</div>
                      ) : materialsError ? (
                        <div className="text-sm text-amber-300">{materialsError}</div>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {familyNames.map((fam) => (
                              <button
                                key={fam}
                                type="button"
                                onClick={() => setActiveFamily(fam)}
                                className={[
                                  "rounded-full px-3 py-1.5 text-xs font-semibold",
                                  activeFamily === fam
                                    ? "bg-sky-500 text-slate-950"
                                    : "border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]",
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
                                  "rounded-xl border px-3 py-2 text-left text-sm",
                                  Number(materialId) === m.id
                                    ? "border-sky-400/60 bg-sky-500/10 text-white"
                                    : "border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]",
                                ].join(" ")}
                              >
                                <div className="font-medium">{m.material_name}</div>
                                {m.density_lb_ft3 ? (
                                  <div className="text-xs text-slate-400">
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
                        <ReviewRow label="Cavities" value={parseSeedCavities(buildCavitySeedFromRows(cavityRows)).normalized || "—"} />
                      </div>

                      {internalNotes.trim() ? (
                        <div className="mt-4">
                          <div className="text-xs font-semibold tracking-widest text-slate-400">
                            INTERNAL NOTES
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                            {internalNotes}
                          </div>
                        </div>
                      ) : null}

                      {submitError ? (
                        <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                          {submitError}
                        </div>
                      ) : null}
                    </StepCard>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Footer nav */}
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0 || submitting}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 hover:bg-white/[0.06] disabled:opacity-40"
              >
                Back
              </button>

              {activeStep === "rev" ? (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                >
                  {submitting ? "Creating…" : "Create quote & open editor"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-xl bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
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
      <div className="mb-1 text-xs font-semibold tracking-widest text-slate-400">{label}</div>
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
      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-sky-400/60 focus:outline-none"
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
        "rounded-2xl border px-4 py-3 text-left transition",
        selected
          ? "border-sky-400/60 bg-sky-500/10"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{desc}</div>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-widest text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm text-white">{value}</div>
    </div>
  );
}
