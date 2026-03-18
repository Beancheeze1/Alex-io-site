// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// The types here are aligned with app/api/ai/orchestrate/route.ts.
// Only HTML / styling and simple display helpers should be edited here.

export type TemplateSpecs = {
  L_in: number;
  W_in: number;
  H_in: number;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family?: string | null;
  thickness_under_in?: number | null;
  color?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[];
};

// IMPORTANT: matches orchestrate PriceBreak shape
export type PriceBreak = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
  // optional UI-only field
  note?: string | null;
};

export type TemplateMaterial = {
  name: string | null;
  density_lbft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

export type TemplatePricing = {
  total: number;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  raw?: any;
  price_breaks?: PriceBreak[] | null;
};

export type TemplateLineItem = {
  id: number;
  label: string;           // e.g. "Foam set — layered construction" or material name
  sublabel?: string | null; // e.g. material/family line
  dims: string;            // "L × W × H in"
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
  isIncluded?: boolean;    // layout-layer reference rows
  isPackaging?: boolean;
};

export type TemplateLayoutLayer = {
  index: number;           // 1-based
  total: number;           // total layer count
  thickness_in: number | null;
  pocket_depth_in?: number | null;
  materialName?: string | null;
};

export type TemplateInput = {
  customerLine?: string | null;
  quoteNumber?: string | null;
  status?: string;
  specs: TemplateSpecs;
  material: TemplateMaterial;
  pricing: TemplatePricing;
  missing: string[];
  facts?: Record<string, any>;
  // Rich quote-page data (optional — email degrades gracefully when absent)
  lineItems?: TemplateLineItem[] | null;
  foamSubtotal?: number | null;
  packagingSubtotal?: number | null;
  artSetupFee?: number | null;
  printingUpchargePct?: number | null;
  printingUpchargeAmt?: number | null;
  printingUpcharge?: number | null;       // combined total (artSetupFee + printingUpchargeAmt)
  grandTotal?: number | null;
  layers?: TemplateLayoutLayer[] | null;
  layoutNotes?: string | null;
  quotePageUrl?: string | null;
};

function fmtInchesTriple(L: number, W: number, H: number): string {
  if (!L || !W || !H) return "—";
  return `${L} × ${W} × ${H} in`;
}

function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(decimals);
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

function fmtPercent(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(2)}%`;
}

function fmtQty(q: number | string | null | undefined): string {
  if (q == null) return "—";
  if (typeof q === "string" && !q.trim()) return "—";
  return String(q);
}

// Normalize a cavity dim string for comparison so we can de-dupe safely.
// Examples that should be treated the same:
//  - "5x4x1", "5 x 4 x 1", "5×4×1", "5 X 4 X 1"
function cavityKey(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/\s+/g, "")
    .replace(/inches|inch|in\b/g, "")
    .replace(/["”]/g, "");
}

function dedupeCavityList(list: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of list || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    const k = cavityKey(s);
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.replace(/×/g, "x"));
  }
  return out;
}

// Build human-readable cavity label like:
// "1 cavity — 1x1x1" or "3 cavities — 1x1x1, 2x2x1"
function buildCavityLabel(specs: TemplateSpecs): string {
  const rawDims = Array.isArray(specs.cavityDims) ? specs.cavityDims : [];
  const dims = dedupeCavityList(rawDims);

  // Prefer count if provided, but never show a count bigger than the unique dims we have.
  const countFromSpec = specs.cavityCount != null ? Number(specs.cavityCount) : null;

  // Path-A TS fix: ensure Math.min() second arg is always a number (never null).
  // If we have dims, cap to dims.length; otherwise cap to countFromSpec if it's a real number, else 0.
  const cap =
    dims.length > 0
      ? dims.length
      : Number.isFinite(countFromSpec)
        ? (countFromSpec as number)
        : 0;

  const count =
    Number.isFinite(countFromSpec) && (countFromSpec as number) > 0
      ? Math.max(1, Math.min(countFromSpec as number, cap))
      : dims.length;

  if (!count && dims.length === 0) return "—";

  const countLabel = count === 1 ? "1 cavity" : `${count} cavities`;

  if (!dims.length) return countLabel;

  const sizes = dims.join(", ");
  return `${countLabel} — ${sizes}`;
}

// Compute a best-guess minimum thickness under cavities.
// Preferred: use specs.thickness_under_in if upstream provided it.
// Fallback: use H_in minus the deepest cavity depth parsed from cavityDims.
function computeMinThicknessUnder(specs: TemplateSpecs): number | null {
  if (specs.thickness_under_in != null) {
    const n = Number(specs.thickness_under_in);
    return isNaN(n) ? null : n;
  }
  if (!specs.H_in || !Array.isArray(specs.cavityDims) || specs.cavityDims.length === 0) {
    return null;
  }

  const overall = Number(specs.H_in);
  if (isNaN(overall)) return null;

  // De-dupe to avoid weird effects from repeated dims
  const cavityDims = dedupeCavityList(specs.cavityDims);

  let minUnder: number | null = null;

  for (const raw of cavityDims) {
    if (!raw || typeof raw !== "string") continue;
    const parts = raw
      .split(/x|×/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 3) continue;
    const depthStr = parts[2].replace(/[^0-9.]/g, "");
    if (!depthStr) continue;
    const depth = Number.parseFloat(depthStr);
    if (isNaN(depth)) continue;
    const under = overall - depth;
    if (isNaN(under)) continue;
    if (minUnder === null || under < minUnder) {
      minUnder = under;
    }
  }

  return minUnder;
}

/**
 * Parse inches loosely from common email-ish inputs.
 * Supports:
 *  - numbers: 0.5, .5
 *  - with units/quotes: 0.5", 0.5 in
 *  - fractions: 1/2, 3/8
 *  - mixed: 1 1/2
 *  - unicode: ½ ¼ ¾ ⅛ ⅜ ⅝ ⅞
 */
function parseInchesLoose(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s0 = String(v).trim();
  if (!s0) return null;

  // normalize unicode fractions to ascii
  const fracMap: Record<string, string> = {
    "¼": "1/4",
    "½": "1/2",
    "¾": "3/4",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
  };

  let s = s0.replace(/[¼½¾⅛⅜⅝⅞]/g, (m) => fracMap[m] || m);

  // strip units/quotes and junk but KEEP digits, dot, slash, space, minus
  s = s
    .toLowerCase()
    .replace(/inches|inch|in\b/g, "")
    .replace(/["”]/g, "")
    .trim();

  // Mixed number: "1 1/2"
  const mixed = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (Number.isFinite(whole) && Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return whole + num / den;
    }
  }

  // Simple fraction: "1/2"
  const frac = s.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return num / den;
    }
  }

  // Plain number (also handles ".5")
  const n = Number(s);
  if (Number.isFinite(n)) return n;

  // Last resort: extract first numeric token
  const tok = s.match(/-?\d+(?:\.\d+)?/);
  if (tok) {
    const nn = Number(tok[0]);
    if (Number.isFinite(nn)) return nn;
  }

  return null;
}

// Parse a dims string like "18x12x3" (or "18 × 12 × 3") into numbers.
function parseDimsTriple(dims: any): { L: number; W: number; H: number } | null {
  const s0 = String(dims || "").trim();
  if (!s0) return null;

  const s = s0.toLowerCase().replace(/×/g, "x").replace(/\s+/g, "");
  const m = s.match(/^(-?\d+(?:\.\d+)?)(?:in)?x(-?\d+(?:\.\d+)?)(?:in)?x(-?\d+(?:\.\d+)?)(?:in)?$/);
  if (!m) return null;

  const L = Number(m[1]);
  const W = Number(m[2]);
  const H = Number(m[3]);
  if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(H)) return null;
  return { L, W, H };
}

// Build a layout-editor URL if we have enough info to make it useful.
function buildLayoutUrl(input: TemplateInput): string | null {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const qno =
    input.quoteNumber ||
    (typeof input.facts?.quote_no === "string" ? input.facts.quote_no : "");

  if (!qno) return null;

  const params = new URLSearchParams();
  const { L_in, W_in, H_in } = input.specs;

  params.set("quote_no", qno);

  // If the original email described layers, we need the editor to boot in
  // multi-layer mode immediately (before "Apply to quote").
  // Orchestrate stores this intent in facts (layer_count / layers / layer_thicknesses).
  const facts: any = input.facts || {};

  const layerCountRaw = Number(facts.layer_count);
  const layersArr = Array.isArray(facts.layers) ? (facts.layers as any[]) : [];
  const thArrRaw = Array.isArray(facts.layer_thicknesses)
    ? (facts.layer_thicknesses as any[])
    : [];

  // NOTE: Use loose inch parsing (supports "1/2", "0.5\"", "½", etc.)
  const thFromFacts = thArrRaw
    .map((x: any) => parseInchesLoose(x))
    .filter((n: any) => typeof n === "number" && Number.isFinite(n) && n > 0) as number[];

  const hasLayerIntent =
    (Number.isFinite(layerCountRaw) && layerCountRaw > 1) ||
    layersArr.length > 0 ||
    thFromFacts.length > 0;

  if (hasLayerIntent) {
    const count =
      Number.isFinite(layerCountRaw) && layerCountRaw > 1
        ? layerCountRaw
        : thFromFacts.length > 0
          ? thFromFacts.length
          : layersArr.length;

    if (count && count > 1) params.set("layer_count", String(count));

    // Canonical thickness params: REPEATED values (NOT comma strings).
    // Example:
    //   layer_thicknesses=1&layer_thicknesses=3&layer_thicknesses=0.5
    const th =
      thFromFacts.length > 0
        ? thFromFacts
        : layersArr
            .map((l) => parseInchesLoose((l as any)?.thickness_in))
            .filter((n: any) => typeof n === "number" && Number.isFinite(n) && n > 0) as number[];

    for (const t of th) {
      params.append("layer_thicknesses", String(t));
    }

    const cavLayerIndex = Number(facts.layer_cavity_layer_index);
    if (Number.isFinite(cavLayerIndex) && cavLayerIndex >= 1) {
      params.set("layer_cavity_layer_index", String(cavLayerIndex));
    }
  }

  if (L_in && W_in && H_in) {
    params.set("dims", `${L_in}x${W_in}x${H_in}`);
  }

  // Canonical cavity params: REPEATED cavity=
  // IMPORTANT: De-dupe before adding to URL so we don't double-seed.
  const cavityDimsFromFacts = Array.isArray(facts.cavityDims) ? (facts.cavityDims as any[]) : [];
  const cavityDimsFromSpecs = Array.isArray(input.specs.cavityDims)
    ? (input.specs.cavityDims as any[])
    : [];

  const cavityRaw = cavityDimsFromFacts.length ? cavityDimsFromFacts : cavityDimsFromSpecs;
  const cavityList = dedupeCavityList(cavityRaw);

  for (const c of cavityList) {
    params.append("cavity", c);
  }

  return `${base}/quote/layout?${params.toString()}`;
}

// Helper for price-break unit price: prefer piece, fallback to total/qty.
function priceBreakUnit(br: PriceBreak): string {
  if (br.piece != null && !isNaN(Number(br.piece))) {
    return fmtMoney(br.piece);
  }
  if (br.qty && br.total != null && !isNaN(Number(br.total))) {
    const unit = Number(br.total) / Number(br.qty);
    return fmtMoney(unit);
  }
  return fmtMoney(null);
}

export function renderQuoteEmail(input: TemplateInput): string {
  // ============================================================
  // PATH A: DISPLAY-ONLY NORMALIZATION
  // Orchestrate currently returns specs in a different shape:
  //   specs: { dims, qty, material, density, cavityCount, cavityDims, ... }
  // This template expects:
  //   specs: { L_in, W_in, H_in, qty, density_pcf, foam_family, ... }
  // So we normalize from BOTH input.specs and input.facts for rendering.
  // NO pricing math changes.
  // ============================================================
  const facts: any = input.facts || {};
  const specsAny: any = input.specs || {};
  const pricingAny: any = input.pricing || {};
  const pricingRaw: any = pricingAny.raw || {};

  const dimsParsed =
    parseDimsTriple(specsAny.dims) ||
    parseDimsTriple(facts.dims) ||
    null;

  const qtyNorm =
    specsAny.qty != null ? specsAny.qty : facts.qty != null ? facts.qty : null;

  // density can arrive as number, "1.70", "1.70lb", etc
  const densityNorm =
    specsAny.density_pcf != null
      ? Number(specsAny.density_pcf)
      : specsAny.density != null
        ? Number.parseFloat(String(specsAny.density))
        : facts.density != null
          ? Number.parseFloat(String(facts.density))
          : null;

  const cavityDimsNormRaw =
    Array.isArray(specsAny.cavityDims)
      ? specsAny.cavityDims
      : Array.isArray(specsAny.cavity_dims)
        ? specsAny.cavity_dims
        : Array.isArray(facts.cavityDims)
          ? facts.cavityDims
          : Array.isArray(facts.cavity_dims)
            ? facts.cavity_dims
            : [];

  const cavityCountNorm =
    specsAny.cavityCount != null
      ? Number(specsAny.cavityCount)
      : specsAny.cavity_count != null
        ? Number(specsAny.cavity_count)
        : facts.cavityCount != null
          ? Number(facts.cavityCount)
          : facts.cavity_count != null
            ? Number(facts.cavity_count)
            : null;

  const specs: TemplateSpecs = {
    L_in: specsAny.L_in != null ? Number(specsAny.L_in) : dimsParsed ? dimsParsed.L : 0,
    W_in: specsAny.W_in != null ? Number(specsAny.W_in) : dimsParsed ? dimsParsed.W : 0,
    H_in: specsAny.H_in != null ? Number(specsAny.H_in) : dimsParsed ? dimsParsed.H : 0,
    qty: qtyNorm,
    density_pcf: Number.isFinite(densityNorm as any) ? (densityNorm as number) : null,
    foam_family:
      specsAny.foam_family != null
        ? String(specsAny.foam_family)
        : specsAny.material != null
          ? String(specsAny.material) // display only; DB truth still preferred later
          : null,
    thickness_under_in:
      specsAny.thickness_under_in != null ? Number(specsAny.thickness_under_in) : null,
    color: specsAny.color != null ? String(specsAny.color) : null,
    cavityCount: Number.isFinite(cavityCountNorm as any) ? (cavityCountNorm as number) : null,
    cavityDims: dedupeCavityList(cavityDimsNormRaw),
  };

  // Normalize material display fallbacks (still respects material_family rule)
  const material: TemplateMaterial = {
    name:
      input.material?.name && String(input.material.name).trim()
        ? String(input.material.name).trim()
        : facts.material_name && String(facts.material_name).trim()
          ? String(facts.material_name).trim()
          : null,
    density_lbft3:
      input.material?.density_lbft3 != null
        ? Number(input.material.density_lbft3)
        : null,
    kerf_pct:
      input.material?.kerf_pct != null
        ? Number(input.material.kerf_pct)
        : facts.kerf_pct != null
          ? Number.parseFloat(String(facts.kerf_pct))
          : pricingRaw.kerf_pct != null
            ? Number.parseFloat(String(pricingRaw.kerf_pct))
            : null,
    min_charge:
      input.material?.min_charge != null
        ? Number(input.material.min_charge)
        : facts.min_charge != null
          ? Number.parseFloat(String(facts.min_charge))
          : pricingRaw.min_charge != null
            ? Number.parseFloat(String(pricingRaw.min_charge))
            : null,
  };

  const pricing: TemplatePricing = input.pricing || ({ total: 0 } as any);
  const quoteNumber = input.quoteNumber || facts.quoteNumber || facts.quote_no || "";
  const status = input.status || facts.status || "draft";

  // Filter "missing" display so it doesn't contradict known values (display-only)
  const missingIn = Array.isArray(input.missing) ? input.missing : [];
  const missing = missingIn.filter((m) => {
    if (m === "Quantity") return specs.qty == null || String(specs.qty).trim() === "";
    if (m === "Dimensions") return !(specs.L_in > 0 && specs.W_in > 0 && specs.H_in > 0);
    if (m === "Density") return !(specs.density_pcf != null && Number.isFinite(specs.density_pcf));
    // Material can still be legitimately missing even if we have an ID; keep as-is.
    return true;
  });

  const outsideSize = fmtInchesTriple(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const densityLabel =
    specs.density_pcf != null ? `${fmtNumber(specs.density_pcf, 1)} pcf` : "—";

  // ---------- Material / family labels (email + viewer alignment) ----------

  // IMPORTANT: We do NOT guess or normalize PE/EPE here.
  // We simply surface the material_family string coming from upstream/DB.
  const rawFamilyFromPricing =
    pricingRaw?.material_family != null
      ? String(pricingRaw.material_family).trim()
      : "";
  const rawFamilyFromFacts =
    facts.material_family != null ? String(facts.material_family).trim() : "";
  const rawFamilyFromSpecs =
    specs.foam_family != null ? String(specs.foam_family).trim() : "";

  // DB truth: prefer material_family from pricing.raw, then facts.material_family, then specs.foam_family.
  const foamFamily = rawFamilyFromPricing || rawFamilyFromFacts || rawFamilyFromSpecs || "";

  // Grade / specific material name from DB (e.g. "EPE Type III").
  const gradeName = (material.name && material.name.trim()) || "";

  // Specs card: show the foam family if present; otherwise fall back to grade.
  const specsMaterialLabel = foamFamily || gradeName || "—";

  // Pricing card: use the same customer-facing label.
  const matName = specsMaterialLabel;

  const cavityLabel = buildCavityLabel(specs);
  const minThicknessUnderVal = computeMinThicknessUnder(specs);
  const minThicknessUnder =
    minThicknessUnderVal != null ? `${fmtNumber(minThicknessUnderVal, 2)} in` : "—";

  const matDensity =
    material.density_lbft3 != null
      ? `${fmtNumber(material.density_lbft3, 1)} lb/ft³`
      : densityLabel !== "—"
        ? densityLabel
        : "—";

  const matKerf = fmtPercent(material.kerf_pct ?? pricingRaw?.kerf_pct);

  const priceBreaks: PriceBreak[] = pricing.price_breaks ?? [];

  // Layout URL: prefer orchestrate-provided URL (facts), otherwise build one from normalized specs.
  const layoutUrl =
    facts.layout_editor_url ||
    facts.layoutEditorUrl ||
    facts.layoutEditorLink ||
    buildLayoutUrl({ ...input, specs } as any);

  // Quote page URL (interactive viewer)
  const _base2 = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const quotePageUrl =
    input.quotePageUrl ||
    (quoteNumber ? `${_base2}/quote?quote_no=${encodeURIComponent(quoteNumber)}` : null);

  // Rich line items / totals (from print route)
  const lineItems = Array.isArray(input.lineItems) ? input.lineItems : [];
  const hasLineItems = lineItems.length > 0;
  const foamSubtotalAmt = input.foamSubtotal ?? null;
  const packagingSubtotalAmt = input.packagingSubtotal ?? null;
  const artSetupFeeAmt = input.artSetupFee ?? null;
  const printingUpchargePctVal = input.printingUpchargePct ?? null;
  const printingUpchargeAmtVal = input.printingUpchargeAmt ?? null;
  const printingUpchargeAmt = input.printingUpcharge ?? null;   // combined
  const grandTotalAmt = input.grandTotal ?? null;
  const layers = Array.isArray(input.layers) ? input.layers : [];
  const hasLayers = layers.length > 0;
  const layoutNotes = input.layoutNotes || null;

  const showMissing = Array.isArray(missing) && missing.length > 0;
  const statusLabel = status || "draft";

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const logoUrl = `${base}/alex-io-logo.png`;

  let skivingNote: string;
  if (typeof facts.skiving_note === "string" && facts.skiving_note.trim()) {
    skivingNote = facts.skiving_note.trim();
  } else if (typeof facts.skivingNote === "string" && facts.skivingNote.trim()) {
    skivingNote = facts.skivingNote.trim();
  } else if (typeof facts.skiving === "boolean") {
    skivingNote = facts.skiving ? "Applied" : "Not applied";
  } else if (typeof facts.skiving === "string" && facts.skiving.trim()) {
    skivingNote = facts.skiving.trim();
  } else {
    skivingNote = "Not specified";
  }

  // ============================================================
  // PATH A FIX (NO PRICING LOGIC CHANGES):
  // If required inputs are missing, show pending values instead of $0.00 / misleading copy.
  // Required inputs for showing a real dollar amount (display-only):
  //   - Dimensions
  //   - Material
  //   - Density
  // ============================================================
  const missingList = Array.isArray(missing) ? missing : [];
  const dimsMissing = missingList.includes("Dimensions");
  const materialMissing = missingList.includes("Material");
  const densityMissing = missingList.includes("Density");

  const pricingPending = dimsMissing || materialMissing || densityMissing;

  const pieceCi = fmtNumber(pricing.piece_ci ?? pricingRaw?.piece_ci);
  const orderCi = fmtNumber(pricing.order_ci ?? pricingRaw?.order_ci);
  const orderCiWithWaste = fmtNumber(
    pricing.order_ci_with_waste ?? pricingRaw?.order_ci_with_waste,
  );

  const computedOrderTotal = fmtMoney(
    pricing.total ??
      pricingRaw?.price_total ??
      pricingRaw?.total ??
      pricingRaw?.order_total,
  );

  const computedUsedMinCharge =
    pricing.used_min_charge ?? pricingRaw?.min_charge_applied ?? false;

  // When pending, replace numeric-ish pricing fields with — / Pending (keep the same rows & layout).
  const minCharge = pricingPending
    ? "—"
    : material.min_charge != null
      ? fmtMoney(material.min_charge)
      : pricingRaw?.min_charge
        ? fmtMoney(pricingRaw.min_charge)
        : "$0.00";

  const orderTotal = pricingPending ? "Pending" : computedOrderTotal;

  const usedMinCharge = pricingPending ? false : computedUsedMinCharge;

  const appliedLabel = pricingPending
    ? "Pending (need specs)"
    : usedMinCharge
      ? "Minimum charge applied"
      : "Calculated from volume";

  // Hide the “How this price is built” row entirely when pending (so we don’t imply it was computed).
  const showHowBuilt = !pricingPending;


  // ── Key facts for the summary card ──────────────────────────────────
  const displayTotal = grandTotalAmt ?? (pricingPending ? null : pricing.total ?? null);
  const hasPackaging = packagingSubtotalAmt != null && packagingSubtotalAmt > 0;
  const hasPrinting  = printingUpchargeAmt != null && printingUpchargeAmt > 0;
  void showHowBuilt; // retained for potential future use

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Your quote is ready${quoteNumber ? " — " + quoteNumber : ""}</title>
  </head>
  <body style="margin:0;padding:0;background:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111827;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#0f172a;border-radius:18px;border:1px solid #1f2937;overflow:hidden;box-shadow:0 22px 45px rgba(15,23,42,0.55);">

            <!-- Header -->
            <tr>
              <td style="padding:20px 28px 16px 28px;background:linear-gradient(135deg,#0ea5e9 0%,#0ea5e9 40%,#0f172a 100%);">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e0f2fe;opacity:0.9;">Powered by</div>
                <div style="font-size:22px;font-weight:800;color:#f9fafb;line-height:1.2;margin-top:2px;">Alex-IO</div>
                <div style="margin-top:5px;font-size:12px;color:#e0f2fe;">
                  Quote${quoteNumber ? ` &middot; <strong style="color:#f9fafb;">${quoteNumber}</strong>` : ""}
                  &nbsp;&middot;&nbsp;
                  <span style="text-transform:capitalize;">${statusLabel}</span>
                </div>
                <div style="display:none;">${logoUrl}</div>
              </td>
            </tr>

            <!-- Intro copy -->
            <tr>
              <td style="padding:24px 28px 0 28px;">
                <p style="margin:0;font-size:15px;font-weight:600;color:#f9fafb;line-height:1.4;">Your foam packaging quote is ready.</p>
                <p style="margin:10px 0 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
                  Click below to view your full interactive quote — including specs, pricing, line items, and the layout editor where you can place cavity locations and sizes.
                </p>
              </td>
            </tr>

            <!-- Key facts card -->
            <tr>
              <td style="padding:20px 28px 0 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:12px;border:1px solid #1f2937;background:#020617;overflow:hidden;">
                  <tr>
                    <td style="padding:10px 16px;border-bottom:1px solid #1f2937;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;background:rgba(56,189,248,0.06);">
                      Quote summary
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="width:33%;vertical-align:top;padding-right:12px;">
                            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:4px;">Dimensions</div>
                            <div style="font-size:14px;font-weight:700;color:#f9fafb;">${outsideSize}</div>
                          </td>
                          <td style="width:14%;vertical-align:top;padding-right:12px;">
                            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:4px;">Qty</div>
                            <div style="font-size:14px;font-weight:700;color:#f9fafb;">${qty}</div>
                          </td>
                          <td style="width:30%;vertical-align:top;padding-right:12px;">
                            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:4px;">Material</div>
                            <div style="font-size:13px;font-weight:600;color:#f9fafb;">${specsMaterialLabel}</div>
                            ${matDensity !== "—" ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${matDensity}</div>` : ""}
                          </td>
                          <td style="width:23%;vertical-align:top;text-align:right;">
                            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:4px;">Est. total</div>
                            <div style="font-size:16px;font-weight:800;color:#f97316;">${displayTotal != null ? fmtMoney(displayTotal) : "Pending"}</div>
                            ${hasPackaging || hasPrinting ? `<div style="font-size:10px;color:#6b7280;margin-top:2px;">foam${hasPackaging ? " + pkg" : ""}${hasPrinting ? " + print" : ""}</div>` : ""}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Primary CTA -->
            <tr>
              <td style="padding:28px 28px 0 28px;text-align:center;">
                ${quotePageUrl
                  ? `<a href="${quotePageUrl}" style="display:inline-block;padding:15px 40px;border-radius:999px;background:#0ea5e9;color:#0f172a;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.01em;">View your full quote &rarr;</a>`
                  : ""}
              </td>
            </tr>

            <!-- Secondary: layout editor -->
            ${layoutUrl ? `<tr>
              <td style="padding:14px 28px 0 28px;text-align:center;">
                <p style="margin:0;font-size:12px;color:#6b7280;">
                  Ready to place cavity locations?&nbsp;
                  <a href="${layoutUrl}" style="color:#38bdf8;text-decoration:none;font-weight:600;">Open the layout editor &rarr;</a>
                </p>
              </td>
            </tr>` : ""}

            <!-- Divider -->
            <tr><td style="padding:24px 28px 0 28px;"><div style="border-top:1px solid #1f2937;"></div></td></tr>

            <!-- What's on the quote page -->
            <tr>
              <td style="padding:20px 28px 0 28px;">
                <p style="margin:0 0 10px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Your interactive quote includes</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="width:50%;vertical-align:top;padding-right:12px;padding-bottom:8px;">
                      <div style="font-size:12px;color:#cbd5f5;">&#10003;&nbsp; Full specs &amp; construction details</div>
                    </td>
                    <td style="width:50%;vertical-align:top;padding-bottom:8px;">
                      <div style="font-size:12px;color:#cbd5f5;">&#10003;&nbsp; Itemized line items with pricing</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="vertical-align:top;padding-right:12px;padding-bottom:8px;">
                      <div style="font-size:12px;color:#cbd5f5;">&#10003;&nbsp; Packaging &amp; printing breakdown</div>
                    </td>
                    <td style="vertical-align:top;padding-bottom:8px;">
                      <div style="font-size:12px;color:#cbd5f5;">&#10003;&nbsp; Interactive foam layout editor</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Feedback -->
            <tr>
              <td style="padding:20px 28px 28px 28px;">
                <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6;">
                  See anything that looks off?&nbsp;
                  <a href="mailto:sales@alex-io.com?subject=Alex-IO%20quote%20question" style="color:#38bdf8;text-decoration:none;">Reply to this email</a>
                  &nbsp;and we'll get it sorted.
                </p>
              </td>
            </tr>

          </table>

          <!-- Footer -->
          <div style="max-width:600px;margin-top:12px;padding:0 28px;font-size:11px;color:#4b5563;text-align:center;">
            <p style="margin:0;">This quote was generated by Alex-IO. A human will review and confirm before anything is cut. Prices are estimates and may change if specs or quantities are adjusted.</p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}