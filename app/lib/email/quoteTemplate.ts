// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
// Presentation-only logic. No parsing or pricing math here.

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

export type PriceBreak = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
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

function fmtPercent(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(2)}%`;
}

function fmtQty(q: number | string | null | undefined): string {
  if (q == null) return "—";
  if (typeof q === "string" && !q.trim()) return "—";
  return String(q);
}

function buildCavityLabel(specs: TemplateSpecs): string {
  const count = specs.cavityCount ?? (specs.cavityDims?.length || 0);
  const dims = (specs.cavityDims || []).filter(Boolean);
  if (!count && !dims.length) return "—";
  const label = count === 1 ? "1 cavity" : `${count} cavities`;
  return dims.length ? `${label} — ${dims.join(", ")}` : label;
}

function computeMinThicknessUnder(specs: TemplateSpecs): number | null {
  if (specs.thickness_under_in != null) {
    const n = Number(specs.thickness_under_in);
    return isNaN(n) ? null : n;
  }
  if (!specs.H_in || !Array.isArray(specs.cavityDims)) return null;
  let min: number | null = null;
  for (const d of specs.cavityDims) {
    const parts = d.split(/x|×/i);
    if (parts.length < 3) continue;
    const depth = Number(parts[2]);
    if (isNaN(depth)) continue;
    const under = specs.H_in - depth;
    if (min === null || under < min) min = under;
  }
  return min;
}

function buildLayoutUrl(input: TemplateInput): string | null {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const qno =
    input.quoteNumber ||
    (typeof input.facts?.quote_no === "string"
      ? input.facts.quote_no
      : "");
  if (!qno) return null;

  const { L_in, W_in, H_in } = input.specs;
  if (!L_in || !W_in || !H_in) return null;

  const params = new URLSearchParams();
  params.set("quote_no", qno);
  params.set("dims", `${L_in}x${W_in}x${H_in}`);

  if (input.specs.cavityDims?.length) {
    params.set("cavities", input.specs.cavityDims.join(","));
  }

  return `${base}/quote/layout?${params.toString()}`;
}

export function renderQuoteEmail(input: TemplateInput): string {
  const { quoteNumber, status, specs, material, pricing, missing } = input;

  const pricingReady =
    Number.isFinite(Number(pricing.total)) &&
    Number(pricing.total) > 0;

  const outsideSize = fmtInchesTriple(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const densityLabel =
    specs.density_pcf != null
      ? `${fmtNumber(specs.density_pcf, 1)} pcf`
      : "—";

  const foamFamily =
    pricing.raw?.material_family ||
    specs.foam_family ||
    material.name ||
    "—";

  const cavityLabel = buildCavityLabel(specs);
  const minThicknessVal = computeMinThicknessUnder(specs);
  const minThickness =
    minThicknessVal != null ? `${fmtNumber(minThicknessVal, 2)} in` : "—";

  const matDensity =
    material.density_lbft3 != null
      ? `${fmtNumber(material.density_lbft3, 1)} lb/ft³`
      : densityLabel;

  const matKerf = fmtPercent(material.kerf_pct);
  const minCharge = pricingReady
    ? fmtNumber(material.min_charge)
    : "—";

  const pieceCi = pricingReady ? fmtNumber(pricing.piece_ci) : "—";
  const orderCi = pricingReady ? fmtNumber(pricing.order_ci) : "—";
  const orderCiWaste = pricingReady
    ? fmtNumber(pricing.order_ci_with_waste)
    : "—";

  const orderTotal = pricingReady
    ? `$${Number(pricing.total).toFixed(2)}`
    : "Pending";

  const appliedText = pricingReady
    ? pricing.used_min_charge
      ? "Minimum charge applied"
      : "Calculated from volume"
    : "Pending (need dimensions)";

  const layoutUrl = buildLayoutUrl(input);
  const showMissing = missing?.length > 0;

  /* ---- HTML BELOW (unchanged except text substitutions above) ---- */
  // ⬇️ intentionally unchanged layout/styling from here down ⬇️

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:680px;margin:24px auto;background:#0f172a;border-radius:18px;border:1px solid #1f2937;padding:24px;color:#e5e7eb;">
      <h2 style="margin:0 0 6px 0;">Quote ${quoteNumber || ""}</h2>
      <p style="margin:0 0 18px 0;">${input.customerLine || ""}</p>

      <h3>Specs</h3>
      <p>Outside size: ${outsideSize}</p>
      <p>Quantity: ${qty}</p>
      <p>Density: ${densityLabel}</p>
      <p>Min thickness under cavities: ${minThickness}</p>
      <p>Material: ${foamFamily}</p>
      <p>Color: ${specs.color || "—"}</p>
      <p>Cavities: ${cavityLabel}</p>

      <h3>Pricing</h3>
      <p>Material: ${foamFamily}</p>
      <p>Density: ${matDensity}</p>
      <p>Kerf allowance: ${matKerf}</p>
      <p>Piece volume: ${pieceCi === "—" ? "—" : pieceCi + " in³"}</p>
      <p>Order volume: ${orderCi === "—" ? "—" : orderCi + " in³"}</p>
      <p>With waste: ${orderCiWaste === "—" ? "—" : orderCiWaste + " in³"}</p>
      <p>Min charge: ${minCharge}</p>
      <p><strong>Order total: ${orderTotal}</strong></p>
      <p>${appliedText}</p>

      ${
        showMissing
          ? `<div style="margin-top:16px;padding:12px;background:#450a0a;border-radius:12px;">
              <strong>Items we still need to finalize:</strong>
              <ul>${missing.map((m) => `<li>${m}</li>`).join("")}</ul>
            </div>`
          : ""
      }

      ${
        layoutUrl
          ? `<div style="margin-top:18px;">
              <a href="${layoutUrl}" style="display:inline-block;padding:8px 18px;border-radius:999px;background:#0ea5e9;color:#0f172a;text-decoration:none;">
                View foam layout editor
              </a>
            </div>`
          : ""
      }
    </div>
  </body>
</html>`;
}
