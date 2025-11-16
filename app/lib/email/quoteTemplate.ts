// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Inputs come from app/api/ai/orchestrate/route.ts via renderQuoteEmail(input).
// This version:
// - Shows Quote # at the top with a status pill (DRAFT / SENT / ACCEPTED, etc.)
// - Renders specs + pricing blocks in compact light-blue tables
// - Adds buttons: Forward to sales, View printable quote, Schedule a call
// - Uses /quote?quote_no=... for the print view
// - Uses a neutral intro line (no "I'll price it later")
// - Adds a clear "preliminary price" + next-step instructions
// - Shows a Price breaks section with bold price-per-piece
// - Shows skiving info and thickness under part

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

export type QuotePricing = {
  total: number | null;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  // raw calc payload from /api/quotes/calc (for future use)
  raw?: any;
};

export type QuoteRenderInput = {
  customerLine?: string | null; // still passed, but we don't echo the "I'll price later" text
  quoteNumber?: string | number | null;
  // status for the pill (e.g. "draft", "sent", "accepted")
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

export function renderQuoteEmail(input: QuoteRenderInput): string {
  const { specs, material, pricing, missing } = input;
  const facts = input.facts || {};

  const quoteNo = input.quoteNumber ? String(input.quoteNumber) : "";
  const exampleInput =
    (facts && (facts.exampleInput || facts.rawText || facts.originalEmail)) || "";

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

  const forwardToSalesEmail =
    process.env.NEXT_PUBLIC_SALES_FORWARD_TO ||
    "sales@example.com";

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
    `Please review the attached foam quote.\n\nQuote number: ${quoteNo || "(not set)"}`
  )}`;

  const introLine =
    "Thanks for the details—here’s a preliminary quote based on the information we have so far.";

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
  if (
    thicknessForSkive != null &&
    !Number.isNaN(Number(thicknessForSkive))
  ) {
    const h = Number(thicknessForSkive);
    if (Math.abs(h - Math.round(h)) > 1e-2) {
      skivingText = 'Yes — includes skive for non-1" thickness';
    }
  }

  // Price-break line with bold per-piece price when available
  let priceBreakHtml: string;
  if (piecePrice != null) {
    const qtyLabel = qty || "this";
    priceBreakHtml = `At ${htmlEscape(
      String(qtyLabel)
    )} pcs, this works out to about <span style="font-weight:600;">${fmtMoney(
      piecePrice
    )}</span> per piece.`;
  } else if (qty) {
    priceBreakHtml = htmlEscape(
      `At ${qty} pcs, this works out to the total shown above.`
    );
  } else {
    priceBreakHtml = htmlEscape(
      "This works out to the total shown above based on the specs provided."
    );
  }

  // Shared colors
  const lightBlueBg = "#eef2ff";
  const lightBlueBorder = "#c7d2fe";
  const darkBlue = "#1d4ed8";

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charSet="utf-8" />
    <title>Foam quote${quoteNo ? " " + quoteNo : ""}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6;">
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:16px; background-color:#f3f4f6;">
      <div style="max-width:720px; margin:0 auto; background-color:#ffffff; border-radius:16px; padding:20px 24px 24px 24px; box-shadow:0 10px 30px rgba(15,23,42,0.08);">

        ${
          exampleInput
            ? `<div style="font-size:12px; background:${lightBlueBg}; border-radius:10px; padding:8px 10px; border:1px solid ${lightBlueBorder}; margin-bottom:10px;">
  <div style="font-weight:500; color:${darkBlue}; margin-bottom:2px;">Example input:</div>
  <div style="color:#374151; white-space:pre-wrap;">${htmlEscape(
    String(exampleInput)
  )}</div>
</div>`
            : ""
        }

        <div style="margin-bottom:8px; font-size:13px; color:#111827;">
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
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#6b7280;">Foam family</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${foamFamily || "TBD"}</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:10px 0 3px 0; font-size:13px; color:${darkBlue};">Pricing</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:8px;">
          <tbody>
            <tr style="background:${lightBlueBg};">
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; width:35%; color:#6b7280;">Material</td>
              <td style="padding:4px 8px; border:1px solid ${lightBlueBorder}; color:#111827;">${
                foamFamily ? `${foamFamily}${density ? " — " + density : ""}` : density || "—"
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

        <h3 style="margin:10px 0 3px 0; font-size:13px; color:${darkBlue};">Price breaks</h3>
        <p style="margin:0 0 4px 0; font-size:12px; color:#111827;">
          ${priceBreakHtml}
        </p>
        <p style="margin:0 0 6px 0; font-size:12px; color:#4b5563;">
          If you&apos;d like, I can add formal price breaks at higher quantities (for example 2×, 3×, 5×, and 10× this volume) — just reply with the ranges you&apos;d like to see.
        </p>
        <p style="margin:0 0 10px 0; font-size:12px; color:#4b5563;">
          For cavities, replying with a short list like “2×3×1 qty 4; Ø6×1 qty 2” works best — I&apos;ll keep that separate from the overall outside size.
        </p>

        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:8px;">
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
        </div>

        <p style="margin:14px 0 4px 0; font-size:11px; color:#4b5563; line-height:1.5;">
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
