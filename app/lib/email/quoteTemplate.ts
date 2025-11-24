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
  total: number;
  piece: number | null;
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
  price_breaks?: PriceBreak[];
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
  if (q == null || q === "") return "—";
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

// Layout preview URL based on dims + cavity dims
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

  if (cavityDims && cavityDims.length) {
    // join with semicolons so we can split cleanly later
    params.set("cavities", cavityDims.join(";"));
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
  const orderTotal = fmtMoney(
    pricing.total ??
      pricing.raw?.price_total ??
      pricing.raw?.total ??
      pricing.raw?.order_total,
  );

  const usedMinCharge =
    pricing.used_min_charge ?? pricing.raw?.min_charge_applied ?? false;

  const priceBreaks = pricing.price_breaks || [];

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
                <div style="font-size:13px;color:#6b7280;margin-bottom:4px;">Quote${quoteNumber ? " #" : ""} <span style="font-weight:600;color:#111827;">${quoteNumber ?? ""}</span></div>
                <div style="display:inline-block;padding:2px 8px;border-radius:999px;background:#e5e7eb;font-size:11px;color:#374151;font-weight:500;text-transform:uppercase;letter-spacing:0.03em;">
                  ${statusLabel}
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:12px 24px 8px 24px;font-size:14px;color:#111827;">
                <p style="margin:0 0 8px 0;">${customerLine}</p>
                ${
                  showMissing
                    ? `<p style="margin:0 0 8px 0;font-size:13px;color:#374151;">To finalize, please confirm:</p>
                       <ul style="margin:0 0 8px 20px;padding:0;font-size:13px;color:#374151;">
                         ${missing
                           .map(
                             (m) =>
                               `<li style="margin:0 0 2px 0;">${m}</li>`,
                           )
                           .join("")}
                       </ul>`
                    : ""
                }
              </td>
            </tr>

            <tr>
              <td style="padding:8px 24px 16px 24px;">
                <!-- Specs table -->
                <div style="font-size:13px;font-weight:600;color:#1f2933;margin:4px 0 4px 0;">Specs</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
                  <tr>
                    <td colspan="2" style="height:4px;"></td>
                  </tr>
                  <tr>
                    <td colspan="2" style="background:#e5edff;border-radius:6px 6px 0 0;padding:8px 10px;border:1px solid #c7d2fe;border-bottom:none;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;color:#111827;">
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
                          <td style="padding:2px 6px;font-weight:600;">Cavities</td>
                          <td style="padding:2px 6px;">${cavityLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Foam family</td>
                          <td style="padding:2px 6px;">${foamFamily}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Pricing table -->
                <div style="font-size:13px;font-weight:600;color:#1f2933;margin:16px 0 4px 0;">Pricing</div>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;">
                  <tr>
                    <td colspan="2" style="height:4px;"></td>
                  </tr>
                  <tr>
                    <td colspan="2" style="background:#e5edff;border-radius:6px 6px 0 0;padding:8px 10px;border:1px solid #c7d2fe;border-bottom:none;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;color:#111827;">
                        <tr>
                          <td style="width:40%;padding:2px 6px;font-weight:600;">Material</td>
                          <td style="width:60%;padding:2px 6px;">${matName} — ${matDensity}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Material waste (kerf)</td>
                          <td style="padding:2px 6px;">${matKerf}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Piece volume (CI)</td>
                          <td style="padding:2px 6px;">${pieceCi} in³</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Order volume + waste (CI)</td>
                          <td style="padding:2px 6px;">${orderCiWithWaste !== "—" ? orderCiWithWaste : orderCi} in³</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Skiving</td>
                          <td style="padding:2px 6px;">
                            ${
                              specs.H_in && specs.H_in > 2
                                ? "May require skiving depending on tooling"
                                : "Not needed for this thickness"
                            }
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Minimum charge (if applied)</td>
                          <td style="padding:2px 6px;">${minCharge}</td>
                        </tr>
                        <tr>
                          <td style="padding:2px 6px;font-weight:600;">Order total</td>
                          <td style="padding:2px 6px;font-weight:700;">${orderTotal}${
    usedMinCharge ? " (min charge applied)" : ""
  }</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Price breaks (if any) -->
                ${
                  priceBreaks.length
                    ? `<div style="font-size:13px;font-weight:600;color:#1f2933;margin:16px 0 4px 0;">Price breaks</div>
                       <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px;">
                         <tr>
                           <th align="left" style="padding:4px 6px;border:1px solid #d1d5db;background:#eff6ff;">Qty</th>
                           <th align="left" style="padding:4px 6px;border:1px solid #d1d5db;background:#eff6ff;">Order total</th>
                           <th align="left" style="padding:4px 6px;border:1px solid #d1d5db;background:#eff6ff;">Est. per piece</th>
                           <th align="left" style="padding:4px 6px;border:1px solid #d1d5db;background:#eff6ff;">Min charge?</th>
                         </tr>
                         ${priceBreaks
                           .map((pb) => {
                             const perPiece =
                               pb.piece != null && !isNaN(Number(pb.piece))
                                 ? fmtMoney(pb.piece)
                                 : "—";
                             return `<tr>
                               <td style="padding:4px 6px;border:1px solid #e5e7eb;">${pb.qty}</td>
                               <td style="padding:4px 6px;border:1px solid #e5e7eb;">${fmtMoney(pb.total)}</td>
                               <td style="padding:4px 6px;border:1px solid #e5e7eb;">${perPiece}</td>
                               <td style="padding:4px 6px;border:1px solid #e5e7eb;">${
                                 pb.used_min_charge ? "Yes" : "No"
                               }</td>
                             </tr>`;
                           })
                           .join("")}
                       </table>`
                    : ""
                }

                <!-- Buttons -->
                <div style="margin-top:18px;margin-bottom:4px;">
                  ${
                    layoutUrl
                      ? `<a href="${layoutUrl}" style="display:inline-block;margin-right:8px;padding:8px 14px;border-radius:999px;background:#2563eb;color:#ffffff;font-size:12px;font-weight:500;text-decoration:none;">Open layout preview</a>`
                      : ""
                  }
                  ${
                    quoteNumber
                      ? `<a href="${
                          (process.env.NEXT_PUBLIC_BASE_URL ||
                            "https://api.alex-io.com") +
                          "/quote?quote_no=" +
                          encodeURIComponent(quoteNumber)
                        }" style="display:inline-block;margin-right:8px;padding:8px 14px;border-radius:999px;background:#1f2937;color:#ffffff;font-size:12px;font-weight:500;text-decoration:none;">View printable quote</a>`
                      : ""
                  }
                  <a href="mailto:sales@example.com?subject=${encodeURIComponent(
                    `Quote ${quoteNumber || ""}`,
                  )}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#e5e7eb;color:#111827;font-size:12px;font-weight:500;text-decoration:none;">Forward quote to sales</a>
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
