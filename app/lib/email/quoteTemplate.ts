// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Input shape (from orchestrator):
//
// templateInput = {
//   customerLine: string,
//   quoteNumber: string | null,
//   status: string,
//   specs: {
//     L_in: number;
//     W_in: number;
//     H_in: number;
//     qty: number | string | null;
//     density_pcf: number | null;
//     foam_family: string | null;
//     thickness_under_in?: number | null;
//     color?: string | null;
//     cavityCount?: number | null;
//     cavityDims?: string[];          // e.g. ["1x1x1", "2x2x1"]
//   },
//   material: {
//     name?: string | null;
//     density_lbft3?: number | null;
//     kerf_pct?: number | null;
//     min_charge?: number | null;
//   },
//   pricing: {
//     total: number;
//     piece_ci?: number | null;
//     order_ci?: number | null;
//     order_ci_with_waste?: number | null;
//     used_min_charge?: boolean | null;
//     raw?: any;
//     price_breaks?: {
//       qty: number;
//       total: number;
//       piece: number | null;
//       used_min_charge?: boolean | null;
//     }[];
//   },
//   missing: string[];                // e.g. ["Cavity sizes"]
//   facts: Record<string, any>;       // raw facts (for layout URL, etc.)
// };

export type PriceBreak = {
  qty: number;
  piece: number | null;
  total: number;
  used_min_charge?: boolean | null;
};

export type TemplateSpecs = {
  L_in: number;
  W_in: number;
  H_in: number;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family: string | null;
  thickness_under_in?: number | null;
  color?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[];
};

export type TemplateMaterial = {
  name?: string | null;
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
  facts?: Record<string, any>;   // <-- make it optional
};

function fmtInchesTriple(
  L: number | null | undefined,
  W: number | null | undefined,
  H: number | null | undefined,
): string {
  if (L == null || W == null || H == null) return "—";
  return `${fmtNumber(L, 2)} × ${fmtNumber(W, 2)} × ${fmtNumber(H, 2)} in`;
}

function fmtNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value == null || !isFinite(value)) return "—";
  return value.toFixed(decimals).replace(/\.00$/, "");
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return "$" + value.toFixed(2);
}

function fmtPercent(value: number | null | undefined): string {
  if (value == null || !isFinite(value)) return "—";
  return value.toFixed(1).replace(/\.0$/, "") + "%";
}

function fmtQty(q: number | string | null | undefined): string {
  if (q == null || q === "") return "—";
  return String(q);
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build human-readable cavity label like:
// "1 cavity — 1x1x1" or "3 cavities — 1x1x1, 2x2x1"
function buildCavityLabel(specs: TemplateSpecs): string {
  const count = specs.cavityCount ?? (specs.cavityDims?.length || 0);
  const dims = (specs.cavityDims || []).filter((s) => !!s && typeof s === "string");

  if (!count && dims.length === 0) return "—";

  const countLabel =
    count === 1
      ? "1 cavity"
      : `${count} cavities`;

  const dimsLabel = dims.length
    ? " — " + dims.join(", ")
    : "";

  return countLabel + dimsLabel;
}

// Build the layout editor URL based on facts/specs.
function buildLayoutUrl(input: TemplateInput): string | null {
  const { quoteNumber, specs, facts } = input;
  if (!quoteNumber) return null;

  const base =
    (process.env.NEXT_PUBLIC_BASE_URL as string | undefined) ||
    "https://api.alex-io.com";

  const url = new URL(base.replace(/\/+$/, "") + "/quote/layout", "https://api.alex-io.com");

  url.searchParams.set("quote_no", quoteNumber);

  const L = specs.L_in;
  const W = specs.W_in;
  const H = specs.H_in;

  if (L && W && H) {
    url.searchParams.set("block", `${L}x${W}x${H}`);
  }

  if (specs.cavityDims && specs.cavityDims.length > 0) {
    url.searchParams.set("cavities", specs.cavityDims.join(","));
  }

  if (specs.qty != null && specs.qty !== "") {
    url.searchParams.set("qty", String(specs.qty));
  }

  // Allow facts to override / add extra params later if needed.
  if (facts && typeof facts === "object") {
    if (facts["layout_zoom"]) {
      url.searchParams.set("zoom", String(facts["layout_zoom"]));
    }
  }

  return url.toString();
}

export function renderQuoteEmail(input: TemplateInput): string {
  const { quoteNumber, status, specs, material, pricing, missing } = input;

  const customerLine =
    input.customerLine ||
    "Thanks for the details—I'll review a couple of specifications and get back to you with a price shortly.";

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
      ? `${fmtNumber(material.density_lbft3, 1)} pcf`
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

  const usedMinCharge =
    pricing.used_min_charge ?? pricing.raw?.min_charge_applied ?? false;

  const priceBreaks = (pricing.price_breaks || []) as PriceBreak[];
  const layoutUrl = buildLayoutUrl(input);

  const showMissing = Array.isArray(missing) && missing.length > 0;

  const statusLabel = status || "draft";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Foam quote${quoteNumber ? " " + quoteNumber : ""}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px 8px 24px;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Alex-IO automated foam quote</div>
                <div style="font-size:18px;font-weight:600;color:#111827;">
                  ${
                    quoteNumber
                      ? `<span style="font-weight:500;color:#6b7280;">Quote</span>
                         <span style="margin-left:4px;font-weight:600;color:#111827;">${quoteNumber ?? ""}</span>`
                      : "Foam quote"
                  }
                </div>
                <div style="display:inline-block;padding:2px 8px;margin-top:8px;border-radius:999px;background:#e5edff;color:#1f2937;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.03em;">
                  ${statusLabel}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 8px 24px;font-size:14px;color:#111827;">
                <p style="margin:0 0 8px 0;">Hi there,</p>
                <p style="margin:0 0 8px 0;">${escapeHtml(customerLine)}</p>
              </td>
            </tr>

            <tr>
              <td style="padding:0 24px 16px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:top;padding:0 16px 16px 0;">
                      <!-- Specs card -->
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
                        <tr>
                          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                            <div style="font-size:13px;font-weight:600;color:#374151;">Specs</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 12px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:12px;color:#374151;">
                              <tr>
                                <td style="padding:2px 0;width:40%;color:#6b7280;">Outside size</td>
                                <td style="padding:2px 0;">${outsideSize}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Quantity</td>
                                <td style="padding:2px 0;">${qty}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Foam family</td>
                                <td style="padding:2px 0;">${escapeHtml(foamFamily)}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Density</td>
                                <td style="padding:2px 0;">${densityLabel}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Under thickness</td>
                                <td style="padding:2px 0;">${thicknessUnder}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Color</td>
                                <td style="padding:2px 0;">${escapeHtml(specs.color || "—")}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Cavities</td>
                                <td style="padding:2px 0;">${escapeHtml(cavityLabel)}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>

                    <td style="vertical-align:top;padding:0 0 16px 0;">
                      <!-- Material card -->
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
                        <tr>
                          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                            <div style="font-size:13px;font-weight:600;color:#374151;">Material</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 12px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:12px;color:#374151;">
                              <tr>
                                <td style="padding:2px 0;width:40%;color:#6b7280;">Grade</td>
                                <td style="padding:2px 0;">${escapeHtml(matName)}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Density</td>
                                <td style="padding:2px 0;">${matDensity}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Kerf</td>
                                <td style="padding:2px 0;">${matKerf}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Min charge</td>
                                <td style="padding:2px 0;">${minCharge}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <div style="height:8px;"></div>

                      <!-- Pricing card -->
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
                        <tr>
                          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
                            <div style="font-size:13px;font-weight:600;color:#374151;">Pricing</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:10px 12px;">
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:12px;color:#374151;">
                              <tr>
                                <td style="padding:2px 0;width:40%;color:#6b7280;">Total</td>
                                <td style="padding:2px 0;">${fmtMoney(pricing.total)}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Piece volume</td>
                                <td style="padding:2px 0;">${pieceCi} in³</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Order volume</td>
                                <td style="padding:2px 0;">${orderCi} in³</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Order volume (with waste)</td>
                                <td style="padding:2px 0;">${orderCiWithWaste} in³</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Min charge used?</td>
                                <td style="padding:2px 0;">${usedMinCharge ? "Yes" : "No"}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                ${
                  priceBreaks.length
                    ? `<div style="font-size:13px;font-weight:600;color:#1f2933;margin:16px 0 4px 0;">Price breaks</div>
                       <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px;color:#374151;">
                         <tr>
                           <th align="left" style="padding:6px 8px;border:1px solid #d1d5db;background:#eff6ff;">Qty</th>
                           <th align="left" style="padding:6px 8px;border:1px solid #d1d5db;background:#eff6ff;">Piece</th>
                           <th align="left" style="padding:6px 8px;border:1px solid #d1d5db;background:#eff6ff;">Total</th>
                           <th align="left" style="padding:6px 8px;border:1px solid #d1d5db;background:#eff6ff;">Min charge?</th>
                         </tr>
                         ${priceBreaks
                           .map((pb) => {
                             const perPiece =
                               pb.piece != null && !isNaN(Number(pb.piece))
                                 ? fmtMoney(pb.piece)
                                 : "—";
                             const total =
                               pb.total != null && !isNaN(Number(pb.total))
                                 ? fmtMoney(pb.total)
                                 : "—";
                             const usedMC = pb.used_min_charge ? "Yes" : "No";
                             return `<tr>
                               <td style="padding:6px 8px;border:1px solid #d1d5db;">${fmtQty(pb.qty)}</td>
                               <td style="padding:6px 8px;border:1px solid #d1d5db;">${perPiece}</td>
                               <td style="padding:6px 8px;border:1px solid #d1d5db;">${total}</td>
                               <td style="padding:6px 8px;border:1px solid #d1d5db;">${usedMC}</td>
                             </tr>`;
                           })
                           .join("")}
                       </table>`
                    : ""
                }

                ${
                  showMissing
                    ? `<div style="margin-top:16px;padding:8px 10px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:12px;">
                         <div style="font-weight:600;margin-bottom:4px;">Heads up</div>
                         <div>I'm missing a few details that might affect the final price:</div>
                         <ul style="margin:4px 0 0 18px;padding:0;">
                           ${missing!
                             .map(
                               (m) =>
                                 `<li style="margin:2px 0;">${escapeHtml(m)}</li>`,
                             )
                             .join("")}
                         </ul>
                       </div>`
                    : ""
                }

                ${
                  layoutUrl
                    ? `<div style="margin-top:16px;">
                         <a href="${layoutUrl}" style="display:inline-block;padding:9px 18px;border-radius:999px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">View &amp; edit layout</a>
                       </div>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 20px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px 0;">
                  This quote was generated automatically from your email by Alex-IO.
                  If any of the specs above don’t look right, you can reply to this email
                  or use the layout button above to adjust the foam layout.
                </p>
                <p style="margin:4px 0 0 0;">
                  Actual charges may differ if specs or quantities change or if additional services are requested.
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
