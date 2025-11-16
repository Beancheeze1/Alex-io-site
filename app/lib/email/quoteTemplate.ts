// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Inputs come from app/api/ai/orchestrate/route.ts or app/api/ai/quote/route.ts
// via renderQuoteEmail(input).
// This version:
// - Shows Quote # at the top
// - Renders specs + pricing blocks
// - Adds buttons: Forward to sales, View printable quote, Schedule a call
// - Uses /quote?quote_no=... for the print view
// - Uses a neutral intro line (no "I'll price it later")
// - Adds a clear "preliminary price" + next-step instructions

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
  // allow the server to pass through the raw calc payload without TS error
  raw?: any;
};

export type QuoteRenderInput = {
  customerLine?: string | null; // still passed, but we don't echo the "I'll price later" text
  quoteNumber?: string | number | null;
  specs: QuoteSpecs;
  material: QuoteMaterial;
  pricing: QuotePricing;
  missing: string[];
  // OPTIONAL so older callers (like app/api/ai/quote/route.ts) still compile
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
  const density = fmtDensity(specs.density_pcf);
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
    process.env.NEXT_PUBLIC_SALES_FORWARD_TO ||
    "sales@example.com";

  const salesSubject =
    quoteNo !== ""
      ? `Foam quote ${quoteNo}`
      : "Foam quote from Alex-IO";

  const scheduleUrl =
    quoteNo !== ""
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          `Call about foam quote ${quoteNo}`
        )}&details=${encodeURIComponent(
          `Let's review your foam packaging quote ${quoteNo} and any questions you might have.`
        )}`
      : `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
          "Foam quote call"
        )}`;

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
            ? `<div style="font-size:12px; background:#f9fafb; border-radius:10px; padding:10px 12px; border:1px solid #e5e7eb; margin-bottom:12px;">
  <div style="font-weight:500; color:#4b5563; margin-bottom:4px;">Example input:</div>
  <div style="color:#374151; white-space:pre-wrap;">${htmlEscape(
    String(exampleInput)
  )}</div>
</div>`
            : ""
        }

        ${
          quoteNo
            ? `<div style="margin-bottom:8px; font-size:13px; color:#111827;">
  <span style="font-weight:600;">Quote # ${htmlEscape(quoteNo)}</span>
</div>`
            : ""
        }

        <p style="margin:0 0 8px 0; font-size:13px; color:#111827;">
          ${htmlEscape(introLine)}
        </p>

        ${missingBlock}

        <h3 style="margin:16px 0 4px 0; font-size:13px; color:#111827;">Specs</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:8px;">
          <tbody>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; width:35%; color:#6b7280;">Outside size</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${outsideSize || "—"}</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Quantity</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${qty || "—"}</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Density</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${density || "TBD"}</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Foam family</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${foamFamily || "TBD"}</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:12px 0 4px 0; font-size:13px; color:#111827;">Pricing</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:12px;">
          <tbody>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; width:35%; color:#6b7280;">Material</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${density || "—"}</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Material waste (kerf)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                material.kerf_pct != null ? `${material.kerf_pct}%` : "0%"
              }</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Piece volume (CI)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                pricing.piece_ci != null ? pricing.piece_ci : "0 in³"
              }</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order volume + waste (CI)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                pricing.order_ci_with_waste != null
                  ? pricing.order_ci_with_waste
                  : pricing.order_ci != null
                  ? pricing.order_ci
                  : "0 in³"
              }</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Minimum charge (if applied)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                pricing.used_min_charge && material.min_charge != null
                  ? fmtMoney(material.min_charge)
                  : fmtMoney(0)
              }</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order total</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827; font-weight:600;">${
                orderTotal != null ? fmtMoney(orderTotal) : fmtMoney(0)
              }</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:8px;">
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
              background:#eef2ff;
              color:#1d4ed8;
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid #c7d2fe;
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
              background:#ecfdf3;
              color:#15803d;
              font-size:12px;
              font-weight:500;
              text-decoration:none;
              border:1px solid #bbf7d0;
            "
          >
            Schedule a call
          </a>
        </div>

        <p style="margin:16px 0 4px 0; font-size:11px; color:#4b5563; line-height:1.5;">
          This is a preliminary price based on the information we have so far. We&apos;ll firm it up once we confirm any missing details or adjustments, and we can easily re-run the numbers if the quantity or material changes (including any skiving or non-standard thickness up-charges).
        </p>

        <p style="margin:4px 0 0 0; font-size:11px; color:#4b5563; line-height:1.5;">
          To continue, you can forward this quote to sales, schedule a call, or reply directly to this email with any revisions.
        </p>

        <p style="margin:16px 0 0 0; font-size:11px; color:#6b7280;">
          — Alex-IO Estimator
        </p>
      </div>
    </div>
  </body>
</html>`;
}
