// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Used by orchestrator and AI quote routes via renderQuoteEmail(input).
// Layout matches the earlier version (Specs, Pricing, Price breaks) with:
// - Quote # at the top
// - Example input block
// - 3 buttons: Forward quote to sales, View printable quote, Schedule a call
//   (Schedule button matches the dark blue of Forward, and comes third)
// - Neutral intro (no "I'll get you a price later")
// - Clear preliminary price + next-step instructions
//
// Schedule button behavior:
// - If NEXT_PUBLIC_SALES_SCHEDULER_URL is set (e.g. a Calendly link),
//   we use that directly.
// - Otherwise we generate a Google Calendar "create event" link prefilled
//   with "Foam quote call" and the quote number in the description.
//
// This file is PATH-A: minimal change and compatible with existing callers.

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
  // allow server routes to pass through the raw calc payload
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
  // optional so older callers still compile
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
  const v = Number(n);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

function htmlEscape(str: string) {
  return str
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

  const rawStatus =
    (input.status ??
      (typeof (facts as any).status === "string" ? (facts as any).status : undefined) ??
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

  const outsideSize = fmtDims(specs.L_in, specs.W_in, specs.H_in);
  const qtyStr = fmtQty(specs.qty);
  const qtyNum =
    specs.qty != null && !Number.isNaN(Number(specs.qty))
      ? Number(specs.qty)
      : null;
  const density = fmtDensity(specs.density_pcf);

  const thicknessUnder =
    specs.thickness_under_in != null &&
    Number.isFinite(Number(specs.thickness_under_in)) &&
    Number(specs.thickness_under_in) > 0
      ? `${Number(specs.thickness_under_in).toFixed(2)}" under part`
      : "";

  const cavityDims: string[] = Array.isArray((facts as any).cavityDims)
    ? ((facts as any).cavityDims as string[])
    : [];
  const cavityCount =
    typeof (facts as any).cavityCount === "number" && (facts as any).cavityCount > 0
      ? (facts as any).cavityCount
      : cavityDims.length || 0;
  const cavitySummary =
    cavityCount > 0
      ? `${cavityCount} cavities` +
        (cavityDims.length
          ? ` — ${cavityDims.join(", ")}`
          : " (sizes to confirm)")
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
    process.env.NEXT_PUBLIC_SALES_FORWARD_TO ||
    "sales@example.com";

  const salesSubject =
    quoteNo !== ""
      ? `Foam quote ${quoteNo}`
      : "Foam quote from Alex-IO";

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

  // Neutral intro line (matches your previous template)
  const introLine =
    "Thanks for the details—I’ll review a couple of specs and get back to you with a price shortly.\n\nGreat — I have everything I need for a preliminary price based on these specs.";

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
      ? `<p style="margin:8px 0 4px 0; font-size:13px; color:#111827;">
To finalize, please confirm:</p>
${missingList}`
      : "";

  const orderTotal = pricing.total ?? null;

  const raw = (pricing.raw as any) || (facts as any).calc || null;
  let isSkived = false;
  let skiveEach: number | null = null;

  if (raw && typeof raw === "object") {
    if (typeof (raw as any).is_skived === "boolean") {
      isSkived = !!(raw as any).is_skived;
    }
    if ((raw as any).skive_each != null && Number.isFinite(Number((raw as any).skive_each))) {
      skiveEach = Number((raw as any).skive_each);
    }
    if ((raw as any).applied && typeof (raw as any).applied.needsSkive === "boolean") {
      isSkived = !!(raw as any).applied.needsSkive;
    }
  }

  // Fallback: any non-integer thickness ⇒ skive
  if (!isSkived && specs.H_in != null && Number.isFinite(Number(specs.H_in))) {
    const H = Number(specs.H_in);
    const nearest = Math.round(H);
    if (Math.abs(H - nearest) > 1e-2) {
      isSkived = true;
    }
  }

  const piecePrice =
    orderTotal != null && qtyNum && qtyNum > 0
      ? orderTotal / qtyNum
      : null;

  const priceBreakLine =
    piecePrice != null
      ? `At ${qtyStr || "this"} pcs, this works out to about ${fmtMoney(
          piecePrice
        )} per piece.`
      : qtyStr
      ? `At ${qtyStr} pcs, this works out to the total shown above.`
      : `This works out to the total shown above based on the specs provided.`;

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charSet="utf-8" />
    <title>Foam quote${quoteNo ? " " + quoteNo : ""}</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f3f4f6;">
    <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:16px; background-color:#f3f4f6;">
      <div style="max-width:720px; margin:0 auto; background-color:#ffffff; border-radius:12px; padding:20px 24px 24px 24px; box-shadow:0 10px 30px rgba(15,23,42,0.08);">

        ${
          exampleInput
            ? `<div style="margin:0 0 12px 0;">
  <div style="padding:10px 12px; border-radius:6px; background:#eff6ff; font-size:12px; color:#1f2937; line-height:1.5;">
    <div style="font-weight:600; margin-bottom:2px;">Example input:</div>
    <div style="white-space:pre-wrap;">${htmlEscape(
      String(exampleInput)
    )}</div>
  </div>
</div>`
            : ""
        }

        <div style="margin-bottom:8px; font-size:13px; color:#111827;">
  ${
    quoteNo
      ? `<span style="font-weight:600;">Quote # ${htmlEscape(quoteNo)}</span>`
      : `<span style="font-weight:600;">Foam packaging quote</span>`
  }
  <span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background-color:${statusBg}; color:${statusFg}; font-size:11px; font-weight:500;">
    ${htmlEscape(statusLabel)}
  </span>
</div>

        <p style="margin:0 0 4px 0; font-size:13px; color:#111827;">
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
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${qtyStr || "—"}</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Density</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${density || "TBD"}</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Thickness under part</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${thicknessUnder || "—"}</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Foam family</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${foamFamily || "TBD"}</td>
            </tr>
            ${
              cavitySummary
                ? `<tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Cavities (L×W×depth)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${htmlEscape(cavitySummary)}</td>
            </tr>`
                : ""
            }
          </tbody>
        </table>

        <h3 style="margin:16px 0 4px 0; font-size:13px; color:#111827;">Pricing</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px; margin-bottom:12px;">
          <tbody>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; width:35%; color:#6b7280;">Material</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                foamFamily ? `${foamFamily}${density ? " — " + density : ""}` : density || "—"
              }</td>
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
                pricing.piece_ci != null ? `${pricing.piece_ci} in³` : "0 in³"
              }</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order volume + waste (CI)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                pricing.order_ci_with_waste != null
                  ? `${pricing.order_ci_with_waste} in³`
                  : pricing.order_ci != null
                  ? `${pricing.order_ci} in³`
                  : "0 in³"
              }</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Skiving</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                isSkived
                  ? `Yes — includes skive for non-1&quot; thickness${
                      skiveEach != null && skiveEach > 0
                        ? ` (~${fmtMoney(skiveEach)} per piece)`
                        : ""
                    }`
                  : "Not needed for this thickness"
              }</td>
            </tr>
            <tr style="background:#ffffff;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Minimum charge (if applied)</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827;">${
                pricing.used_min_charge && material.min_charge != null
                  ? fmtMoney(material.min_charge)
                  : fmtMoney(0)
              }</td>
            </tr>
            <tr style="background:#f9fafb;">
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#6b7280;">Order total</td>
              <td style="padding:6px 8px; border:1px solid #e5e7eb; color:#111827; font-weight:600;">${
                orderTotal != null ? fmtMoney(orderTotal) : fmtMoney(0)
              }</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:12px 0 4px 0; font-size:13px; color:#111827;">Price breaks</h3>
        <p style="margin:0 0 4px 0; font-size:12px; color:#111827;">
          ${htmlEscape(priceBreakLine)}
        </p>
        <p style="margin:0 0 8px 0; font-size:12px; color:#4b5563;">
          If you&apos;d like, I can add formal price breaks at higher quantities (for example 2×, 3×, 5×, and 10× this volume) — just reply with the ranges you&apos;d like to see.
        </p>
        <p style="margin:0 0 10px 0; font-size:12px; color:#4b5563;">
          For cavities, replying with a short list like “2×3×1 qty 4; Ø6×1 qty 2” works best — I’ll keep that separate from the overall outside size.
        </p>

        <div style="margin:8px 0 0 0;">
          <a
            href="${htmlEscape(
              forwardHref
            )}"
            style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
          >
            Forward quote to sales
          </a>
          ${
            printUrl && quoteNo !== ""
              ? `<a
            href="${htmlEscape(
              printUrl
            )}"
            style="display:inline-block; margin-right:8px; padding:8px 14px; border-radius:999px; background:#2563eb; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
          >
            View printable quote
          </a>`
              : ""
          }
          <a
            href="${htmlEscape(
              scheduleUrl
            )}"
            style="display:inline-block; padding:8px 14px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
          >
            Schedule a call
          </a>
        </div>

        <p style="margin:16px 0 0 0; font-size:11px; color:#6b7280; line-height:1.5;">
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
