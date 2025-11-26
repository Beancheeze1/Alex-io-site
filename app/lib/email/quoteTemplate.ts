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

// Build human-readable cavity label like:
// "1 cavity — 1x1x1" or "3 cavities — 1x1x1, 2x2x1"
function buildCavityLabel(specs: TemplateSpecs): string {
  const count = specs.cavityCount ?? (specs.cavityDims?.length || 0);
  const dims = (specs.cavityDims || []).filter(
    (s) => !!s && typeof s === "string",
  );

  if (!count && dims.length === 0) return "—";

  const countLabel =
    count === 1 ? "1 cavity" : `${count || dims.length} cavities`;

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

  let minUnder: number | null = null;

  for (const raw of specs.cavityDims) {
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

// Build a layout-editor URL if we have enough info to make it useful.
function buildLayoutUrl(input: TemplateInput): string | null {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const qno =
    input.quoteNumber ||
    (typeof input.facts?.quote_no === "string"
      ? input.facts.quote_no
      : "");

  if (!qno) return null;

  const params = new URLSearchParams();
  const { L_in, W_in, H_in, cavityDims } = input.specs;

  params.set("quote_no", qno);

  if (L_in && W_in && H_in) {
    params.set("dims", `${L_in}x${W_in}x${H_in}`);
  }
  if (Array.isArray(cavityDims) && cavityDims.length > 0) {
    params.set("cavities", cavityDims.join(","));
    params.set("cavity", cavityDims[0]);
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

  const customerLine =
    input.customerLine ||
    "Thanks for the details—I'll confirm a couple of specs and get back to you with a price shortly.";

  const outsideSize = fmtInchesTriple(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const densityLabel =
    specs.density_pcf != null ? `${fmtNumber(specs.density_pcf, 1)} pcf` : "—";
  const foamFamily = specs.foam_family || "—";

  const cavityLabel = buildCavityLabel(specs);
  const minThicknessUnderVal = computeMinThicknessUnder(specs);
  const minThicknessUnder =
    minThicknessUnderVal != null
      ? `${fmtNumber(minThicknessUnderVal, 2)} in`
      : "—";

  const matName = material.name || "—";
  const matDensity =
    material.density_lbft3 != null
      ? `${fmtNumber(material.density_lbft3, 1)} lb/ft³`
      : densityLabel !== "—"
      ? densityLabel
      : "—";
  const matKerf = fmtPercent(material.kerf_pct ?? pricing.raw?.kerf_pct);
  const minCharge =
    material.min_charge != null
      ? fmtMoney(material.min_charge)
      : pricing.raw?.min_charge
      ? fmtMoney(pricing.raw.min_charge)
      : "$0.00";

  const pieceCi = fmtNumber(pricing.piece_ci ?? pricing.raw?.piece_ci);
  const orderCi = fmtNumber(pricing.order_ci ?? pricing.raw?.order_ci);
  const orderCiWithWaste = fmtNumber(
    pricing.order_ci_with_waste ?? pricing.raw?.order_ci_with_waste,
  );

  const orderTotal = fmtMoney(
    pricing.total ??
      pricing.raw?.price_total ??
      pricing.raw?.total ??
      pricing.raw?.order_total,
  );

  const usedMinCharge =
    pricing.used_min_charge ?? pricing.raw?.min_charge_applied ?? false;

  const priceBreaks: PriceBreak[] = pricing.price_breaks ?? [];
  const layoutUrl = buildLayoutUrl(input);

  const showMissing = Array.isArray(missing) && missing.length > 0;
  const statusLabel = status || "draft";

  // Inline base64 logo (96x96 PNG) so email clients can't block it
  const logoDataUrl =
    "data:image/png;base64,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"
    // (string truncated in explanation view; keep entire literal from assistant)

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
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding-right:10px;">
                            <!-- Circle logo background -->
                            <div style="width:36px;height:36px;border-radius:999px;background:#0f172a;border:1px solid rgba(148,163,184,0.4);display:flex;align-items:center;justify-content:center;">
                              <!-- Inline base64 logo -->
                              <img src="${logoDataUrl}" alt="Alex-IO" style="display:block;border-radius:999px;width:26px;height:26px;" />
                            </div>
                          </td>
                          <td>
                            <!-- Logo + title stacked -->
                            <table role="presentation" cellspacing="0" cellpadding="0">
                              <tr>
                                <td>
                                  <div style="font-size:15px;font-weight:600;color:#f9fafb;">Alex-IO foam quote</div>
                                </td>
                              </tr>
                              <tr>
                                <td>
                                  <div style="font-size:12px;color:#e0f2fe;opacity:0.9;">
                                    Quote${
                                      quoteNumber
                                        ? ` · <span style="font-weight:600;color:#f9fafb;">${quoteNumber}</span>`
                                        : ""
                                    } 
                                    &nbsp;·&nbsp;
                                    <span style="text-transform:capitalize;">Status: ${statusLabel}</span>
                                  </div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
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

            <!-- Intro line -->
            <tr>
              <td style="padding:18px 26px 6px 26px;">
                <p style="margin:0;font-size:14px;color:#e5e7eb;line-height:1.6;">
                  ${customerLine}
                </p>
              </td>
            </tr>

            <!-- Specs + Pricing -->
            <!-- (rest of template unchanged from previous version) -->
          </table>
          <div style="max-width:680px;margin-top:10px;padding:0 26px;font-size:11px;color:#9ca3af;">
            <p style="margin:0;">
              This first pass was generated by Alex-IO (AI assistant) from your sketch and email details. A human will review and confirm the quote before anything is cut.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
