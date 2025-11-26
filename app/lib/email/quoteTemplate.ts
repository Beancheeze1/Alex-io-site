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
//     foam_family?: string | null;
//     thickness_under_in?: number | null;
//     thickness_over_in?: number | null;
//     cut_loss_pct?: number | null;
//     lost_dims?: string | null;
//     cavityCount?: number | null;
//     cavityDims?: string[];
//     color?: string | null;
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
//     used_min_charge?: boolean;
//     raw?: any;
//     price_breaks?: PriceBreak[] | null;
//   },
//   missing?: string[] | null;
// };

export type TemplateSpecs = {
  L_in: number;
  W_in: number;
  H_in: number;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family?: string | null;
  // NOTE: keep *_in names to match existing callers (e.g. /app/api/ai/quote/route.ts)
  thickness_under_in?: number | null;
  thickness_over_in?: number | null;
  cut_loss_pct?: number | null;
  lost_dims?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[];
  color?: string | null;
};

export type TemplateMaterial = {
  name?: string | null;
  density_lbft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

export type PriceBreak = {
  qty: number;
  piece?: number | null;
  total?: number | null;
  used_min_charge?: boolean | null;
};

export type TemplatePricing = {
  total: number;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean;
  // Loosen this to match whatever /api/ai/quote is already passing through.
  raw?: any;
  price_breaks?: PriceBreak[] | null;
};

export type TemplateInput = {
  customerLine?: string;
  // 🔽 made optional to match existing callers
  quoteNumber?: string | null;
  status?: string;
  specs: TemplateSpecs;
  material: TemplateMaterial;
  pricing: TemplatePricing;
  missing?: string[] | null;
};

function fmtInchesTriple(L: number | null | undefined, W: number | null | undefined, H: number | null | undefined) {
  if (L == null || W == null || H == null) return "—";
  return `${fmtNumber(L, 2)} × ${fmtNumber(W, 2)} × ${fmtNumber(H, 2)} in`;
}

function fmtQty(qty: number | string | null | undefined): string {
  if (qty == null || qty === "") return "—";
  if (typeof qty === "string") return qty;
  if (!isFinite(qty)) return String(qty);
  return new Intl.NumberFormat("en-US").format(qty);
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

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build the layout editor URL for a given quote/specs.
function buildLayoutUrl(input: TemplateInput): string | null {
  const { quoteNumber, specs } = input;
  if (!quoteNumber) return null;

  const base =
    (process.env.NEXT_PUBLIC_BASE_URL as string | undefined) ||
    "https://api.alex-io.com";

  const url = new URL(base.replace(/\/+$/, "") + "/quote/layout", "https://api.alex-io.com");

  url.searchParams.set("quote_no", quoteNumber);

  if (specs.L_in != null && specs.W_in != null && specs.H_in != null) {
    url.searchParams.set("block", `${specs.L_in}x${specs.W_in}x${specs.H_in}`);
  }

  if (specs.cavityCount && specs.cavityCount > 0 && specs.cavityDims && specs.cavityDims.length > 0) {
    url.searchParams.set("cavities", specs.cavityDims.join(","));
  }

  if (specs.qty != null && specs.qty !== "") {
    url.searchParams.set("qty", String(specs.qty));
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
    specs.thickness_under_in != null ? fmtNumber(specs.thickness_under_in, 2) + " in" : "—";
  const thicknessOver =
    specs.thickness_over_in != null ? fmtNumber(specs.thickness_over_in, 2) + " in" : "—";

  const cutLossPctLabel =
    specs.cut_loss_pct != null ? fmtPercent(specs.cut_loss_pct) : "—";
  const lostDims = specs.lost_dims || "—";
  const colorLabel = specs.color || "—";

  const densityLbft3 =
    material.density_lbft3 != null ? fmtNumber(material.density_lbft3, 1) + " lb/ft³" : "—";
  const kerfPct =
    material.kerf_pct != null ? fmtPercent(material.kerf_pct) : "—";
  const minChargeLabel =
    material.min_charge != null ? fmtMoney(material.min_charge) : "—";

  const totalPrice = fmtMoney(pricing.total);
  const pieceCi = pricing.piece_ci != null ? fmtNumber(pricing.piece_ci, 4) : "—";
  const orderCi = pricing.order_ci != null ? fmtNumber(pricing.order_ci, 2) : "—";

  const usedMinCharge =
    pricing.used_min_charge ?? (pricing.raw && (pricing.raw as any).min_charge_applied) ?? false;

  const priceBreaks: PriceBreak[] = pricing.price_breaks ?? [];
  const layoutUrl = buildLayoutUrl(input);

  const showMissing = Array.isArray(missing) && missing.length > 0;

  // Button row (Azure & Slate, pill-style)
  const baseUrl =
    (process.env.NEXT_PUBLIC_BASE_URL as string | undefined) ||
    "https://api.alex-io.com";

  const quoteLink =
    quoteNumber && quoteNumber.length
      ? baseUrl.replace(/\/+$/, "") +
        "/quote?quote_no=" +
        encodeURIComponent(quoteNumber)
      : "";

  const salesEmail =
    (process.env.NEXT_PUBLIC_SALES_FORWARD_TO as string | undefined) ||
    "sales@example.com";

  const scheduleCallUrl =
    (process.env.NEXT_PUBLIC_SCHEDULE_CALL_URL as string | undefined) || "";

  const buttons: string[] = [];

  if (layoutUrl) {
    buttons.push(
      `<a href="${layoutUrl}" style="display:inline-block;margin-right:8px;margin-bottom:8px;padding:9px 18px;border-radius:999px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;">View &amp; edit layout</a>`,
    );
  }

  if (quoteLink) {
    buttons.push(
      `<a href="${quoteLink}" style="display:inline-block;margin-right:8px;margin-bottom:8px;padding:9px 18px;border-radius:999px;background:#1f2937;color:#ffffff;font-size:13px;font-weight:500;text-decoration:none;">View printable quote</a>`,
    );
  }

  if (salesEmail) {
    buttons.push(
      `<a href="mailto:${encodeURIComponent(
        salesEmail,
      )}?subject=${encodeURIComponent(
        `Quote ${quoteNumber || ""}`,
      )}" style="display:inline-block;margin-right:8px;margin-bottom:8px;padding:9px 18px;border-radius:999px;background:#e5edff;color:#111827;font-size:13px;font-weight:500;text-decoration:none;">Forward quote to sales</a>`,
    );
  }

  if (scheduleCallUrl) {
    buttons.push(
      `<a href="${scheduleCallUrl}" style="display:inline-block;margin-right:0;margin-bottom:8px;padding:9px 18px;border-radius:999px;background:#111827;color:#ffffff;font-size:13px;font-weight:500;text-decoration:none;">Schedule a call</a>`,
    );
  }

  const buttonsHtml =
    buttons.length > 0
      ? `<div style="margin-top:18px;margin-bottom:4px;">
           <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Next steps</div>
           ${buttons.join("")}
         </div>`
      : "";

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
            <!-- Brand header bar -->
            <tr>
              <td style="background:#020617;padding:14px 24px;border-bottom:1px solid #0f172a;">
                <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:#0b1120;color:#e5e7eb;font-size:12px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;">
                  Alex-IO
                </div>
                <div style="margin-top:6px;font-size:11px;color:#9ca3af;">
                  Automated foam quoting assistant
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px 8px 24px;border-bottom:1px solid #e5e7eb;">
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
                                <td style="padding:2px 0;color:#6b7280;">Color</td>
                                <td style="padding:2px 0;">${escapeHtml(colorLabel)}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Under thickness</td>
                                <td style="padding:2px 0;">${thicknessUnder}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Over thickness</td>
                                <td style="padding:2px 0;">${thicknessOver}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Cut loss</td>
                                <td style="padding:2px 0;">${cutLossPctLabel}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Lost dims</td>
                                <td style="padding:2px 0;">${escapeHtml(lostDims)}</td>
                              </tr>
                              ${
                                specs.cavityCount
                                  ? `<tr>
                                       <td style="padding:2px 0;color:#6b7280;">Cavities</td>
                                       <td style="padding:2px 0;">${specs.cavityCount} ${
                                      specs.cavityDims && specs.cavityDims.length
                                        ? "(" +
                                          specs.cavityDims.map((d) => escapeHtml(d || "")).join(", ") +
                                          ")"
                                        : ""
                                    }</td>
                                     </tr>`
                                  : ""
                              }
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>

                    <td style="vertical-align:top;padding:0 0 16px 0;">
                      <!-- Material + pricing card -->
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
                                <td style="padding:2px 0;">${escapeHtml(material.name || "—")}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Density</td>
                                <td style="padding:2px 0;">${densityLbft3}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Kerf</td>
                                <td style="padding:2px 0;">${kerfPct}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Min charge</td>
                                <td style="padding:2px 0;">${minChargeLabel}</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <div style="height:8px;"></div>

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
                                <td style="padding:2px 0;">${totalPrice}</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Piece volume</td>
                                <td style="padding:2px 0;">${pieceCi} in³</td>
                              </tr>
                              <tr>
                                <td style="padding:2px 0;color:#6b7280;">Order volume</td>
                                <td style="padding:2px 0;">${orderCi} in³</td>
                              </tr>
                              ${
                                pricing.raw && (pricing.raw as any).base_rate_per_ci != null
                                  ? `<tr>
                                       <td style="padding:2px 0;color:#6b7280;">Base rate</td>
                                       <td style="padding:2px 0;">${fmtMoney(
                                         (pricing.raw as any).base_rate_per_ci,
                                       )} / in³</td>
                                     </tr>`
                                  : ""
                              }
                              ${
                                pricing.raw && (pricing.raw as any).effective_rate_per_ci != null
                                  ? `<tr>
                                       <td style="padding:2px 0;color:#6b7280;">Effective rate</td>
                                       <td style="padding:2px 0;">${fmtMoney(
                                         (pricing.raw as any).effective_rate_per_ci,
                                       )} / in³</td>
                                     </tr>`
                                  : ""
                              }
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

                <!-- Buttons -->
                ${buttonsHtml}
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 20px 24px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
                <p style="margin:0 0 4px 0;">
                  This quote was generated automatically from your email by Alex-IO.
                  If any of the specs above don’t look right, you can reply to this email
                  or use the buttons above to adjust the layout, schedule a call, or
                  forward everything to a salesperson.
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
