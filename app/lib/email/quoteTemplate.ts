// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Inputs come from app/api/ai/orchestrate/route.ts via renderQuoteEmail(input).
// This version:
// - Shows Quote # + status pill
// - Compact light-blue Specs / Pricing tables
// - Cavities row in Specs
// - Skiving row in Pricing + red callout note if skiving is needed
// - Bold per-piece price in Price breaks
// - Dynamic price-break table when provided
// - Design optimization ideas pulled from facts.opt_suggestions,
//   with sensible fallback suggestions when AI returns nothing
// - Visual layout preview link that points to NEXT_PUBLIC_BASE_URL
//   (defaulting to https://api.alex-io.com)

export type QuoteMaterial = {
  name?: string | null;
  density_lb_ft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

export type PriceBreakRow = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
};

export type QuotePricing = {
  total: number | null;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  raw?: any;
  price_breaks?: PriceBreakRow[] | null;
};

type QuoteSpecs = {
  L_in: number | null;
  W_in: number | null;
  H_in: number | null;
  thickness_under_in?: number | null;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family: string | null;
  color?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[] | null;
};

type QuoteRenderInput = {
  customerLine?: string | null;
  quoteNumber?: string | number | null;
  status?: string | null;
  specs: QuoteSpecs;
  material: QuoteMaterial;
  pricing: QuotePricing;
  missing: string[];
  facts?: Record<string, any>;
};

function fmtDims(L: number | null, W: number | null, H: number | null) {
  if (!L || !W || !H) return "";
  return `${L} × ${W} × ${H} in`;
}

function fmtQty(q: number | string | null) {
  if (q == null) return "";
  return String(q);
}

function fmtDensity(d: number | null) {
  if (!d && d !== 0) return "";
  return `${d} pcf`;
}

function fmtMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return `$${Number(n).toFixed(2)}`;
}

function fmtPercent(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return `${Number(n).toFixed(1)}%`;
}

function fmtNumber(
  n: number | null | undefined,
  options: { decimals?: number; suffix?: string } = {},
) {
  if (n == null || Number.isNaN(Number(n))) return "";
  const decimals = options.decimals ?? 2;
  const suffix = options.suffix ?? "";
  return `${Number(n).toFixed(decimals)}${suffix}`;
}

function htmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderQuoteEmail(input: QuoteRenderInput): string {
  const { specs, material, pricing, missing } = input;
  const facts = input.facts || {};

  // Treat either a string flag or boolean flag as "from sketch"
  const fromSketch =
    (facts as any).from === "sketch-auto-quote" ||
    (facts as any).fromSketch === true;

  const sketchLine = fromSketch
    ? `<p style="margin:8px 0 4px 0; font-size:11px; color:#4b5563;">
          I interpreted the dimensions and cavities from your uploaded sketch.
       </p>`
    : "";

  const quoteNo = input.quoteNumber ? String(input.quoteNumber) : "";

  const outsideSize = fmtDims(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const qtyNum =
    specs.qty != null && !Number.isNaN(Number(specs.qty))
      ? Number(specs.qty)
      : null;
  const density = fmtDensity(specs.density_pcf);
  const foamFamily =
    specs.foam_family && specs.foam_family.trim()
      ? specs.foam_family.trim()
      : material?.name || "TBD";

  // Thickness under the part (for skived pads)
  const thicknessVal =
    specs.thickness_under_in != null &&
    !Number.isNaN(Number(specs.thickness_under_in))
      ? Number(specs.thickness_under_in)
      : null;

  // Determine whether the block likely needs skiving
  let skivingText = "Not needed for this thickness";
  let skiveNeeded = false;
  if (specs.H_in != null && specs.H_in > 2) {
    skivingText = "May require skiving depending on tooling";
    skiveNeeded = true;
  }
  if (thicknessVal != null && thicknessVal > 2) {
    skivingText = "May require skiving depending on tooling (under part)";
    skiveNeeded = true;
  }

  // Skiving callout line, used in Pricing panel
  let skiveCallout = "";
  if (skiveNeeded) {
    const thicknessForSkive =
      thicknessVal != null ? thicknessVal : specs.H_in || null;
    if (thicknessForSkive != null) {
      const h = Number(thicknessForSkive);
      if (Math.abs(h - Math.round(h)) > 1e-2) {
        skivingText = 'Yes — includes skive for non-1" thickness';
        skiveNeeded = true;
      }
    }
  }

  // Cavity info from facts
  const cavityCount =
    typeof (facts as any).cavityCount === "number"
      ? (facts as any).cavityCount
      : null;
  const cavityDims = Array.isArray((facts as any).cavityDims)
    ? ((facts as any).cavityDims as string[])
    : [];
  let cavityLabel: string;
  if (cavityCount != null) {
    const word = cavityCount === 1 ? "cavity" : "cavities";
    if (cavityDims.length) {
      cavityLabel = `${cavityCount} ${word} (${cavityDims.join(", ")})`;
    } else {
      cavityLabel = `${cavityCount} ${word}`;
    }
  } else if (cavityDims.length) {
    cavityLabel = `${cavityDims.length} cavities (${cavityDims.join(", ")})`;
  } else {
    cavityLabel = "None noted";
  }

  // Design optimization ideas from facts.opt_suggestions
  const optSuggestionsRaw = Array.isArray((facts as any).opt_suggestions)
    ? ((facts as any).opt_suggestions as any[])
    : [];
  let optSuggestions = optSuggestionsRaw
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 5);

  // Fallback: if AI didn't give any suggestions, synthesize a couple
  if (!optSuggestions.length) {
    optSuggestions = [
      "Group smaller parts into shared pockets where possible to reduce machining.",
      "Consider standardizing block sizes across SKUs to reduce changeover and scrap.",
      "If drop height and fragility allow, increase cavity spacing slightly to improve tool life.",
    ];
  }

  // Material / pricing details
  const materialName = material.name || "TBD";
  const materialDensity =
    material.density_lb_ft3 != null
      ? `${material.density_lb_ft3.toFixed(1)} pcf`
      : "";
  const kerfPct = fmtPercent(
    material.kerf_pct != null
      ? material.kerf_pct
      : pricing.raw?.kerf_pct ?? null,
  );
  const minCharge =
    material.min_charge != null
      ? fmtMoney(material.min_charge)
      : pricing.raw?.min_charge != null
      ? fmtMoney(pricing.raw.min_charge)
      : "";

  const pieceCi = fmtNumber(
    pricing.piece_ci != null ? pricing.piece_ci : pricing.raw?.piece_ci,
    { decimals: 0, suffix: " in³" },
  );
  const orderCi = fmtNumber(
    pricing.order_ci != null ? pricing.order_ci : pricing.raw?.order_ci,
    { decimals: 0, suffix: " in³" },
  );
  const orderCiWithWaste = fmtNumber(
    pricing.order_ci_with_waste != null
      ? pricing.order_ci_with_waste
      : pricing.raw?.order_ci_with_waste,
    { decimals: 0, suffix: " in³" },
  );
  const orderTotal =
    pricing.total != null
      ? fmtMoney(pricing.total)
      : pricing.raw?.order_total != null
      ? fmtMoney(pricing.raw.order_total)
      : pricing.raw?.total != null
      ? fmtMoney(pricing.raw.total)
      : pricing.raw?.price_total != null
      ? fmtMoney(pricing.raw.price_total)
      : "";

  const usedMinCharge =
    pricing.used_min_charge != null
      ? pricing.used_min_charge
      : pricing.raw?.min_charge_applied ?? false;

  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com"
  ).replace(/\/+$/, "");

  const printUrl =
    quoteNo !== ""
      ? `${baseUrl}/quote?quote_no=${encodeURIComponent(quoteNo)}`
      : "";

  const customerLine =
    input.customerLine ||
    "Thanks for the details—I'll review a couple of specifications and get back to you with a price shortly.";

  const missingClean = Array.isArray(missing)
    ? missing.filter((m) => typeof m === "string" && m.trim().length > 0)
    : [];

  const priceBreaks: PriceBreakRow[] = Array.isArray(
    pricing.price_breaks ?? pricing.raw?.price_breaks,
  )
    ? (pricing.price_breaks ?? pricing.raw.price_breaks)
    : [];

  // Layout URL: use baseUrl (which is now rooted on api.alex-io.com).
  // Updated to:
  // - use comma-separated cavities (1x1x1,2x2x0.5,3x1x1)
  // - include both `cavities` (full list) and `cavity` (first one)
  const layoutUrl = (() => {
    if (!quoteNo || !specs.L_in || !specs.W_in || !specs.H_in) return undefined;
    const dims = `${specs.L_in}x${specs.W_in}x${specs.H_in}`;
    const cavStr = cavityDims.length ? cavityDims.join(",") : "";
    let url = `${baseUrl}/quote/layout?quote_no=${encodeURIComponent(
      quoteNo,
    )}&dims=${encodeURIComponent(dims)}`;
    if (cavStr) {
      url += `&cavities=${encodeURIComponent(cavStr)}`;
      const firstCavity = cavityDims[0];
      if (firstCavity) {
        url += `&cavity=${encodeURIComponent(firstCavity)}`;
      }
    }
    return url;
  })();

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charSet="utf-8" />
    <title>Foam quote${quoteNo ? " " + quoteNo : ""}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6;">
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:24px 0;">
      <div style="max-width:640px; margin:0 auto; background-color:#ffffff; border-radius:12px; border:1px solid #e5e7eb; overflow:hidden;">
        <!-- Header -->
        <div style="padding:16px 20px 10px 20px; border-bottom:1px solid #e5e7eb;">
          <div style="font-size:13px; color:#6b7280; margin-bottom:4px;">
            Quote${quoteNo ? " #" : ""} <span style="font-weight:600; color:#111827;">${htmlEscape(
              quoteNo,
            )}</span>
          </div>
          <div style="display:inline-flex; align-items:center; background-color:#e5e7eb; color:#374151; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:500; text-transform:uppercase; letter-spacing:0.03em;">
            ${(input.status || "draft").toUpperCase()}
          </div>
        </div>

        <!-- Intro / missing info -->
        <div style="padding:12px 20px 4px 20px; font-size:14px; color:#111827;">
          <p style="margin:0 0 8px 0;">${htmlEscape(customerLine)}</p>
          ${sketchLine}
          ${
            missingClean.length
              ? `<p style="margin:0 0 4px 0; font-size:13px; color:#374151;">
                   To finalize, please confirm:
                 </p>
                 <ul style="margin:0 0 8px 18px; padding:0; font-size:13px; color:#374151;">
                   ${missingClean
                     .map(
                       (m) =>
                         `<li style="margin:0 0 2px 0;">${htmlEscape(
                           m,
                         )}</li>`,
                     )
                     .join("")}
                 </ul>`
              : ""
          }
        </div>

        <!-- Specs block -->
        <div style="padding:4px 20px 4px 20px;">
          <div style="font-size:13px; font-weight:600; color:#1f2937; margin:4px 0 4px 0;">
            Specs
          </div>
          <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="border-collapse:collapse; font-size:13px;">
            <tr>
              <td colspan="2" style="height:4px;"></td>
            </tr>
            <tr>
              <td colspan="2" style="background-color:#e5edff; border-radius:6px; padding:8px 10px; border:1px solid #c7d2fe;">
                <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="font-size:13px; color:#111827;">
                  <tr>
                    <td style="width:40%; padding:2px 6px; font-weight:600;">Outside size</td>
                    <td style="width:60%; padding:2px 6px;">${outsideSize || "TBD"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Quantity</td>
                    <td style="padding:2px 6px;">${qty || "TBD"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Density</td>
                    <td style="padding:2px 6px;">${density || "TBD"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Cavities</td>
                    <td style="padding:2px 6px;">${htmlEscape(cavityLabel)}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Foam family</td>
                    <td style="padding:2px 6px;">${htmlEscape(
                      foamFamily || "TBD",
                    )}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Thickness under part</td>
                    <td style="padding:2px 6px;">
                      ${
                        thicknessVal != null
                          ? `${thicknessVal.toFixed(2)} in`
                          : "Not specified"
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>

        <!-- Pricing block -->
        <div style="padding:8px 20px 4px 20px;">
          <div style="font-size:13px; font-weight:600; color:#1f2937; margin:4px 0 4px 0;">
            Pricing
          </div>
          <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="border-collapse:collapse; font-size:13px;">
            <tr>
              <td colspan="2" style="height:4px;"></td>
            </tr>
            <tr>
              <td colspan="2" style="background-color:#e5edff; border-radius:6px; padding:8px 10px; border:1px solid #c7d2fe;">
                <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="font-size:13px; color:#111827;">
                  <tr>
                    <td style="width:40%; padding:2px 6px; font-weight:600;">Material</td>
                    <td style="width:60%; padding:2px 6px;">
                      ${htmlEscape(materialName)}
                      ${
                        materialDensity
                          ? ` — ${htmlEscape(materialDensity)}`
                          : ""
                      }
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Material waste (kerf)</td>
                    <td style="padding:2px 6px;">${kerfPct || "TBD"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Piece volume</td>
                    <td style="padding:2px 6px;">${pieceCi || "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Order volume</td>
                    <td style="padding:2px 6px;">${orderCi || "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Order + waste</td>
                    <td style="padding:2px 6px;">${orderCiWithWaste || "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Skiving</td>
                    <td style="padding:2px 6px;">
                      ${htmlEscape(skivingText)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Minimum charge (if applied)</td>
                    <td style="padding:2px 6px;">${minCharge || "—"}</td>
                  </tr>
                  <tr>
                    <td style="padding:2px 6px; font-weight:600;">Order total</td>
                    <td style="padding:2px 6px; font-weight:700;">
                      ${orderTotal || "Pending specs"}
                      ${
                        usedMinCharge && orderTotal
                          ? ` <span style="color:#b91c1c; font-weight:500;">(min charge applied)</span>`
                          : ""
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          ${
            skiveNeeded
              ? `<div style="margin-top:6px; padding:6px 8px; border-radius:6px; background-color:#fef2f2; border:1px solid #fecaca; font-size:11px; color:#b91c1c;">
                   Skiving note: non-1" cushion thickness often requires an extra skive pass. We can revisit pricing if your drop-height or fragility allows a simpler pad.
                 </div>`
              : ""
          }
        </div>

        <!-- Price breaks (if any) -->
        ${
          priceBreaks.length
            ? `<div style="padding:8px 20px 4px 20px;">
                 <div style="font-size:13px; font-weight:600; color:#1f2937; margin:4px 0 4px 0;">
                   Price breaks
                 </div>
                 <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style="border-collapse:collapse; font-size:12px;">
                   <tr>
                     <th align="left" style="padding:4px 6px; border:1px solid #d1d5db; background-color:#eff6ff;">Qty</th>
                     <th align="left" style="padding:4px 6px; border:1px solid #d1d5db; background-color:#eff6ff;">Order total</th>
                     <th align="left" style="padding:4px 6px; border:1px solid:#d1d5db; background-color:#eff6ff;">Est. per piece</th>
                     <th align="left" style="padding:4px 6px; border:1px solid:#d1d5db; background-color:#eff6ff;">Min charge?</th>
                   </tr>
                   ${priceBreaks
                     .map((pb) => {
                       const perPiece =
                         pb.piece != null && !Number.isNaN(Number(pb.piece))
                           ? fmtMoney(pb.piece)
                           : "";
                       return `<tr>
                         <td style="padding:4px 6px; border:1px solid #e5e7eb;">${pb.qty}</td>
                         <td style="padding:4px 6px; border:1px solid #e5e7eb; font-weight:600;">${fmtMoney(
                           pb.total,
                         )}</td>
                         <td style="padding:4px 6px; border:1px solid #e5e7eb; font-weight:700;">${perPiece}</td>
                         <td style="padding:4px 6px; border:1px solid #e5e7eb;">${
                           pb.used_min_charge ? "Yes" : "No"
                         }</td>
                       </tr>`;
                     })
                     .join("")}
                 </table>
               </div>`
            : ""
        }

        <!-- Design optimization ideas -->
        <div style="padding:8px 20px 12px 20px;">
          <div style="font-size:13px; font-weight:600; color:#1f2937; margin:4px 0 4px 0;">
            Design optimization ideas
          </div>
          <ul style="margin:4px 0 0 18px; padding:0; font-size:12px; color:#374151;">
            ${optSuggestions
              .map(
                (s) => `<li style="margin:0 0 3px 0;">${htmlEscape(s)}</li>`,
              )
              .join("")}
          </ul>
          <p style="margin:8px 0 0 0; font-size:11px; color:#6b7280;">
            If any of these are off-base for your application, no problem—just reply with which option you want to explore and any drop-height or fragility details you can share.
          </p>
        </div>

        <!-- Buttons -->
        <div style="padding:4px 20px 18px 20px;">
          ${
            layoutUrl
              ? `<a href="${layoutUrl}" style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background-color:#2563eb; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;">
                   Open layout preview
                 </a>`
              : ""
          }
          ${
            printUrl
              ? `<a href="${printUrl}" style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background-color:#1f2937; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;">
                   View printable quote
                 </a>`
              : ""
          }
          <a href="mailto:sales@example.com?subject=${encodeURIComponent(
            `Quote ${quoteNo || ""}`,
          )}" style="display:inline-block; padding:8px 14px; border-radius:999px; background-color:#e5e7eb; color:#111827; font-size:12px; font-weight:500; text-decoration:none;">
            Forward quote to sales
          </a>
        </div>

        <!-- Footer -->
        <p style="margin:4px 20px 14px 20px; font-size:11px; color:#4b5563; line-height:1.5;">
          To continue, you can forward this quote to sales, upload a sketch, schedule a call, or reply directly to this email with any revisions.
        </p>

        <p style="margin:14px 20px 18px 20px; font-size:11px; color:#6b7280;">
          — Alex-IO Estimator
        </p>
      </div>
    </div>
  </body>
</html>`;
}
