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
// - Visual layout preview (auto-generated SVG) from dims + cavities
// - Buttons: Forward to sales, View printable quote, Schedule a call, Upload sketch/file

export type QuoteSpecs = {
  L_in: number | null;
  W_in: number | null;
  H_in: number | null;
  thickness_under_in?: number | null;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family: string | null;
  color?: string | null;
};

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
  raw?: any; // raw calc payload (optional)
  price_breaks?: PriceBreakRow[] | null; // dynamic price breaks
};

export type QuoteRenderInput = {
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
  if (n == null || !isFinite(Number(n))) return "";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number(n));
  } catch {
    return `$${Number(n).toFixed(2)}`;
  }
}

function htmlEscape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Visual layout preview:
 * Simple top-view block + cavity layout rendered as inline SVG.
 * Uses outer dims + cavities from facts. If dims are missing, returns "".
 */
function buildVisualPreview(specs: QuoteSpecs, facts: Record<string, any>): string {
  const L = specs.L_in || 0;
  const W = specs.W_in || 0;

  if (!L || !W) {
    return "";
  }

  const cavitiesRaw = Array.isArray((facts as any).cavityDims)
    ? ((facts as any).cavityDims as string[])
    : [];
  const cavityCount =
    typeof (facts as any).cavityCount === "number"
      ? (facts as any).cavityCount
      : cavitiesRaw.length || null;

  const labelDims = `Block: ${L} × ${W}${
    specs.H_in ? ` × ${specs.H_in}` : ""
  } in`;
  const labelCav =
    cavityCount && cavityCount > 0
      ? `${cavityCount} cavit${cavityCount === 1 ? "y" : "ies"}`
      : "No cavities noted";

  const outerWidth = 220;
  const outerHeight = 120;
  const pad = 10;
  const blockX = pad;
  const blockY = pad + 6;
  const blockW = outerWidth - pad * 2;
  const blockH = outerHeight - pad * 2;

  const showCavities = cavitiesRaw.length > 0;
  let cavityRects = "";

  if (showCavities) {
    const maxShown = Math.min(cavitiesRaw.length, 6);
    const cols = maxShown <= 3 ? maxShown : 3;
    const rows = Math.ceil(maxShown / cols);
    const gapX = 4;
    const gapY = 4;
    const cavW = (blockW - gapX * (cols + 1)) / cols;
    const cavH = (blockH - gapY * (rows + 1)) / rows;

    for (let i = 0; i < maxShown; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = blockX + gapX * (col + 1) + cavW * col;
      const cy = blockY + gapY * (row + 1) + cavH * row;
      const dimsLabel = cavitiesRaw[i];

      cavityRects += `
        <g>
          <rect x="${cx.toFixed(1)}" y="${cy.toFixed(
        1
      )}" width="${cavW.toFixed(1)}" height="${cavH.toFixed(
        1
      )}" rx="3" ry="3" fill="#eef2ff" stroke="#1d4ed8" stroke-width="0.8" />
          <text x="${(cx + cavW / 2).toFixed(
            1
          )}" y="${(cy + cavH / 2).toFixed(
        1
      )}" text-anchor="middle" alignment-baseline="middle" font-size="8" fill="#1f2937">
            ${htmlEscape(dimsLabel)}
          </text>
        </g>`;
    }
  }

  const svg = `
<div style="margin:6px 0 8px 0;">
  <svg width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Foam layout preview">
    <rect x="${blockX}" y="${blockY}" width="${blockW}" height="${blockH}" rx="6" ry="6" fill="#ffffff" stroke="#1d4ed8" stroke-width="1.2" />
    ${cavityRects || ""}
    <text x="${pad}" y="12" font-size="9" fill="#111827">${htmlEscape(
      labelDims
    )}</text>
    <text x="${pad}" y="${outerHeight - 6}" font-size="9" fill="#4b5563">${htmlEscape(
      labelCav
    )}</text>
  </svg>
</div>
<p style="margin:0 0 10px 0; font-size:11px; color:#6b7280;">
  Not to scale — this is a simple top-view layout to help visualize the block and cavity arrangement.
</p>`;

  return `
<h3 style="margin:10px 0 3px 0; font-size:13px; color:#1d4ed8;">Visual layout preview (auto-generated)</h3>
${svg}`;
}

export function renderQuoteEmail(input: QuoteRenderInput): string {
  const { specs, material, pricing, missing } = input;
  const facts = input.facts || {};

  // Treat either a string flag or boolean flag as "from sketch"
  const fromSketch =
    (facts as any).from === "sketch-auto-quote" ||
    (facts as any).fromSketch === true;

  const sketchLine = fromSketch
    ? `<p style="margin:8px 0 4px 0; font-size:11px; color:#4b5563; line-height:1.5;">
          Dimensions and cavities interpreted from your uploaded sketch.
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
  const thicknessLabel =
    thicknessVal != null ? `${thicknessVal}" under part` : "";

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
    "https://alex-io.com";

  const printUrl =
    quoteNo !== ""
      ? `${baseUrl}/quote?quote_no=${encodeURIComponent(quoteNo)}`
      : undefined;

  const sketchUrl =
    quoteNo !== ""
      ? `${baseUrl}/sketch-upload?quote_no=${encodeURIComponent(quoteNo)}`
      : `${baseUrl}/sketch-upload`;

  const forwardToSalesEmail =
    process.env.NEXT_PUBLIC_SALES_FORWARD_TO || "sales@example.com";

  const salesSubject =
    quoteNo !== ""
      ? `Foam quote ${quoteNo}`
      : "Foam quote from Alex-IO";

  const schedulerBase =
    process.env.NEXT_PUBLIC_SALES_SCHEDULER_URL || "";

  const scheduleUrl =
    schedulerBase ||
    (quoteNo !== ""
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          `Call about foam quote ${quoteNo}`
        )}&details=${encodeURIComponent(
          `Let's review your foam packaging quote ${quoteNo} and any questions you might have.`
        )}`
      : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          "Foam quote call"
        )}`);

  const forwardHref = `mailto:${encodeURIComponent(
    forwardToSalesEmail
  )}?subject=${encodeURIComponent(
    salesSubject
  )}&body=${encodeURIComponent(
    `Please review the attached foam quote.\n\nQuote number: ${
      quoteNo || "(not set)"
    }`
  )}`;

  // Prefer caller's customerLine (from orchestrator / sketch) if provided
  const introLine =
    input.customerLine && input.customerLine.trim().length > 0
      ? input.customerLine.trim()
      : "Thanks for the details—here’s a preliminary quote based on the information we have so far.";

  const missingList =
    missing && missing.length
      ? `<ul style="margin:4px 0 0 20px; padding:0; color:#374151; font-size:13px;">
${missing
  .map(
    (m) =>
      `<li style="margin:2px 0;">${htmlEscape(String(m))}</li>`
  )
  .join("\n")}
</ul>`
      : "";

  const missingBlock =
    missing && missing.length
      ? `<p style="margin:0 0 4px 0; font-size:13px; color:#111827;">
To finalize, please confirm:</p>
${missingList}`
      : "";

  const orderTotal = pricing.total ?? null;
  const piecePrice =
    orderTotal != null && qtyNum && qtyNum > 0
      ? orderTotal / qtyNum
      : null;

  const priceBreaks = Array.isArray(pricing.price_breaks)
    ? pricing.price_breaks
    : null;

  // Status pill (always show, default draft)
  const rawStatus =
    (input.status ??
      (typeof (facts as any).status === "string"
        ? (facts as any).status
        : undefined) ??
      "") || "draft";
  const statusValue = rawStatus.trim().toLowerCase();
  let statusBg = "#e5e7eb";
  let statusFg = "#374151";
  if (statusValue === "sent") {
    statusBg = "#d1fae5";
    statusFg = "#065f46";
  } else if (statusValue === "accepted") {
    statusBg = "#bfdbfe";
    statusFg = "#1d4ed8";
  }
  const statusLabel = (statusValue || "draft").toUpperCase();

  // Simple skiving detection: any non-integer thickness (using thickness_under if present)
  const thicknessForSkive =
    thicknessVal != null ? thicknessVal : specs.H_in != null ? specs.H_in : null;
  let skivingText = "Not needed for this thickness";
  let skiveNeeded = false;
  if (
    thicknessForSkive != null &&
    !Number.isNaN(Number(thicknessForSkive))
  ) {
    const h = Number(thicknessForSkive);
    if (Math.abs(h - Math.round(h)) > 1e-2) {
      skivingText = 'Yes — includes skive for non-1" thickness';
      skiveNeeded = true;
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
  // simple, honest ideas from the actual specs so the block still appears.
  if (optSuggestions.length === 0) {
    const fallback: string[] = [];

    // Quantity-based idea
    if (qtyNum && qtyNum > 0) {
      const q2 = qtyNum * 2;
      const q3 = qtyNum * 3;
      fallback.push(
        `If your usage can support it, we can also check pricing at about ${q2}–${q3} pcs to see if a higher volume drops the per-piece price.`
      );
    }

    // Density/material-based idea
    if (specs.density_pcf && specs.density_pcf > 0) {
      const d = specs.density_pcf;
      if (d >= 1.7 && d <= 2.2) {
        fallback.push(
          `If the part isn’t extremely fragile, a nearby density in the ${(
            d - 0.2
          ).toFixed(1)}–${(d - 0.4).toFixed(
            1
          )} pcf range might reduce cost while still handling normal drops—we can run that as an alternate.`
        );
      } else if (d > 2.2) {
        fallback.push(
          `This is a relatively firm foam; if you’re mainly protecting against moderate handling, we can try a slightly lower density option to balance cost and cushion.`
        );
      }
    }

    // Cavity layout idea
    if (cavityDims.length > 0 && (cavityCount || cavityDims.length) >= 4) {
      fallback.push(
        `We can also look at grouping similar cavity sizes together to improve sheet yield and reduce scrap on the nesting layout.`
      );
    }

    optSuggestions = fallback.slice(0, 4);
  }

  // Shared colors (used by tables + price breaks)
  const lightBlueBg = "#eef2ff";
  const lightBlueBorder = "#c7d2fe";
  const darkBlue = "#1d4ed8";

  // Price-break HTML:
  // - If price_breaks are provided, show a compact table.
  // - Otherwise, we now leave this blank (no extra one-line summary) since
  //   your orchestrator is generating breaks for real quotes.
  let priceBreakHtml: string;
  if (priceBreaks && priceBreaks.length > 0) {
    const rows = priceBreaks
      .filter((b) => b && typeof b.qty === "number" && b.qty > 0)
      .map((b) => {
        const qtyLabel = htmlEscape(String(b.qty));
        const totalLabel = fmtMoney(b.total);
        const pieceLabel =
          b.piece != null ? fmtMoney(b.piece) : "";
        const minLabel = b.used_min_charge ? "Yes" : "No";
        return `<tr>
  <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right;">${qtyLabel}</td>
  <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right;">${totalLabel}</td>
  <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right; font-weight:600;">${pieceLabel}</td>
  <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:center;">${minLabel}</td>
</tr>`;
      })
      .join("");

    if (rows) {
      priceBreakHtml = `
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px;">
  <thead>
    <tr style="background:${lightBlueBg};">
      <th style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right; font-weight:500; color:#374151;">Qty</th>
      <th style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right; font-weight:500; color:#374151;">Order total</th>
      <th style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:right; font-weight:500; color:#374151;">Est. per piece</th>
      <th style="padding:4px 8px; border:1px solid ${lightBlueBorder}; text-align:center; font-weight:500; color:#374151;">Min charge?</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>`;
    } else {
      priceBreakHtml = "";
    }
  } else {
    // No table: leave blank (no "At X pcs..." line)
    priceBreakHtml = "";
  }

  // Design optimization block (now always has content because of fallback)
  let designBlock = "";
  if (optSuggestions.length > 0) {
    const items = optSuggestions
      .map(
        (s) =>
          `<li style="margin:2px 0;">${htmlEscape(s)}</li>`
      )
      .join("\n");

    designBlock = `
        <h3 style="margin:10px 0 3px 0; font-size:13px; color:${darkBlue};">Design optimization ideas</h3>
        <ul style="margin:0 0 6px 18px; padding:0; font-size:12px; color:#111827; list-style:disc;">
          ${items}
        </ul>
        <p style="margin:0 0 10px 0; font-size:11px; color:#4b5563;">
          These are optional tweaks based on typical foam applications. If one looks interesting, reply with which option you want to explore and any drop-height or fragility details you can share.
        </p>`;
  }

  // Visual layout preview HTML (may be empty if dims missing)
  const visualPreviewHtml = buildVisualPreview(specs, facts);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charSet="utf-8" />
    <title>Foam quote${quoteNo ? " " + quoteNo : ""}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6;">
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:16px; background-color:#f3f4f6;">
      <div style="max-width:720px; margin:0 auto; background-color:#ffffff; border-radius:16px; padding:20px 24px 24px 24px; box-shadow:0 10px 30px rgba(15,23,42,0.08);">

        <div style="margin-bottom:8px; font-size:13px; color:#111827; white-space:normal;">
          ${
            quoteNo
              ? `<span style="font-weight:600;">Quote # ${htmlEscape(
                  quoteNo
                )}</span>`
              : `<span style="font-weight:600;">Foam packaging quote</span>`
          }
          <span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background-color:${statusBg}; color:${statusFg}; font-size:11px; font-weight:500;">
            ${htmlEscape(statusLabel)}
          </span>
        </div>

        <p style="margin:0 0 6px 0; font-size:13px; color:#111827;">
          ${htmlEscape(introLine)}
        </p>

        ${missingBlock}

        <h3 style="margin:14px 0 3px 0; font-size:13px; color:${darkBlue};">Specs</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:6px;">
          <tbody>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; width:35%; color:#6b7280;">Outside size</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${outsideSize || "—"}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Quantity</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${qty || "—"}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Density</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${density || "TBD"}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Thickness under part</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${thicknessLabel || "—"}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Cavities</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${htmlEscape(
                cavityLabel
              )}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Foam family</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${foamFamily || "TBD"}</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:10px 0 3px 0; font-size:13px; color:${darkBlue};">Pricing</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:6px;">
          <tbody>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; width:35%; color:#6b7280;">Material</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                foamFamily
                  ? `${foamFamily}${density ? " — " + density : ""}`
                  : density || "—"
              }</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Material waste (kerf)</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                material.kerf_pct != null ? `${material.kerf_pct}%` : "0%"
              }</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Piece volume (CI)</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                pricing.piece_ci != null ? `${pricing.piece_ci} in³` : "0 in³"
              }</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Order volume + waste (CI)</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                pricing.order_ci_with_waste != null
                  ? `${pricing.order_ci_with_waste} in³`
                  : pricing.order_ci != null
                  ? `${pricing.order_ci} in³`
                  : "0 in³"
              }</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Skiving</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${skivingText}</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Minimum charge (if applied)</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                pricing.used_min_charge && material.min_charge != null
                  ? fmtMoney(material.min_charge)
                  : fmtMoney(0)
              }</td>
            </tr>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Order total</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827; font-weight:600;">${
                orderTotal != null ? fmtMoney(orderTotal) : fmtMoney(0)
              }</td>
            </tr>
          </tbody>
        </table>

        ${
          skiveNeeded
            ? `<p style="margin:2px 0 8px 0; font-size:11px; color:#b91c1c;">
* Note: This job requires skiving — quoted pricing includes skiving set-up and the up-charge for non-standard thickness.
</p>`
            : ""
        }

        <h3 style="margin:10px 0 3px 0; font-size:13px; color:${darkBlue};">Price breaks</h3>
        <div style="margin:0 0 6px 0; font-size:12px; color:#111827;">
          ${priceBreakHtml}
        </div>

        <p style="margin:0 0 10px 0; font-size:12px; color:#4b5563;">
          For cavities, replying with a short list like “2×3×1 qty 4; dia 6×1 qty 2” works best.
        </p>

        ${visualPreviewHtml}

        ${designBlock}

        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
          <!-- Forward: dark blue -->
          <a
            href="${forwardHref}"
            style="
              display:inline-block;
              padding:8px 14px;
              border-radius:999px;
              background:#1d4ed8;
              color:#ffffff;
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid #1d4ed8;
            "
          >
            Forward quote to sales
          </a>

          <!-- View printable: light blue -->
          ${
            printUrl
              ? `<a
            href="${printUrl}"
            style="
              display:inline-block;
              padding:8px 14px;
              border-radius:999px;
              background:${lightBlueBg};
              color:${darkBlue};
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid ${lightBlueBorder};
            "
          >
            View printable quote
          </a>`
              : ""
          }

          <!-- Schedule: dark blue -->
          <a
            href="${scheduleUrl}"
            style="
              display:inline-block;
              padding:8px 14px;
              border-radius:999px;
              background:#1d4ed8;
              color:#ffffff;
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid #1d4ed8;
            "
          >
            Schedule a call
          </a>

          <!-- Upload sketch: light blue -->
          <a
            href="${sketchUrl}"
            style="
              display:inline-block;
              padding:8px 14px;
              border-radius:999px;
              background:${lightBlueBg};
              color:${darkBlue};
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid ${lightBlueBorder};
            "
          >
            Upload sketch / file
          </a>
        </div>

${sketchLine}

        <p style="margin:14px 0 4px 0; font-size:11px; color:#4b5563; line-height:1.5;">
          This is a preliminary price based on the information we have so far. We&apos;ll firm it up once we confirm any missing details or adjustments, and we can easily re-run the numbers if the quantity or material changes (including any skiving or non-standard thickness up-charges).
        </p>

        <p style="margin:4px 0 0 0; font-size:11px; color:#4b5563; line-height:1.5;">
          To continue, you can forward this quote to sales, upload a sketch, schedule a call, or reply directly to this email with any revisions.
        </p>

        <p style="margin:14px 0 0 0; font-size:11px; color:#6b7280;">
          — Alex-IO Estimator
        </p>
      </div>
    </div>
  </body>
</html>`;
}
