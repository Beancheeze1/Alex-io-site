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

export type TemplateInput = {
  customerLine?: string | null;
  quoteNumber?: string | null;
  status?: string;
  specs: TemplateSpecs;
  material: TemplateMaterial;
  pricing: TemplatePricing;
  missing: string[];
  facts?: Record<string, any>;
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
  const { quoteNumber, status, specs, material, pricing, missing } = input;

  const outsideSize = fmtInchesTriple(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const densityLabel =
    specs.density_pcf != null ? `${fmtNumber(specs.density_pcf, 1)} pcf` : "—";

  // ---------- Material / family labels (email + viewer alignment) ----------

  // IMPORTANT: We do NOT guess or normalize PE/EPE here.
  // We simply surface the material_family string coming from upstream/DB.
  const rawFamilyFromPricing =
    pricing.raw?.material_family != null
      ? String(pricing.raw.material_family).trim()
      : "";
  const rawFamilyFromSpecs =
    specs.foam_family != null ? String(specs.foam_family).trim() : "";

  // DB truth: prefer material_family from pricing.raw, then specs.foam_family.
  const foamFamily = rawFamilyFromPricing || rawFamilyFromSpecs || "";

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

  const matKerf = fmtPercent(material.kerf_pct ?? pricing.raw?.kerf_pct);

  const priceBreaks: PriceBreak[] = pricing.price_breaks ?? [];
  const layoutUrl = buildLayoutUrl(input);

  const showMissing = Array.isArray(missing) && missing.length > 0;
  const statusLabel = status || "draft";

  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const logoUrl = `${base}/alex-io-logo.png`;

  const facts: any = input.facts || {};
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

  const pieceCi = fmtNumber(pricing.piece_ci ?? pricing.raw?.piece_ci);
  const orderCi = fmtNumber(pricing.order_ci ?? pricing.raw?.order_ci);
  const orderCiWithWaste = fmtNumber(
    pricing.order_ci_with_waste ?? pricing.raw?.order_ci_with_waste,
  );

  const computedOrderTotal = fmtMoney(
    pricing.total ??
      pricing.raw?.price_total ??
      pricing.raw?.total ??
      pricing.raw?.order_total,
  );

  const computedUsedMinCharge =
    pricing.used_min_charge ?? pricing.raw?.min_charge_applied ?? false;

  // When pending, replace numeric-ish pricing fields with — / Pending (keep the same rows & layout).
  const minCharge = pricingPending
    ? "—"
    : material.min_charge != null
      ? fmtMoney(material.min_charge)
      : pricing.raw?.min_charge
        ? fmtMoney(pricing.raw.min_charge)
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

            <!-- Specs + Pricing -->
            <tr>
              <td style="padding:10px 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <!-- Specs card -->
                    <td style="vertical-align:top;width:52%;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:linear-gradient(145deg,#020617,#020617 40%,#020617 100%);">
                        <tr>
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                            Specs
                          </td>
                        </tr>
                        <tr>
                          <td style="width:42%;padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Outside size</td>
                          <td style="width:58%;padding:4px 10px;font-size:12px;color:#cbd5f5;">${outsideSize}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Quantity</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${qty}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Density</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${densityLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Min thickness under cavities</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${minThicknessUnder}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Material</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${specsMaterialLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Color</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${specs.color || "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Skiving</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${skivingNote}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Cavities</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${cavityLabel}</td>
                        </tr>
                      </table>
                    </td>

                    <!-- Pricing card -->
                    <td style="vertical-align:top;width:48%;padding-left:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:linear-gradient(145deg,#020617,#020617 40%,#020617 100%);">
                        <tr>
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                            Pricing
                          </td>
                        </tr>
                        <tr>
                          <td style="width:48%;padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Material</td>
                          <td style="width:52%;padding:4px 10px;font-size:12px;color:#cbd5f5;">${matName}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Density</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${matDensity}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Kerf allowance</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${matKerf}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Piece volume</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            pieceCi !== "—" ? `${pieceCi} in³` : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Order volume</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            orderCi !== "—" ? `${orderCi} in³` : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">With waste</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            orderCiWithWaste !== "—" ? `${orderCiWithWaste} in³` : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Min charge</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${minCharge}${
                            pricingPending
                              ? ""
                              : usedMinCharge
                                ? " (applied)"
                                : " (not applied on this run)"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Order total</td>
                          <td style="padding:4px 10px;font-size:13px;font-weight:700;color:#f97316;">${orderTotal}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Applied</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${appliedLabel}</td>
                        </tr>
                        ${
                          showHowBuilt
                            ? `<!-- How this price is built -->
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">How this price is built</td>
                          <td style="padding:4px 10px;font-size:11px;color:#cbd5f5;line-height:1.5;">
                            Behind the scenes, this estimate is based on the block volume (piece size × quantity), a kerf/waste allowance, and any minimum charge shown above.
                          </td>
                        </tr>`
                            : ""
                        }
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              priceBreaks.length > 1
                ? `<tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td colspan="4" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.2),rgba(15,23,42,1));border-radius:14px 14px 0 0;">
                      Price breaks
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Qty</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Unit</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Extended</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Notes</td>
                  </tr>
                  ${priceBreaks
                    .map(
                      (br, idx) => `
                        <tr style="${idx % 2 === 1 ? "background:rgba(15,23,42,0.85);" : ""}">
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${br.qty}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${priceBreakUnit(br)}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${fmtMoney(br.total)}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#9ca3af;">${br.note || ""}</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </table>
              </td>
            </tr>`
                : ""
            }

            ${
              showMissing
                ? `<tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #7f1d1d;background:#450a0a;">
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #7f1d1d;font-size:12px;font-weight:600;color:#fee2e2;background:linear-gradient(90deg,#b91c1c,#450a0a);border-radius:14px 14px 0 0;">
                      Items we still need to finalize
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;font-size:12px;color:#fee2e2;line-height:1.6;">
                      <ul style="margin:0;padding-left:18px;">
                        ${missing.map((m) => `<li style="margin-bottom:2px;">${m}</li>`).join("")}
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
                : ""
            }

            <!-- Explanation / next steps -->
            <tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.7;">
                      ${
                        layoutUrl
                          ? `<p style="margin:0 0 6px 0;">
                        The next step is to open the foam layout editor and place the cavities where you want them in the block (size, location, and orientation).
                      </p>`
                          : ""
                      }
                      <p style="margin:0;">
                        Once we finalize the details, I'll send over a formal quote and lead time.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              layoutUrl
                ? `<tr>
              <td style="padding:0 26px 22px 26px;text-align:center;">
                <a href="${layoutUrl}" style="display:inline-block;padding:8px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">
                  View foam layout editor
                </a>
              </td>
            </tr>`
                : ""
            }

            <!-- Bug / feedback card -->
            <tr>
              <td style="padding:0 26px 22px 26px;">
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
              This first pass was generated by Alex-IO (AI assistant) from the information you provided. A human will review and confirm the quote before anything is cut.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
