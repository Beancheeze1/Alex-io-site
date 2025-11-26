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
//     color?: string | null;
//     cavityCount?: number | null;
//     cavityDims?: string[];          // e.g. ["1x1x1", "2x2x1"]
//   },
//   material: {
//     name: string;
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
//     price_breaks?: PriceBreak[] | null;
//   },
//   missing: string[];
//   facts?: Record<string, any>;
// };
//
// The template is resilient: if dims/material/pricing are missing, it
// gracefully fills with "—" and explanatory notes instead of throwing.

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
  unit_price: number;
  ext_price: number;
  note?: string | null;
};

export type TemplateMaterial = {
  name: string;
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
  const dims = (specs.cavityDims || []).filter((s) => !!s && typeof s === "string");

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
  params.set("quote_no", qno);

  const { L_in, W_in, H_in, cavityDims } = input.specs;
  if (L_in && W_in && H_in) {
    params.set("dims", `${L_in}x${W_in}x${H_in}`);
  }
  if (Array.isArray(cavityDims) && cavityDims.length > 0) {
    params.set("cavities", cavityDims.join(","));
    params.set("cavity", cavityDims[0]);
  }

  return `${base}/quote/layout?${params.toString()}`;
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
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px 8px 24px;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Quote${quoteNumber ? 
                  ` · <span style="font-weight:600;color:#111827;">${quoteNumber}</span>` : ""
                }</div>
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div style="width:32px;height:32px;border-radius:999px;background:#0ea5e9;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;letter-spacing:0.04em;">
                      AI
                    </div>
                    <div>
                      <div style="font-size:16px;font-weight:600;color:#111827;">Alex-IO foam quote</div>
                      <div style="font-size:12px;color:#6b7280;">Status: <span style="font-weight:600;text-transform:capitalize;">${statusLabel}</span></div>
                    </div>
                  </div>
                  <div style="font-size:11px;font-weight:500;color:#6b7280;padding:4px 8px;border-radius:999px;border:1px solid #e5e7eb;background:#f9fafb;">
                    Automated first response
                  </div>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 24px 0 24px;">
                <p style="margin:0 0 8px 0;font-size:14px;color:#111827;line-height:1.5;">
                  ${customerLine}
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 24px 16px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:top;width:55%;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
                        <tr>
                          <td colspan="2" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#111827;background:#f3f4f6;">
                            Specs
                          </td>
                        </tr>
                        <tr>
                          <td style="width:40%;padding:2px 6px;font-weight:600;">Outside size</td>
                          <td style="width:60%;padding:2px 6px;">${outsideSize}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Quantity</td>
                          <td style="padding:2px 6px;">${qty}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Density</td>
                          <td style="padding:2px 6px;">${densityLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Thickness under part</td>
                          <td style="padding:2px 6px;">${thicknessUnder}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Material</td>
                          <td style="padding:2px 6px;">${foamFamily}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Color</td>
                          <td style="padding:2px 6px;">${specs.color || "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Cavities</td>
                          <td style="padding:2px 6px;">${cavityLabel}</td>
                        </tr>
                      </table>
                    </td>

                    <td style="vertical-align:top;width:45%;padding-left:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
                        <tr>
                          <td colspan="2" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#111827;background:#f3f4f6;">
                            Pricing
                          </td>
                        </tr>
                        <tr>
                          <td style="width:50%;padding:2px 6px;font-weight:600;">Material</td>
                          <td style="width:50%;padding:2px 6px;">${matName}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Density</td>
                          <td style="padding:2px 6px;">${matDensity}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Kerf allowance</td>
                          <td style="padding:2px 6px;">${matKerf}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Piece volume</td>
                          <td style="padding:2px 6px;">${pieceCi !== "—" ? `${pieceCi} in³` : "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Order volume</td>
                          <td style="padding:2px 6px;">${orderCi !== "—" ? `${orderCi} in³` : "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">With waste</td>
                          <td style="padding:2px 6px;">${orderCiWithWaste !== "—" ? `${orderCiWithWaste} in³` : "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Min charge</td>
                          <td style="padding:2px 6px;">${minCharge}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Order total</td>
                          <td style="padding:2px 6px;font-weight:700;color:#111827;">${orderTotal}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Applied</td>
                          <td style="padding:2px 6px;">
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
              <td style="padding:0 24px 16px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
                  <tr>
                    <td colspan="4" style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#111827;background:#f3f4f6;">
                      Price breaks
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6b7280;">Qty</td>
                    <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6b7280;">Unit</td>
                    <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6b7280;">Extended</td>
                    <td style="padding:6px 8px;font-size:11px;font-weight:600;color:#6b7280;">Notes</td>
                  </tr>
                  ${priceBreaks
                    .map(
                      (br) => `
                        <tr>
                          <td style="padding:4px 8px;font-size:11px;">${br.qty}</td>
                          <td style="padding:4px 8px;font-size:11px;">${fmtMoney(br.unit_price)}</td>
                          <td style="padding:4px 8px;font-size:11px;">${fmtMoney(br.ext_price)}</td>
                          <td style="padding:4px 8px;font-size:11px;color:#6b7280;">${br.note || ""}</td>
                        </tr>
                      `
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
              <td style="padding:0 24px 16px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;border:1px solid #fee2e2;background:#fef2f2;">
                  <tr>
                    <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:12px;font-weight:600;color:#b91c1c;background:#fee2e2;">
                      Items we still need to finalize
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 10px;font-size:12px;color:#7f1d1d;line-height:1.5;">
                      <ul style="margin:0;padding-left:18px;">
                        ${missing
                          .map(
                            (m) =>
                              `<li style="margin-bottom:2px;">${m}</li>`
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

            <tr>
              <td style="padding:0 24px 24px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#111827;line-height:1.6;">
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
              <td style="padding:0 24px 24px 24px;">
                <a href="${layoutUrl}" style="display:inline-block;padding:8px 14px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#ffffff;font-size:12px;font-weight:600;text-decoration:none;">
                  View foam layout editor
                </a>
              </td>
            </tr>`
                : ""
            }

          </table>

          <div style="max-width:640px;margin-top:12px;padding:0 24px;font-size:11px;color:#6b7280;">
            <p style="margin:0;">
              This first pass was generated by Alex-IO (AI assistant) based on your sketch and the last few emails. A human will review it before anything is cut.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
