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
    (quoteNumber ? `${_base2}/quote/${encodeURIComponent(quoteNumber)}` : null);

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

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Foam quote${quoteNumber ? " " + quoteNumber : ""}</title>
  </head>
  <body style="margin:0;padding:0;background:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111827;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="background:#0f172a;border-radius:18px;border:1px solid #1f2937;overflow:hidden;box-shadow:0 22px 45px rgba(15,23,42,0.55);">
            
            <!-- Header -->
            <tr>
              <td style="padding:18px 24px 14px 24px;border-bottom:1px solid #1f2937;background:linear-gradient(135deg,#0ea5e9 0%,#0ea5e9 45%,#0f172a 100%);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <!-- Stylized Powered by Alex-IO text -->
                      <div style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e0f2fe;opacity:0.9;">
                        Powered by
                      </div>
                      <div style="font-size:20px;font-weight:800;color:#f9fafb;line-height:1.2;text-shadow:0 0 8px rgba(15,23,42,0.55);">
                        Alex-IO
                      </div>
                      <div style="margin-top:4px;font-size:12px;color:#e0f2fe;opacity:0.95;">
                        Quote${
                          quoteNumber
                            ? ` · <span style="font-weight:600;color:#f9fafb;">${quoteNumber}</span>`
                            : ""
                        } 
                        &nbsp;·&nbsp;
                        <span style="text-transform:capitalize;">Status: ${statusLabel}</span>
                      </div>
                      <!-- Hidden logo URL so the variable is still "used" in TS -->
                      <div style="display:none;font-size:0;line-height:0;">${logoUrl}</div>
                    </td>
                    <td style="vertical-align:middle;text-align:right;">
                      <span style="display:inline-block;font-size:11px;font-weight:500;color:#e0f2fe;padding:5px 10px;border-radius:999px;border:1px solid rgba(226,232,240,0.7);background:rgba(15,23,42,0.5);backdrop-filter:blur(8px);">
                        Automated first response
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- ══════════════════════════════════════════════ -->
            <!-- SPECS SNAPSHOT (single-column, compact)        -->
            <!-- ══════════════════════════════════════════════ -->
            <tr>
              <td style="padding:16px 26px 0 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;overflow:hidden;">
                  <tr>
                    <td colspan="4" style="padding:8px 14px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));">
                      Specs
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 14px 8px 14px;width:25%;vertical-align:top;">
                      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:3px;">Dimensions</div>
                      <div style="font-size:13px;font-weight:600;color:#f9fafb;">${outsideSize}</div>
                    </td>
                    <td style="padding:8px 14px 8px 14px;width:15%;vertical-align:top;">
                      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:3px;">Qty</div>
                      <div style="font-size:13px;font-weight:600;color:#f9fafb;">${qty}</div>
                    </td>
                    <td style="padding:8px 14px 8px 14px;width:30%;vertical-align:top;">
                      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:3px;">Material</div>
                      <div style="font-size:13px;font-weight:600;color:#f9fafb;">${specsMaterialLabel}</div>
                      ${matDensity !== "—" ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${matDensity}</div>` : ""}
                    </td>
                    <td style="padding:8px 14px 8px 14px;width:30%;vertical-align:top;">
                      <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;margin-bottom:3px;">Construction</div>
                      <div style="font-size:12px;color:#cbd5f5;line-height:1.5;">
                        ${hasLayers
                          ? `Layered (${layers.length} layers)`
                          : "Single layer"}${skivingNote !== "Not specified" ? ` · Skiving: ${skivingNote}` : ""}
                      </div>
                    </td>
                  </tr>
                  ${cavityLabel !== "—" ? `<tr>
                    <td colspan="4" style="padding:0 14px 8px 14px;border-top:1px solid #111827;">
                      <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#6b7280;">Cavities:&nbsp;</span>
                      <span style="font-size:12px;color:#cbd5f5;">${cavityLabel}</span>
                    </td>
                  </tr>` : ""}
                </table>
              </td>
            </tr>


            <!-- ══════════════════════════════════════════════ -->
            <!-- PRICING SUMMARY (unit price + subtotals)       -->
            <!-- ══════════════════════════════════════════════ -->
            ${(() => {
              const unitPrice = pricing.total && specs.qty ? pricing.total / Number(specs.qty) : null;
              const showGrand = grandTotalAmt != null && grandTotalAmt > 0;
              const hasPrintingLines = (artSetupFeeAmt != null && artSetupFeeAmt > 0) || (printingUpchargeAmtVal != null && printingUpchargeAmtVal > 0);
              if (!unitPrice && !showGrand) return "";
              return `<tr>
              <td style="padding:16px 26px 0 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                      Pricing summary
                    </td>
                  </tr>
                  ${unitPrice != null ? `<tr>
                    <td style="padding:5px 12px;font-size:12px;font-weight:600;color:#e5e7eb;width:60%;">Primary unit price</td>
                    <td style="padding:5px 12px;font-size:13px;font-weight:700;color:#f9fafb;text-align:right;">${fmtMoney(unitPrice)}</td>
                  </tr>` : ""}
                  ${foamSubtotalAmt != null ? `<tr>
                    <td style="padding:5px 12px;font-size:12px;color:#9ca3af;">Foam subtotal</td>
                    <td style="padding:5px 12px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(foamSubtotalAmt)}</td>
                  </tr>` : ""}
                  ${packagingSubtotalAmt != null && packagingSubtotalAmt > 0 ? `<tr>
                    <td style="padding:5px 12px;font-size:12px;color:#9ca3af;">Packaging subtotal</td>
                    <td style="padding:5px 12px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(packagingSubtotalAmt)}</td>
                  </tr>` : ""}
                  ${artSetupFeeAmt != null && artSetupFeeAmt > 0 ? `<tr>
                    <td style="padding:5px 12px;font-size:12px;color:#9ca3af;">Art setup fee</td>
                    <td style="padding:5px 12px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(artSetupFeeAmt)}</td>
                  </tr>` : ""}
                  ${printingUpchargeAmtVal != null && printingUpchargeAmtVal > 0 ? `<tr>
                    <td style="padding:5px 12px;font-size:12px;color:#9ca3af;">Printing upcharge${printingUpchargePctVal != null && printingUpchargePctVal > 0 ? ` (${printingUpchargePctVal}%)` : ""}</td>
                    <td style="padding:5px 12px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(printingUpchargeAmtVal)}</td>
                  </tr>` : ""}
                  ${showGrand ? `<tr style="border-top:1px solid #1f2937;">
                    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#e5e7eb;">Total estimate (foam${packagingSubtotalAmt != null && packagingSubtotalAmt > 0 ? " + packaging" : ""}${hasPrintingLines ? " + printing" : ""})</td>
                    <td style="padding:8px 12px;font-size:15px;font-weight:800;color:#f97316;text-align:right;">${fmtMoney(grandTotalAmt)}</td>
                  </tr>` : `<tr style="border-top:1px solid #1f2937;">
                    <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#e5e7eb;">Estimated foam subtotal</td>
                    <td style="padding:8px 12px;font-size:15px;font-weight:800;color:#f97316;text-align:right;">${fmtMoney(pricing.total)}</td>
                  </tr>`}
                  <tr>
                    <td colspan="2" style="padding:4px 12px 10px 12px;font-size:11px;color:#6b7280;line-height:1.5;">
                      Rough shipping estimate: ${fmtMoney((grandTotalAmt ?? foamSubtotalAmt ?? pricing.total ?? 0) * 0.1)} (10% of order; for planning only). Final billing may adjust if specs, quantities, or services change.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
            })()}

            <!-- ══════════════════════════════════════════════ -->
            <!-- LINE ITEMS TABLE                               -->
            <!-- ══════════════════════════════════════════════ -->
            ${hasLineItems ? `<tr>
              <td style="padding:16px 26px 0 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;overflow:hidden;">
                  <tr>
                    <td colspan="5" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                      Line items
                    </td>
                  </tr>
                  <!-- Column headers -->
                  <tr style="background:rgba(15,23,42,0.5);">
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Item</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Dimensions (L×W×H in)</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;text-align:center;">Qty</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;text-align:right;">Unit price</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;text-align:right;">Line total</td>
                  </tr>
                  <!-- Section label: Foam materials -->
                  ${lineItems.some(i => !i.isPackaging) ? `<tr>
                    <td colspan="5" style="padding:6px 10px 3px 10px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#38bdf8;border-bottom:1px solid #0f172a;">FOAM MATERIALS</td>
                  </tr>` : ""}
                  ${lineItems.filter(i => !i.isPackaging).map((item, idx) => `
                  <tr style="${idx % 2 === 1 ? "background:rgba(15,23,42,0.5);" : ""}">
                    <td style="padding:6px 10px;font-size:12px;color:#e5e7eb;border-bottom:1px solid #111827;">
                      <div style="font-weight:${item.isIncluded ? "400" : "600"};">${item.label}</div>
                      ${item.sublabel ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${item.sublabel}</div>` : ""}
                    </td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;border-bottom:1px solid #111827;">${item.dims}</td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;text-align:center;border-bottom:1px solid #111827;">${item.qty}</td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;text-align:right;border-bottom:1px solid #111827;">${item.isIncluded ? "Included" : (item.unitPrice != null ? fmtMoney(item.unitPrice) : "—")}</td>
                    <td style="padding:6px 10px;font-size:12px;font-weight:${item.isIncluded ? "400" : "600"};color:${item.isIncluded ? "#9ca3af" : "#e5e7eb"};text-align:right;border-bottom:1px solid #111827;">${item.isIncluded ? "Included" : (item.lineTotal != null ? fmtMoney(item.lineTotal) : "—")}</td>
                  </tr>`).join("")}
                  <!-- Section label: Packaging (if any) -->
                  ${lineItems.some(i => i.isPackaging) ? `<tr>
                    <td colspan="5" style="padding:6px 10px 3px 10px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#a78bfa;border-bottom:1px solid #0f172a;border-top:1px solid #1f2937;">PACKAGING</td>
                  </tr>
                  ${lineItems.filter(i => i.isPackaging).map((item, idx) => `
                  <tr style="${idx % 2 === 1 ? "background:rgba(15,23,42,0.5);" : ""}">
                    <td style="padding:6px 10px;font-size:12px;color:#e5e7eb;border-bottom:1px solid #111827;">
                      <div style="font-weight:600;">${item.label}</div>
                      ${item.sublabel ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${item.sublabel}</div>` : ""}
                    </td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;border-bottom:1px solid #111827;">${item.dims}</td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;text-align:center;border-bottom:1px solid #111827;">${item.qty}</td>
                    <td style="padding:6px 10px;font-size:12px;color:#cbd5f5;text-align:right;border-bottom:1px solid #111827;">${item.unitPrice != null ? fmtMoney(item.unitPrice) : "—"}</td>
                    <td style="padding:6px 10px;font-size:12px;font-weight:600;color:#e5e7eb;text-align:right;border-bottom:1px solid #111827;">${item.lineTotal != null ? fmtMoney(item.lineTotal) : "—"}</td>
                  </tr>`).join("")}` : ""}
                  <!-- Totals row -->
                  <tr>
                    <td colspan="4" style="padding:8px 10px;font-size:12px;font-weight:700;color:#e5e7eb;text-align:right;border-top:1px solid #1f2937;">Total quantity</td>
                    <td style="padding:8px 10px;font-size:13px;font-weight:700;color:#f9fafb;text-align:right;border-top:1px solid #1f2937;">${specs.qty || "—"}</td>
                  </tr>
                  ${foamSubtotalAmt != null ? `<tr>
                    <td colspan="4" style="padding:3px 10px;font-size:12px;color:#9ca3af;text-align:right;">Foam subtotal</td>
                    <td style="padding:3px 10px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(foamSubtotalAmt)}</td>
                  </tr>` : ""}
                  ${packagingSubtotalAmt != null && packagingSubtotalAmt > 0 ? `<tr>
                    <td colspan="4" style="padding:3px 10px;font-size:12px;color:#9ca3af;text-align:right;">Packaging subtotal</td>
                    <td style="padding:3px 10px;font-size:12px;color:#cbd5f5;text-align:right;">${fmtMoney(packagingSubtotalAmt)}</td>
                  </tr>` : ""}
                  ${grandTotalAmt != null && grandTotalAmt > 0 ? `<tr>
                    <td colspan="4" style="padding:6px 10px 8px 10px;font-size:13px;font-weight:700;color:#e5e7eb;text-align:right;">Estimated subtotal (foam + packaging)</td>
                    <td style="padding:6px 10px 8px 10px;font-size:14px;font-weight:800;color:#f97316;text-align:right;">${fmtMoney(grandTotalAmt)}</td>
                  </tr>` : ""}
                </table>
              </td>
            </tr>` : ""}

            <!-- ══════════════════════════════════════════════ -->
            <!-- LAYER TEXT SUMMARY (no SVG/DXF downloads)     -->
            <!-- ══════════════════════════════════════════════ -->
            ${hasLayers ? `<tr>
              <td style="padding:16px 26px 0 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                      Foam layout package
                    </td>
                  </tr>
                  ${layoutNotes ? `<tr>
                    <td style="padding:8px 12px 4px 12px;font-size:12px;color:#cbd5f5;line-height:1.5;">
                      <span style="font-weight:600;color:#e5e7eb;">Notes:</span> ${layoutNotes}
                    </td>
                  </tr>` : ""}
                  <tr>
                    <td style="padding:8px 12px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding:4px 0;font-size:11px;font-weight:600;color:#9ca3af;width:30%;">Layer</td>
                          <td style="padding:4px 0;font-size:11px;font-weight:600;color:#9ca3af;width:25%;">Thickness</td>
                          <td style="padding:4px 0;font-size:11px;font-weight:600;color:#9ca3af;width:25%;">Pocket depth</td>
                          <td style="padding:4px 0;font-size:11px;font-weight:600;color:#9ca3af;">Material</td>
                        </tr>
                        ${layers.map(layer => `<tr>
                          <td style="padding:4px 0;font-size:12px;color:#e5e7eb;border-top:1px solid #111827;">Layer ${layer.index}/${layer.total}</td>
                          <td style="padding:4px 0;font-size:12px;color:#cbd5f5;border-top:1px solid #111827;">${layer.thickness_in != null ? `${layer.thickness_in} in` : "—"}</td>
                          <td style="padding:4px 0;font-size:12px;color:#cbd5f5;border-top:1px solid #111827;">${layer.pocket_depth_in != null ? `${layer.pocket_depth_in} in` : "—"}</td>
                          <td style="padding:4px 0;font-size:12px;color:#cbd5f5;border-top:1px solid #111827;">${layer.materialName || "—"}</td>
                        </tr>`).join("")}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ""}

            <!-- ══════════════════════════════════════════════ -->
            <!-- DUAL CTA: View Quote Page + Open Layout Editor -->
            <!-- ══════════════════════════════════════════════ -->
            ${(quotePageUrl || layoutUrl) ? `<tr>
              <td style="padding:16px 26px 0 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                      Next steps
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:10px 12px 14px 12px;font-size:12px;color:#e5e7eb;line-height:1.6;">
                      ${quotePageUrl && layoutUrl
                        ? `<p style="margin:0 0 10px 0;">View your full interactive quote, or open the layout editor to place cavity locations, sizes, and orientation.</p>
                           <table role="presentation" cellspacing="0" cellpadding="0">
                             <tr>
                               <td style="padding-right:10px;">
                                 <a href="${quotePageUrl}" style="display:inline-block;padding:9px 18px;border-radius:999px;border:1px solid #4b5563;background:#1f2937;color:#e5e7eb;font-size:12px;font-weight:600;text-decoration:none;">View quote</a>
                               </td>
                               <td>
                                 <a href="${layoutUrl}" style="display:inline-block;padding:9px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">Open layout editor</a>
                               </td>
                             </tr>
                           </table>`
                        : quotePageUrl
                          ? `<p style="margin:0 0 10px 0;">View your full interactive quote below.</p>
                             <a href="${quotePageUrl}" style="display:inline-block;padding:9px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">View quote</a>`
                          : `<p style="margin:0 0 10px 0;">Open the layout editor to place the cavities (size, location, and orientation).</p>
                             <a href="${layoutUrl}" style="display:inline-block;padding:9px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">Open layout editor</a>`}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : !layoutUrl ? `<tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.7;">
                      <p style="margin:0;">Once we finalize the details, I'll send over a formal quote and lead time.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ""}

            <!-- Bug / feedback card -->
            <tr>
              <td style="padding:16px 26px 24px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.7;">
                      <p style="margin:0 0 6px 0;">
                        See anything that looks off? Please help us improve your experience with Alex-IO.
                      </p>
                      <p style="margin:0;">
                        <a href="mailto:sales@alex-io.com?subject=Alex-IO%20quote%20bug%20or%20feedback" style="display:inline-block;margin-top:8px;padding:6px 14px;border-radius:999px;border:1px solid #4b5563;background:#111827;color:#e5e7eb;font-size:11px;font-weight:500;text-decoration:none;">
                          Report a bug or glitch
                        </a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>

          <!-- Footer / disclaimer -->
          <div style="max-width:680px;margin-top:10px;padding:0 26px;font-size:11px;color:#9ca3af;">
            <p style="margin:0;">
              This print view mirrors the core specs of your emailed quote. Actual charges may differ if specs or quantities change or if additional services are requested.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}