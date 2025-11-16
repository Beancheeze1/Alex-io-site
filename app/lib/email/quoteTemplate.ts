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

type QuoteSpecs = {
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
  return `${L.toFixed(1)}" × ${W.toFixed(1)}" × ${H.toFixed(1)}"`;
}

function fmtQty(qty: string | number | null) {
  if (qty == null) return "";
  const n = Number(qty);
  if (!Number.isFinite(n)) return String(qty);
  if (Math.abs(n - Math.round(n)) < 1e-6) return `${Math.round(n)}`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDensity(d: number | null) {
  if (d == null || !Number.isFinite(d)) return "";
  return `${d.toFixed(1)} pcf`;
}

function fmtUSD(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD"
  });
}

function htmlEscape(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderQuoteEmail(input: QuoteRenderInput): string {
  const { specs, material, pricing, missing } = input;
  const facts = input.facts || {};
  const quoteNo = input.quoteNumber ? String(input.quoteNumber) : "";

  const rawStatusValue =
    (input.status ??
      (typeof facts.status === "string" ? facts.status : undefined) ??
      "") || "";
  const statusValue = rawStatusValue.trim().toLowerCase();
  let statusBg = "#e5e7eb";
  let statusFg = "#374151";
  if (statusValue === "sent") {
    statusBg = "#d1fae5";
    statusFg = "#065f46";
  } else if (statusValue === "accepted") {
    statusBg = "#bfdbfe";
    statusFg = "#1d4ed8";
  }
  const statusLabel = statusValue && statusValue !== "draft" ? statusValue.toUpperCase() : "";

  const exampleInput =
    (facts && (facts.exampleInput || facts.rawText || facts.originalEmail)) || "";

  const outsideSize = fmtDims(specs.L_in, specs.W_in, specs.H_in);
  const qtyStr = fmtQty(specs.qty);
  const qtyNum =
    specs.qty != null && !Number.isNaN(Number(specs.qty))
      ? Number(specs.qty)
      : null;
  const density = fmtDensity(specs.density_pcf);

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

  // Neutral intro line (no "I'll get you a price later")
  const introLine =
    "Thanks for the details—here’s a preliminary quote based on these specs.";

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

  const totalPrice = pricing.total;
  const totalLabel =
    totalPrice != null && Number.isFinite(totalPrice)
      ? fmtUSD(totalPrice)
      : "TBD";

  const pieceCi =
    pricing.piece_ci != null && Number.isFinite(pricing.piece_ci)
      ? pricing.piece_ci
      : null;
  const orderCi =
    pricing.order_ci != null && Number.isFinite(pricing.order_ci)
      ? pricing.order_ci
      : null;
  const orderCiWaste =
    pricing.order_ci_with_waste != null &&
    Number.isFinite(pricing.order_ci_with_waste)
      ? pricing.order_ci_with_waste
      : null;

  const minChargeNote = pricing.used_min_charge
    ? `<div style="margin-top:4px; font-size:11px; color:#4b5563;">
  <strong>Note:</strong> Minimum charge applies for this run.
</div>`
    : "";

  const specsRows: string[] = [];

  if (outsideSize) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Outside size</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${htmlEscape(
    outsideSize
  )}</td>
</tr>`
    );
  }
  if (qtyStr) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Quantity</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${htmlEscape(
    qtyStr
  )}</td>
</tr>`
    );
  }
  if (foamFamily) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Foam family</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${htmlEscape(
    foamFamily
  )}</td>
</tr>`
    );
  }
  if (density) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Density</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${htmlEscape(
    density
  )}</td>
</tr>`
    );
  }

  if (
    specs.thickness_under_in != null &&
    Number.isFinite(specs.thickness_under_in)
  ) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Thickness under part</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${specs.thickness_under_in?.toFixed(
    2
  )}"</td>
</tr>`
    );
  }

  if (specs.color && specs.color.trim()) {
    specsRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Color</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${htmlEscape(
    specs.color.trim()
  )}</td>
</tr>`
    );
  }

  const specsTable =
    specsRows.length > 0
      ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:13px;">
  <tbody>
${specsRows.join("\n")}
  </tbody>
</table>`
      : `<p style="margin:0; font-size:13px; color:#6b7280;">Specs are still being gathered.</p>`;

  const calcRows: string[] = [];

  if (pieceCi != null) {
    calcRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">CI per piece</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${pieceCi.toFixed(
        0
      )}</td>
</tr>`
    );
  }
  if (orderCi != null) {
    calcRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Total CI (no waste)</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${orderCi.toFixed(
        0
      )}</td>
</tr>`
    );
  }
  if (orderCiWaste != null) {
    calcRows.push(
      `<tr>
  <td style="padding:2px 0; color:#4b5563;">Total CI (with kerf)</td>
  <td style="padding:2px 0; text-align:right; color:#111827;">${orderCiWaste.toFixed(
        0
      )}</td>
</tr>`
    );
  }

  const calcTable =
    calcRows.length > 0
      ? `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:13px;">
  <tbody>
${calcRows.join("\n")}
  </tbody>
</table>`
      : `<p style="margin:0; font-size:13px; color:#6b7280;">Calculation details will appear once all specs are set.</p>`;

  const exampleBlock =
    exampleInput && exampleInput.trim()
      ? `<div style="margin:0 0 12px 0;">
  <div style="margin-bottom:4px; font-size:12px; font-weight:600; color:#111827;">Example input</div>
  <div style="padding:8px 10px; border-radius:6px; background:#eff6ff; font-size:12px; color:#1f2937; white-space:pre-wrap; line-height:1.5;">
    ${htmlEscape(exampleInput)}
  </div>
</div>`
      : "";

  const pricingBlock = `<div style="margin:0 0 12px 0;">
  <div style="margin-bottom:4px; font-size:12px; font-weight:600; color:#111827;">Pricing</div>
  <div style="padding:8px 10px; border-radius:6px; background:#e0f2fe; font-size:12px; color:#1f2937;">
    <div style="display:flex; justify-content:space-between; align-items:baseline;">
      <div style="font-size:13px;">Estimated charge for this run:</div>
      <div style="font-size:14px; font-weight:700;">${htmlEscape(
        totalLabel
      )}</div>
    </div>
    ${minChargeNote}
  </div>
</div>`;

  const priceBreaksBlock =
    qtyNum && totalPrice != null && Number.isFinite(totalPrice)
      ? (() => {
          const pricePerPiece = totalPrice / qtyNum;
          const break2Qty = Math.round(qtyNum * 2);
          const break3Qty = Math.round(qtyNum * 3);

          const break2Price = pricePerPiece * break2Qty * 0.95;
          const break3Price = pricePerPiece * break3Qty * 0.9;

          return `<div style="margin:0 0 12px 0;">
  <div style="margin-bottom:4px; font-size:12px; font-weight:600; color:#111827;">Price breaks (illustrative)</div>
  <div style="padding:8px 10px; border-radius:6px; background:#e0f2fe; font-size:12px; color:#1f2937;">
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:12px;">
      <tbody>
        <tr>
          <td style="padding:2px 0; color:#4b5563;">${qtyNum.toLocaleString()} pcs</td>
          <td style="padding:2px 0; text-align:right; color:#111827;">${fmtUSD(
            totalPrice
          )}</td>
        </tr>
        <tr>
          <td style="padding:2px 0; color:#4b5563;">${break2Qty.toLocaleString()} pcs (approx)</td>
          <td style="padding:2px 0; text-align:right; color:#111827;">${fmtUSD(
            break2Price
          )}</td>
        </tr>
        <tr>
          <td style="padding:2px 0; color:#4b5563;">${break3Qty.toLocaleString()} pcs (approx)</td>
          <td style="padding:2px 0; text-align:right; color:#111827;">${fmtUSD(
            break3Price
          )}</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:4px; font-size:11px; color:#4b5563;">
      These breaks are to illustrate how pricing can move with volume. Actual breaks can be fine-tuned when we finalize specs and quantities.
    </div>
  </div>
</div>`;
        })()
      : "";

  const printButton =
    printUrl && quoteNo !== ""
      ? `<a
  href="${htmlEscape(
    printUrl
  )}"
  style="display:inline-block; margin-right:8px; padding:8px 12px; border-radius:999px; background:#2563eb; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  View printable quote
</a>`
      : "";

  const forwardButton = `<a
  href="${htmlEscape(
    forwardHref
  )}"
  style="display:inline-block; margin-right:8px; padding:8px 12px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  Forward quote to sales
</a>`;

  const scheduleButton = `<a
  href="${htmlEscape(
    scheduleUrl
  )}"
  style="display:inline-block; padding:8px 12px; border-radius:999px; background:#1d4ed8; color:#ffffff; font-size:12px; font-weight:500; text-decoration:none;"
>
  Schedule a call
</a>`;

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
        <h1 style="margin:0 0 4px 0; font-size:18px; color:#111827;">
          Foam packaging quote
        </h1>

        ${
          quoteNo
            ? `<div style="margin-bottom:8px; font-size:13px; color:#111827;">
  <span style="font-weight:600;">Quote # ${htmlEscape(quoteNo)}</span>${
    statusLabel
      ? `<span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background-color:${statusBg}; color:${statusFg}; font-size:11px; font-weight:500;">${htmlEscape(
          statusLabel
        )}</span>`
      : ""
  }
</div>`
            : ""
        }

        <p style="margin:0 0 4px 0; font-size:13px; color:#111827;">
          ${htmlEscape(introLine)}
        </p>

        ${missingBlock}

        <h3 style="margin:16px 0 4px 0; font-size:13px; color:#111827;">Specs</h3>
        <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; font-size:13px;">
          <tbody>
            <tr>
              <td style="vertical-align:top; width:50%; padding-right:8px;">
                <div style="padding:8px 10px; border-radius:6px; background:#eff6ff;">
                  ${specsTable}
                </div>
              </td>
              <td style="vertical-align:top; width:50%; padding-left:8px;">
                <div style="padding:8px 10px; border-radius:6px; background:#e0f2fe;">
                  ${calcTable}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:16px 0 4px 0; font-size:13px; color:#111827;">Pricing</h3>
        ${pricingBlock}

        <h3 style="margin:16px 0 4px 0; font-size:13px; color:#111827;">Price breaks</h3>
        ${
          priceBreaksBlock ||
          `<p style="margin:0; font-size:13px; color:#6b7280;">
  Price breaks will appear once we finalize the base quantity and pricing.
</p>`
        }

        ${exampleBlock}

        <div style="margin:16px 0 0 0;">
          ${forwardButton}
          ${printButton}
          ${scheduleButton}
        </div>

        <p style="margin:16px 0 0 0; font-size:11px; color:#6b7280; line-height:1.5;">
          This is a working quote based on the information we have so far. We&apos;ll confirm final pricing once all specs, cavity details, and quantities are locked in.
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
