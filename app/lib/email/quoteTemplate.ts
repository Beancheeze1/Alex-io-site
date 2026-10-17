// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// The types here are aligned with app/api/ai/orchestrate/route.ts.
// Only HTML / styling and simple display helpers should be edited here.
//
// Step 36E: restyled to match the status emails (light card, the shop's logo /
// name and color, "Reply to this email" footer). The headline is the quote
// total; a rough shipping estimate is its own "not included" line. The
// revision shows only once the quote is released (caller passes revisionLabel).
//
// Step 21: the quote page and layout editor links in the email are the
// buyer's private edit links (editLinkUrl): opening one lets that browser
// change the quote. A bare quote number only lets someone view it.

import { editLinkUrl } from "@/lib/quote-edit-token";

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
  // Step 21: true = plain quote/layout links (previews shown to the caller),
  // not the buyer's private edit links.
  plainLinks?: boolean;
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
  printLabel?: string | null;             // per-color quotes: "Packaging – Printing plates (one time)"
  printSublabel?: string | null;          // per-color quotes: e.g. "2-color print (1 spot, 1 flood), one side"
  dieCuttingCharge?: number | null;
  dieCutTriggerQty?: number | null;
  // Step 23: cutting / lamination lines (replace the single die-cut line when present)
  processLines?: { key?: string; label: string; amount: number; note?: string | null }[] | null;
  grandTotal?: number | null;
  shippingEstimate?: number | null;   // rough shipping estimate, already capped
  shippingIsCapped?: boolean;
  roughShipPct?: number | null;
  shippingCapUsd?: number | null;
  layers?: TemplateLayoutLayer[] | null;
  layoutNotes?: string | null;
  quotePageUrl?: string | null;
  // Step 28: quote terms
  validUntil?: string | null; // e.g. "Nov 14, 2026"
  leadTime?: string | null;
  freightNote?: string | null; // Step 30: e.g. "Customer pickup (no freight)"
  // Step 36E: the shop's look (same as the status emails); revision only once released
  brand?: string | null;
  primaryColor?: string | null;
  onPrimary?: string | null;
  logoUrl?: string | null;
  buyerName?: string | null;
  revisionLabel?: string | null;
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
  // Step 36E: thousands separators, like the status emails ($1,369.63)
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const layoutUrlPlain =
    facts.layout_editor_url ||
    facts.layoutEditorUrl ||
    facts.layoutEditorLink ||
    buildLayoutUrl({ ...input, specs } as any);
  const layoutUrl = quoteNumber && !input.plainLinks ? editLinkUrl(layoutUrlPlain, quoteNumber) : layoutUrlPlain;

  // Quote page URL (interactive viewer)
  const _base2 = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const quotePageUrlPlain =
    input.quotePageUrl ||
    (quoteNumber ? `${_base2}/quote?quote_no=${encodeURIComponent(quoteNumber)}` : null);
  const quotePageUrl = quoteNumber && !input.plainLinks ? editLinkUrl(quotePageUrlPlain, quoteNumber) : quotePageUrlPlain;

  // Rich line items / totals (from print route)
  const lineItems = Array.isArray(input.lineItems) ? input.lineItems : [];
  const hasLineItems = lineItems.length > 0;
  const foamSubtotalAmt = input.foamSubtotal ?? null;
  const packagingSubtotalAmt = input.packagingSubtotal ?? null;
  const artSetupFeeAmt = input.artSetupFee ?? null;
  const printingUpchargePctVal = input.printingUpchargePct ?? null;
  const printingUpchargeAmtVal = input.printingUpchargeAmt ?? null;
  const printingUpchargeAmt = input.printingUpcharge ?? null;   // combined
  const dieCuttingChargeAmt = input.dieCuttingCharge ?? null;
  const dieCutTriggerQtyVal = input.dieCutTriggerQty ?? null;
  const grandTotalAmt = input.grandTotal ?? null;
  const shippingEstimateAmt = input.shippingEstimate ?? null;
  const shippingIsCappedVal = !!input.shippingIsCapped;
  const roughShipPctVal = input.roughShipPct ?? null;
  const shippingCapUsdVal = input.shippingCapUsd ?? null;
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
  const baseTotal = grandTotalAmt ?? (pricingPending ? null : pricing.total ?? null);
  const hasPackaging = packagingSubtotalAmt != null && packagingSubtotalAmt > 0;
  const hasPrinting  = printingUpchargeAmt != null && printingUpchargeAmt > 0;
  const processLinesVal = Array.isArray(input.processLines) ? input.processLines : [];
  const hasDieCutting =
    (dieCuttingChargeAmt != null && dieCuttingChargeAmt > 0) || processLinesVal.some((l) => Number(l.amount) > 0);
  const escText = (s: unknown) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const hasShipping = shippingEstimateAmt != null && shippingEstimateAmt > 0;
  // Step 28: how long the price is valid, and the lead time.
  const termsParts: string[] = [];
  if (input.validUntil) termsParts.push(`Price valid until ${escText(input.validUntil)}`);
  if (input.leadTime) termsParts.push(`Lead time: ${escText(input.leadTime)}`);
  // Step 30: freight terms when the freight isn't a priced line.
  if (input.freightNote) termsParts.push(escText(input.freightNote));
  void showHowBuilt; // retained for potential future use

  // ── Step 36E: same light, shop-branded style as the status emails ──
  // The headline total is the quote total (what the buyer accepts). A rough
  // shipping estimate (shops without freight set up) is its own line, NOT in it.
  const brand = (input.brand && String(input.brand).trim()) || "Alex-IO";
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const primary = input.primaryColor && HEX.test(input.primaryColor) ? input.primaryColor : "#2B2B28";
  const onPrimary = input.onPrimary && HEX.test(input.onPrimary) ? input.onPrimary : "#FFFFFF";
  // Escapes text; existing entities (e.g. "&ndash;" from older callers) are kept.
  const t = (v: unknown) =>
    String(v ?? "").replace(/&(?!#?[a-zA-Z0-9]+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const logo =
    input.logoUrl && /^https:\/\//i.test(input.logoUrl)
      ? `<img src="${t(input.logoUrl)}" alt="${t(brand)}" style="max-height:40px;max-width:200px;display:block">`
      : `<div style="font-size:16px;font-weight:700;color:#1c1c1a">${t(brand)}</div>`;
  const rev = input.revisionLabel && String(input.revisionLabel).trim() ? String(input.revisionLabel).trim() : null;
  const name = input.buyerName && String(input.buyerName).trim() && String(input.buyerName).trim() !== "Customer" ? String(input.buyerName).trim() : null;
  const cell = "padding:8px 0;border-bottom:1px solid #eeeeea;vertical-align:top";
  const lineRow = (label: string, sub: string[], amount: string) =>
    `<tr><td style="${cell}"><div style="font-size:13px;font-weight:600;color:#1c1c1a">${label}</div>${sub
      .filter(Boolean)
      .map((x) => `<div style="font-size:12px;color:#6b6b66;margin-top:1px">${x}</div>`)
      .join("")}</td><td style="${cell};text-align:right;white-space:nowrap;font-size:13px;font-weight:600;color:#1c1c1a">${amount}</td></tr>`;
  // Step 37J: a boxes-only quote has no foam: no foam size / quantity /
  // material facts and no layout editor link.
  const boxesOnly =
    String(facts.pack_type || "") === "boxes_only" || (lineItems.length > 0 && lineItems.every((li) => li.isPackaging));
  const qtyText = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US") : t(v as string));
  const buyerNotes = typeof facts.customer_notes === "string" && facts.customer_notes.trim() ? facts.customer_notes.trim().slice(0, 1000) : null;
  const rows: string[] = [];
  for (const li of lineItems) {
    rows.push(
      lineRow(
        t(li.label),
        [li.sublabel ? t(li.sublabel) : "", `${t(li.dims)} &middot; Qty ${qtyText(li.qty)}`],
        li.lineTotal != null ? fmtMoney(li.lineTotal) : li.isIncluded ? "Included" : "&mdash;",
      ),
    );
  }
  if (hasPrinting) rows.push(lineRow(t(input.printLabel ?? "Packaging &ndash; Print upcharge"), [t(input.printSublabel ?? "")], fmtMoney(printingUpchargeAmt as number)));
  if (processLinesVal.length > 0) {
    for (const l of processLinesVal) {
      rows.push(lineRow(t(l.label), [l.note ? t(l.note) : ""], fmtMoney(Number(l.amount) || 0)));
    }
  } else if (hasDieCutting) {
    rows.push(
      lineRow(
        "Die-cutting charge",
        [`Applied at qty ${dieCutTriggerQtyVal && dieCutTriggerQtyVal > 0 ? `&ge; ${dieCutTriggerQtyVal}` : "threshold"}`],
        fmtMoney(dieCuttingChargeAmt as number),
      ),
    );
  }
  const totalRow =
    baseTotal != null
      ? `<tr><td style="padding:10px 0 2px;font-size:14px;font-weight:700;color:#1c1c1a">Quote total</td><td style="padding:10px 0 2px;text-align:right;font-size:16px;font-weight:700;color:#1c1c1a" data-quote-total>${fmtMoney(baseTotal)}</td></tr>`
      : `<tr><td style="padding:10px 0 2px;font-size:14px;font-weight:700;color:#1c1c1a">Quote total</td><td style="padding:10px 0 2px;text-align:right;font-size:14px;color:#6b6b66">Pending</td></tr>`;
  const shipRow = hasShipping
    ? `<tr><td colspan="2" style="padding:4px 0 0;font-size:12px;color:#6b6b66" data-rough-shipping>Estimated shipping, not included: about ${fmtMoney(shippingEstimateAmt as number)}${
        shippingIsCappedVal ? ` (capped at ${fmtMoney(shippingCapUsdVal)})` : roughShipPctVal != null ? ` (${Number(roughShipPctVal)}% of the order)` : ""
      }. For planning only; freight is quoted separately.</td></tr>`
    : "";
  const facts2: [string, string][] = [
    ["Size", outsideSize],
    ["Quantity", qty],
    ["Material", `${t(specsMaterialLabel)}${matDensity !== "—" ? `, ${t(matDensity)}` : ""}`],
  ];
  const factRows = (boxesOnly ? [] : facts2)
    .filter(([, v]) => v && v !== "—")
    .map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#6b6b66;font-size:13px;white-space:nowrap">${k}</td><td style="padding:3px 0;font-size:13px;color:#1c1c1a;font-weight:600">${v}</td></tr>`)
    .join("");
  void showHowBuilt; // retained for potential future use
  void statusLabel;
  void logoUrl;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${t(brand)}: quote ${t(quoteNumber)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f6f4">
    <div style="background:#f6f6f4;padding:24px 8px;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#1c1c1a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px">
      <tr><td style="padding:18px 24px;border-bottom:3px solid ${primary}">${logo}</td></tr>
      <tr><td style="padding:24px">
        <h1 style="font-size:19px;line-height:1.3;margin:0 0 14px;color:#1c1c1a">Your quote is ready</h1>
        <p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#33332f">Hi ${name ? t(name) : "there"},</p>
        <p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#33332f">Here is quote ${t(quoteNumber)}${rev ? ` (revision ${t(rev)})` : ""} from ${t(brand)}. Open it to see the full details, ${boxesOnly ? "compare quantities" : "change the layout"}, or accept it.</p>
        ${factRows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 14px">${factRows}</table>` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px" data-quote-lines>
          ${rows.join("")}
          ${totalRow}
          ${shipRow}
        </table>
        ${buyerNotes ? `<p style="font-size:13px;line-height:1.55;margin:0 0 12px;color:#33332f;white-space:pre-wrap" data-quote-notes><strong>Your notes:</strong> ${t(buyerNotes)}</p>` : ""}
        ${termsParts.length ? `<p style="font-size:13px;line-height:1.55;margin:0 0 16px;color:#33332f" data-quote-terms>${termsParts.join(" &middot; ")}</p>` : ""}
        ${quotePageUrl ? `<a href="${t(quotePageUrl)}" style="display:inline-block;background:${primary};color:${onPrimary};text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">View your quote</a>` : ""}
        ${layoutUrl && !boxesOnly ? `<p style="font-size:13px;margin:14px 0 0;color:#6b6b66">Need to place cavities? <a href="${t(layoutUrl)}" style="color:#1c1c1a;font-weight:600">Open the layout editor</a></p>` : ""}
        <p style="font-size:12px;line-height:1.5;margin:16px 0 0;color:#6b6b66">This is an estimate until you accept it and ${t(brand)} confirms it. Prices can change if specs or quantities change.</p>
      </td></tr>
      <tr><td style="padding:14px 24px;border-top:1px solid #eeeeea;font-size:12px;color:#6b6b66">${t(brand)} &middot; Quote ${t(quoteNumber)}. Reply to this email with any questions.</td></tr>
    </table></td></tr></table></div>
  </body>
</html>`;
}