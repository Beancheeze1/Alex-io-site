// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// The types here are aligned with app/api/ai/orchestrate/route.ts.
// Only HTML / styling should be edited when refining the template look.

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
  const thicknessUnder =
    specs.thickness_under_in != null
      ? `${fmtNumber(specs.thickness_under_in, 2)} in`
      : "—";

  const cavityLabel = buildCavityLabel(specs);

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

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Foam quote${quoteNumber ? " " + quoteNumber : ""}</title>
  </head>
  <body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f172a;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="background:#0b1120;border-radius:18px;border:1px solid #1e293b;overflow:hidden;box-shadow:0 22px 45px rgba(15,23,42,0.7);">
            
            <!-- Header -->
            <tr>
              <td style="padding:18px 24px 14px 24px;border-bottom:1px solid #1e293b;background:linear-gradient(135deg,#0ea5e9 0%,#0369a1 45%,#0b1120 100%);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <table role="presentation" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding-right:10px;">
                            <!-- Circle logo -->
                            <div style="width:36px;height:36px;border-radius:999px;background:#0f172a;border:1px solid rgba(148,163,184,0.4);display:flex;align-items:center;justify-content:center;color:#e0f2fe;font-weight:700;font-size:14px;letter-spacing:0.12em;">
                              AI
                            </div>
                          </td>
                          <td>
                            <div style="font-size:15px;font-weight:600;color:#f9fafb;">Alex-IO foam quote</div>
                            <div style="font-size:12px;color:#e0f2fe;opacity:0.9;">
                              Quote${quoteNumber ? ` · <span style="font-weight:600;color:#f9fafb;">${quoteNumber}</span>` : ""} 
                              &nbsp;·&nbsp;
                              <span style="text-transform:capitalize;">Status: ${statusLabel}</span>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td style="vertical-align:middle;text-align:right;">
                      <span style="display:inline-block;font-size:11px;font-weight:500;color:#e0f2fe;padding:5px 10px;border-radius:999px;border:1px solid rgba(226,232,240,0.7);background:rgba(15,23,42,0.35);backdrop-filter:blur(8px);">
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
            <tr>
              <td style="padding:10px 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <!-- Specs card -->
                    <td style="vertical-align:top;width:52%;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:linear-gradient(145deg,#020617,#020617 40%,#020617 100%);">
                        <tr>
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.14),rgba(15,23,42,0.8));">
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
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Thickness under part</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${thicknessUnder}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Material</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${foamFamily}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Color</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${specs.color || "—"}</td>
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
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.14),rgba(15,23,42,0.8));">
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
                            orderCiWithWaste !== "—"
                              ? `${orderCiWithWaste} in³`
                              : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Min charge</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${minCharge}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Order total</td>
                          <td style="padding:4px 10px;font-size:13px;font-weight:700;color:#f97316;">${orderTotal}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Applied</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">
                            ${
                              usedMinCharge
                                ? "Minimum charge applied"
                                : "Calculated from volume"
                            }
                          </td>
                        </tr>
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
                    <td colspan="4" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.16),rgba(15,23,42,1));">
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
                        <tr style="${
                          idx % 2 === 1
                            ? "background:rgba(15,23,42,0.8);"
                            : ""
                        }">
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${br.qty}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${priceBreakUnit(
                            br,
                          )}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${fmtMoney(
                            br.total,
                          )}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#9ca3af;">${
                            br.note || ""
                          }</td>
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
                    <td style="padding:8px 12px;border-bottom:1px solid #7f1d1d;font-size:12px;font-weight:600;color:#fee2e2;background:linear-gradient(90deg,#b91c1c,#450a0a);">
                      Items we still need to finalize
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;font-size:12px;color:#fee2e2;line-height:1.6;">
                      <ul style="margin:0;padding-left:18px;">
                        ${missing
                          .map(
                            (m) =>
                              `<li style="margin-bottom:2px;">${m}</li>`,
                          )
                          .join("")}
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
                      <p style="margin:0 0 6px 0;">
                        If this layout and price range look close to what you had in mind, reply to this email with any tweaks or questions.
                      </p>
                      ${
                        layoutUrl
                          ? `<p style="margin:0 0 6px 0;">
                        When you're ready, I can also share a printable layout showing how the parts nest into the foam (including cavity size and orientation).
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
              <td style="padding:0 26px 22px 26px;">
                <a href="${layoutUrl}" style="display:inline-block;padding:8px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">
                  View foam layout editor
                </a>
              </td>
            </tr>`
                : ""
            }

          </table>

          <!-- Footer / disclaimer -->
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
