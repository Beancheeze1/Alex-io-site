// app/lib/email/quoteTemplate.ts
//
// Email template for Alex-IO foam quotes.
//
// Layout goals (matches the screenshot you like):
// - Example input bar at the top
// - "Quote # ..." line under it
// - Short intro, then Specs + Pricing tables
// - Price break text paragraph
// - Buttons: Forward to sales, View printable quote, Schedule a call
// - NEW: Skiving rows in Pricing, explicit thickness row in Specs,
//        and a "Cavity details" section with faux input boxes.
//
// Notes:
// - Uses QuotePricing.raw (when available) to surface skive & debug info.
// - Safe if raw is missing (it just omits those rows).

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
  density_lbft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

type QuotePricing = {
  total: number | null;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  // raw calc payload from either /api/quotes/calc or /api/ai/price
  raw?: any;
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
      maximumFractionDigits: 2
    }).format(Number(n));
  } catch {
    const v = Number(n);
    if (!isFinite(v)) return "";
    return `$${v.toFixed(2)}`;
  }
}

function htmlEscape(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// simple visual "input box" for the cavity section
function fauxInput(content: string = "&nbsp;") {
  return `<span style="display:inline-block; min-width:70px; padding:3px 6px; border-radius:4px; border:1px solid #d1d5db; background:#ffffff;">${content}</span>`;
}

export function renderQuoteEmail(input: QuoteRenderInput): string {
  const { specs, material, pricing, missing } = input;
  const facts = input.facts || {};
  const quoteNo = input.quoteNumber ? String(input.quoteNumber) : "";

  const exampleInput =
    (facts && (facts.exampleInput || facts.rawText || facts.originalEmail)) || "";

  const outsideSize = fmtDims(specs.L_in, specs.W_in, specs.H_in);
  const qtyStr = fmtQty(specs.qty);
  const qtyNum =
    specs.qty != null && !Number.isNaN(Number(specs.qty))
      ? Number(specs.qty)
      : null;
  const density = fmtDensity(specs.density_pcf);

  const thicknessUnder =
    specs.thickness_under_in != null &&
    isFinite(Number(specs.thickness_under_in)) &&
    Number(specs.thickness_under_in) > 0
      ? `${Number(specs.thickness_under_in).toFixed(2)}" under part`
      : "";

  // Foam family: prefer what the parser saw in the email ("PE") over DB name
  const foamFamily =
    specs.foam_family && specs.foam_family.trim()
      ? specs.foam_family.trim()
      : material?.name || "TBD";

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
    "https://alex-io.com";

  const printUrl =
    quoteNo !== ""
      ? `${baseUrl}/quote?quote_no=${encodeURIComponent(quoteNo)}`
      : undefined;

  const forwardToSalesEmail =
    process.env.NEXT_PUBLIC_SALES_FORWARD_TO || "sales@example.com";

  const salesSubject =
    quoteNo !== "" ? `Foam quote ${quoteNo}` : "Foam quote from Alex-IO";

  const forwardHref = `mailto:${encodeURIComponent(
    forwardToSalesEmail
  )}?subject=${encodeURIComponent(
    salesSubject
  )}&body=${encodeURIComponent(
    `Please review the attached foam quote.\n\nQuote number: ${quoteNo || "(not set)"}`
  )}`;

  // Scheduler: prefer explicit booking URL (e.g. Calendly); otherwise Google Calendar
  const schedulerBase =
    process.env.NEXT_PUBLIC_SALES_SCHEDULER_URL || "";
  const googleSchedule =
    quoteNo !== ""
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          `Call about foam quote ${quoteNo}`
        )}&details=${encodeURIComponent(
          `Let's review your foam packaging quote ${quoteNo} and any questions you might have.`
        )}`
      : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          "Foam quote call"
        )}`;
  const scheduleUrl = schedulerBase || googleSchedule;

  // Status badge (reuses the DB/status string when present)
  const rawStatus =
    (input.status ??
      (typeof facts.status === "string" ? facts.status : undefined) ??
      "") || "";
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
  const statusLabel =
    statusValue && statusValue !== "draft"
      ? statusValue.toUpperCase()
      : "";

  // Intro copy: neutral + "preliminary price"
  const introLine1 =
    "Thanks for the details—here’s a summary of the specs I pulled out of your email.";
  const introLine2 =
    "Great — I have everything I need for a preliminary price based on these specs.";

  // Missing items block
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
      ? `<div style="margin:8px 0 12px 0; padding:8px 10px; border-radius:6px; background:#fef3c7; color:#92400e; font-size:12px; line-height:1.4;">
  <div style="font-weight:600; margin-bottom:2px;">Still needed for a final price:</div>
  ${missingList}
</div>`
      : "";

  // Core pricing numbers
  const orderTotal = pricing.total;
  const orderTotalLabel =
    orderTotal != null && isFinite(Number(orderTotal))
      ? fmtMoney(orderTotal)
      : "TBD";

  const pieceCi =
    pricing.piece_ci != null && isFinite(Number(pricing.piece_ci))
      ? Number(pricing.piece_ci)
      : null;
  const orderCi =
    pricing.order_ci != null && isFinite(Number(pricing.order_ci))
      ? Number(pricing.order_ci)
      : null;
  const orderCiWaste =
    pricing.order_ci_with_waste != null &&
    isFinite(Number(pricing.order_ci_with_waste))
      ? Number(pricing.order_ci_with_waste)
      : null;

  const minChargeNote = pricing.used_min_charge
    ? `<span style="color:#4b5563; font-size:12px;">(minimum charge applied)</span>`
    : "";

  // Skiving-related info from raw pricing payload
  const raw = pricing.raw || facts.calc || null;
  let isSkived = false;
  let skiveEach: number | null = null;
  let skivePct: number | null = null;
  let setupFee: number | null = null;

  if (raw && typeof raw === "object") {
    // /api/quotes/calc shape
    if (typeof raw.is_skived === "boolean") {
      isSkived = raw.is_skived;
    }
    if (raw.skive_pct != null && isFinite(Number(raw.skive_pct))) {
      skivePct = Number(raw.skive_pct);
    }
    if (raw.skive_each != null && isFinite(Number(raw.skive_each))) {
      skiveEach = Number(raw.skive_each);
    }
    if (raw.setup_fee != null && isFinite(Number(raw.setup_fee))) {
      setupFee = Number(raw.setup_fee);
    }
    // /api/ai/price shape (applied.needsSkive, skive_each on root)
    if (raw.applied && typeof raw.applied.needsSkive === "boolean") {
      isSkived = raw.applied.needsSkive;
    }
    if (raw.skive_each != null && isFinite(Number(raw.skive_each))) {
      skiveEach = Number(raw.skive_each);
    }
  }

  // Price-break narrative line
  const priceBreakLine =
    qtyNum && orderTotal != null && isFinite(Number(orderTotal))
      ? `At ${qtyNum.toLocaleString()} pcs, this works out to about ${fmtMoney(
          Number(orderTotal) / qtyNum
        )} per piece.`
      : "Once we finalize quantity and material we can lay out formal price breaks.";

  // Cavity hints from facts (when the parser sees something)
  const parsedCavities: string[] = Array.isArray(facts.cavityDims)
    ? (facts.cavityDims as string[])
    : [];
  const cavityTotalCount =
    typeof facts.cavityCount === "number" && facts.cavityCount > 0
      ? facts.cavityCount
      : parsedCavities.length || null;

  // Buttons
  const forwardButton = `<a
  href="${htmlEscape(
    forwardHref
  )}"
  style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  Forward quote to sales
</a>`;

  const printButton =
    printUrl && quoteNo !== ""
      ? `<a
  href="${htmlEscape(
    printUrl
  )}"
  style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background:#2563eb; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  View printable quote
</a>`
      : "";

  const scheduleButton = `<a
  href="${htmlEscape(
    scheduleUrl
  )}"
  style="display:inline-block; padding:8px 14px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  Schedule a call
</a>`;

  // Example input block
  const exampleBlock =
    exampleInput && exampleInput.trim()
      ? `<div style="margin:0 0 12px 0;">
  <div style="padding:10px 12px; border-radius:6px; background:#eff6ff; font-size:12px; color:#1f2937; line-height:1.5;">
    <div style="font-weight:600; margin-bottom:2px;">Example input:</div>
    <div style="white-space:pre-wrap;">
      ${htmlEscape(exampleInput)}
    </div>
  </div>
</div>`
      : "";

  // Specs table (adds thickness row explicitly so we can talk about just H)
  const specsRows: string[] = [];

  specsRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; width:35%; color:#6b7280;">Outside size</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${outsideSize || "—"}</td>
    </tr>
  `);

  specsRows.push(`
    <tr style="background:#ffffff;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Quantity</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${qtyStr || "—"}</td>
    </tr>
  `);

  if (thicknessUnder) {
    specsRows.push(`
      <tr style="background:#f9fafb;">
        <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Thickness under part</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${thicknessUnder}</td>
      </tr>
    `);
  }

  specsRows.push(`
    <tr style="background:#ffffff;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Density</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${density || "TBD"}</td>
    </tr>
  `);

  specsRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Foam family</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${foamFamily || "TBD"}</td>
    </tr>
  `);

  const specsTable = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:8px;">
    <tbody>
      ${specsRows.join("\n")}
    </tbody>
  </table>`;

  // Pricing table (adds skiving rows)
  const pricingRows: string[] = [];

  // material line
  pricingRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; width:35%; color:#6b7280;">Material</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        foamFamily ? `${foamFamily}${density ? " — " + density : ""}` : density || "—"
      }</td>
    </tr>
  `);

  // kerf / waste
  pricingRows.push(`
    <tr style="background:#ffffff;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Material waste (kerf)</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        material.kerf_pct != null ? `${material.kerf_pct}%` : "0%"
      }</td>
    </tr>
  `);

  // piece CI
  pricingRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Piece volume (CI)</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        pieceCi != null ? `${pieceCi} in³` : "—"
      }</td>
    </tr>
  `);

  // order CI with waste
  pricingRows.push(`
    <tr style="background:#ffffff;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order volume + waste (CI)</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        orderCiWaste != null
          ? `${orderCiWaste} in³`
          : orderCi != null
          ? `${orderCi} in³`
          : "0 in³"
      }</td>
    </tr>
  `);

  // NEW: skiving indicator
  pricingRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Skiving</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        isSkived
          ? `Yes — includes skive for non-1&quot; thickness${
              skiveEach != null ? ` (~${fmtMoney(skiveEach)} per piece)` : ""
            }`
          : "Not needed for this thickness"
      }</td>
    </tr>
  `);

  // NEW: optional setup fee
  if (setupFee != null && setupFee > 0) {
    pricingRows.push(`
      <tr style="background:#ffffff;">
        <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Setup / skive fee</td>
        <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${fmtMoney(
          setupFee
        )}</td>
      </tr>
    `);
  }

  // minimum charge & total
  pricingRows.push(`
    <tr style="background:#f9fafb;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Minimum charge (if applied)</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
        material.min_charge != null ? fmtMoney(material.min_charge) : "$0.00"
      } ${minChargeNote}</td>
    </tr>
  `);

  pricingRows.push(`
    <tr style="background:#ffffff;">
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order total</td>
      <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827; font-weight:600;">${
        orderTotalLabel || fmtMoney(0)
      }</td>
    </tr>
  `);

  const pricingTable = `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:12px;">
    <tbody>
      ${pricingRows.join("\n")}
    </tbody>
  </table>`;

  // NEW: cavity details helper section
  const cavityLines: string[] = [];

  // top line: total number of cavities
  cavityLines.push(`
    <tr>
      <td style="padding:4px 0; color:#6b7280; font-size:12px;">Total number of cavities</td>
      <td style="padding:4px 0; text-align:right; font-size:12px;">
        ${fauxInput(
          cavityTotalCount != null
            ? htmlEscape(String(cavityTotalCount))
            : "&nbsp;"
        )}
      </td>
    </tr>
  `);

  const cavitySource = parsedCavities.length ? parsedCavities : ["", "", ""];

  cavitySource.slice(0, 5).forEach((cav, idx) => {
    const label = cav
      ? htmlEscape(cav)
      : "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;";
    cavityLines.push(`
      <tr>
        <td style="padding:3px 0; color:#6b7280; font-size:12px;">Cavity ${
          idx + 1
        } (L × W × depth)</td>
        <td style="padding:3px 0; text-align:right; font-size:12px;">
          ${fauxInput(label)} &nbsp; × &nbsp; ${fauxInput("qty")}
        </td>
      </tr>
    `);
  });

  const cavityBlock = `<div style="margin:12px 0 8px 0;">
  <h3 style="margin:0 0 4px 0; font-size:13px; color:#111827;">Cavity details</h3>
  <p style="margin:0 0 4px 0; font-size:12px; color:#4b5563;">
    If you have cavities in this foam, you can reply to this email and fill in the boxes below.
    If multiple cavities are the same size, just use the quantity field for that size.
  </p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; margin-top:4px;">
    <tbody>
      ${cavityLines.join("\n")}
    </tbody>
  </table>
</div>`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charSet="utf-8" />
    <title>Foam quote${quoteNo ? ` ${htmlEscape(quoteNo)}` : ""}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6; font-family:-apple-system, BlinkMacSystemFont, system-ui, sans-serif;">
    <div style="width:100%; padding:16px 0;">
      <div
        style="
          max-width:640px;
          margin:0 auto;
          background:#ffffff;
          border-radius:12px;
          padding:20px 20px 24px 20px;
          box-shadow:0 10px 25px rgba(15, 23, 42, 0.15);
          border:1px solid #e5e7eb;
        "
      >
        ${exampleBlock}

        <div style="margin-bottom:8px; font-size:13px; color:#111827;">
          <span style="font-weight:600;">${
            quoteNo ? `Quote # ${htmlEscape(quoteNo)}` : "Foam packaging quote"
          }</span>${
            statusLabel
              ? `<span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background-color:${statusBg}; color:${statusFg}; font-size:11px; font-weight:500;">${htmlEscape(
                  statusLabel
                )}</span>`
              : ""
          }
        </div>

        <p style="margin:0 0 2px 0; font-size:13px; color:#111827;">
          ${htmlEscape(introLine1)}
        </p>
        <p style="margin:0 0 8px 0; font-size:13px; color:#111827;">
          ${htmlEscape(introLine2)}
        </p>

        ${missingBlock}

        <h3 style="margin:10px 0 4px 0; font-size:13px; color:#111827;">Specs</h3>
        ${specsTable}

        <h3 style="margin:12px 0 4px 0; font-size:13px; color:#111827;">Pricing</h3>
        ${pricingTable}

        <h3 style="margin:12px 0 4px 0; font-size:13px; color:#111827;">Price breaks</h3>
        <p style="margin:0 0 4px 0; font-size:12px; color:#111827;">
          ${htmlEscape(priceBreakLine)}
        </p>
        <p style="margin:0 0 10px 0; font-size:12px; color:#4b5563;">
          If you&apos;d like, I can add formal price breaks at higher quantities (for example 2×, 3×, 5×, and 10× this volume) — just reply with the ranges you&apos;d like to see.
        </p>

        ${cavityBlock}

        <div style="margin:14px 0 0 0;">
          ${forwardButton}${printButton}${scheduleButton}
        </div>

        <p style="margin:14px 0 0 0; font-size:11px; color:#6b7280; line-height:1.5;">
          This is a preliminary price based on the information we have so far. We&apos;ll firm it up once we confirm any missing details or adjustments, and we can easily re-run the numbers if the quantity or material changes (including any skiving or non-standard thickness up-charges).
        </p>

        <p style="margin:4px 0 0 0; font-size:11px; color:#4b5563; line-height:1.5;">
          To continue, you can forward this quote to sales, schedule a call, or reply directly to this email with any revisions.
        </p>

        <p style="margin:14px 0 0 0; font-size:11px; color:#6b7280;">
          — Alex-IO Estimator
        </p>
      </div>
    </div>
  </body>
</html>`;
}
