// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// Input shape (from orchestrator):
//
// templateInput = {
//   customerLine: string,
//   quoteNumber: string,
//   summaryLine: string,
//   specsSummary: string,
//   dimsTableHtml: string,
//   layoutPreviewHtml?: string,
//   notesHtml?: string,
//   pricingBlocksHtml: string,
//   footerNoteHtml?: string,
//   termsHtml?: string,
//   companyName?: string,
//   phone?: string,
//   email?: string,
//   website?: string,
//   address?: string,
//   logoUrl?: string,
//   logoAlt?: string,
//   quoteStatus?: string,
//   actionsHtml?: string,
//   meta?: Record<string, string | number | null | undefined>,
// };
//
// This file is intentionally "dumb": all layout + styling is here.
// The orchestrator just provides HTML fragments for sections.
//

export type QuoteTemplateInput = {
  customerLine: string;
  quoteNumber: string;
  summaryLine: string;
  specsSummary: string;
  dimsTableHtml: string;
  layoutPreviewHtml?: string;
  notesHtml?: string;
  pricingBlocksHtml: string;
  footerNoteHtml?: string;
  termsHtml?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  logoUrl?: string;
  logoAlt?: string;
  quoteStatus?: string;
  actionsHtml?: string;
  meta?: Record<string, string | number | null | undefined>;
};

export function buildQuoteHtmlTemplate(input: QuoteTemplateInput): string {
  const {
    customerLine,
    quoteNumber,
    summaryLine,
    specsSummary,
    dimsTableHtml,
    layoutPreviewHtml,
    notesHtml,
    pricingBlocksHtml,
    footerNoteHtml,
    termsHtml,
    companyName,
    phone,
    email,
    website,
    address,
    logoUrl,
    logoAlt,
    quoteStatus,
    actionsHtml,
    meta,
  } = input;

  // Basic logo block – falls back if no logo is present.
  const logoBlock = logoUrl
    ? `
      <tr>
        <td style="padding: 24px 24px 12px 24px; text-align: left;">
          <img src="${logoUrl}" alt="${logoAlt ?? "Company Logo"}"
               style="max-width: 200px; height: auto; display: block;" />
        </td>
      </tr>
    `
    : `
      <tr>
        <td style="padding: 24px 24px 12px 24px; text-align: left;">
          <div style="
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #0f172a;
          ">
            ${companyName ?? "Your Company"}
          </div>
        </td>
      </tr>
    `;

  // Company + contact block in the upper-right.
  const contactBlocks: string[] = [];

  if (companyName) {
    contactBlocks.push(
      `<div style="font-weight: 600; color: #111827; margin-bottom: 2px;">${companyName}</div>`
    );
  }

  if (address) {
    contactBlocks.push(
      `<div style="font-size: 12px; color: #6b7280; margin-bottom: 2px;">${address}</div>`
    );
  }

  if (phone) {
    contactBlocks.push(
      `<div style="font-size: 12px; color: #6b7280; margin-bottom: 2px;">Phone: ${phone}</div>`
    );
  }

  if (email) {
    contactBlocks.push(
      `<div style="font-size: 12px; color: #6b7280; margin-bottom: 2px;">Email: ${email}</div>`
    );
  }

  if (website) {
    contactBlocks.push(
      `<div style="font-size: 12px; color: #3b82f6; margin-bottom: 2px;">
         <a href="${website}" style="color: #3b82f6; text-decoration: none;">${website}</a>
       </div>`
    );
  }

  const contactBlockHtml =
    contactBlocks.length > 0
      ? `
      <tr>
        <td style="padding: 16px 24px 0 24px; text-align: right; vertical-align: top;">
          ${contactBlocks.join("")}
        </td>
      </tr>
    `
      : "";

  // Badge color depending on status, if provided.
  let statusColorBg = "#e5e7eb";
  let statusColorText = "#111827";

  if (quoteStatus) {
    const normalized = quoteStatus.toLowerCase();
    if (normalized.includes("draft")) {
      statusColorBg = "#eff6ff";
      statusColorText = "#1d4ed8";
    } else if (normalized.includes("pending")) {
      statusColorBg = "#fff7ed";
      statusColorText = "#c2410c";
    } else if (normalized.includes("approved") || normalized.includes("accepted")) {
      statusColorBg = "#ecfdf3";
      statusColorText = "#15803d";
    } else if (normalized.includes("expired")) {
      statusColorBg = "#fef2f2";
      statusColorText = "#b91c1c";
    }
  }

  const statusBadge = quoteStatus
    ? `
      <span style="
        display: inline-block;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        background-color: ${statusColorBg};
        color: ${statusColorText};
      ">
        ${quoteStatus}
      </span>
    `
    : "";

  // The top "hero" area with quote number + summary line + status pill.
  const heroSection = `
    <tr>
      <td colspan="2" style="padding: 16px 24px 16px 24px;">
        <div style="
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        ">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <div style="
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: #6b7280;
            ">
              Quote
            </div>
            <div style="
              font-size: 20px;
              font-weight: 700;
              color: #111827;
              letter-spacing: 0.03em;
            ">
              ${quoteNumber}
            </div>
          </div>
          <div style="
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 6px;
          ">
            ${statusBadge}
            <div style="font-size: 13px; color: #4b5563; max-width: 260px; text-align: right;">
              ${summaryLine}
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;

  // Customer line – big "To:" area.
  const toLine = `
    <tr>
      <td colspan="2" style="padding: 0 24px 16px 24px;">
        <div style="
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          padding: 12px 14px;
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 8px;
        ">
          <div style="
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 600;
            color: #6b7280;
            padding-right: 8px;
            border-right: 1px solid #e5e7eb;
          ">
            To
          </div>
          <div style="
            font-size: 14px;
            font-weight: 500;
            color: #111827;
          ">
            ${customerLine}
          </div>
        </div>
      </td>
    </tr>
  `;

  // Specs + dims area as two side-by-side cards.

  const specsCard = `
    <td style="padding: 0 12px 0 24px; vertical-align: top; width: 50%;">
      <div style="
        border-radius: 14px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        padding: 14px 14px 12px 14px;
      ">
        <div style="
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 8px;
        ">
          <div style="
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 600;
            color: #6b7280;
          ">
            Specs
          </div>
        </div>
        <div style="font-size: 13px; color: #374151; line-height: 1.5;">
          ${specsSummary}
        </div>
      </div>
    </td>
  `;

  const dimsCard = `
    <td style="padding: 0 24px 0 12px; vertical-align: top; width: 50%;">
      <div style="
        border-radius: 14px;
        border: 1px solid #e5e7eb;
        background: #ffffff;
        padding: 14px 14px 12px 14px;
      ">
        <div style="
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 8px;
        ">
          <div style="
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            font-weight: 600;
            color: #6b7280;
          ">
            Dimensions
          </div>
        </div>
        <div style="font-size: 13px; color: #374151; line-height: 1.5;">
          ${dimsTableHtml}
        </div>
      </div>
    </td>
  `;

  const specsAndDimsRow = `
    <tr>
      ${specsCard}
      ${dimsCard}
    </tr>
  `;

  // Optional layout preview card.
  const layoutPreviewSection = layoutPreviewHtml
    ? `
      <tr>
        <td colspan="2" style="padding: 16px 24px 4px 24px;">
          <div style="
            border-radius: 14px;
            border: 1px dashed #d1d5db;
            background: #f9fafb;
            padding: 14px 14px 12px 14px;
          ">
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              margin-bottom: 8px;
            ">
              <div style="
                font-size: 11px;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                font-weight: 600;
                color: #6b7280;
              ">
                Layout preview
              </div>
              <div style="font-size: 11px; color: #9ca3af; text-align: right;">
                Top-down sketch – not to exact scale
              </div>
            </div>
            <div style="font-size: 13px; color: #374151;">
              ${layoutPreviewHtml}
            </div>
          </div>
        </td>
      </tr>
    `
    : "";

  // Optional notes / assumptions block.
  const notesSection = notesHtml
    ? `
      <tr>
        <td colspan="2" style="padding: 8px 24px 4px 24px;">
          <div style="
            border-radius: 14px;
            border: 1px solid #e5e7eb;
            background: #ffffff;
            padding: 14px 14px 12px 14px;
          ">
            <div style="
              font-size: 11px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              font-weight: 600;
              color: #6b7280;
              margin-bottom: 6px;
            ">
              Notes &amp; assumptions
            </div>
            <div style="font-size: 13px; color: #374151; line-height: 1.5;">
              ${notesHtml}
            </div>
          </div>
        </td>
      </tr>
    `
    : "";

  // Pricing section – orchestrator passes full HTML for blocks.
  const pricingSection = `
    <tr>
      <td colspan="2" style="padding: 12px 24px 8px 24px;">
        <div style="
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          padding: 16px 16px 12px 16px;
        ">
          <div style="
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            margin-bottom: 10px;
          ">
            <div style="
              font-size: 11px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              font-weight: 600;
              color: #6b7280;
            ">
              Pricing
            </div>
            <div style="font-size: 11px; color: #9ca3af;">
              All amounts in USD unless noted otherwise
            </div>
          </div>
          <div style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 10px;
          ">
            ${pricingBlocksHtml}
          </div>
        </div>
      </td>
    </tr>
  `;

  // Optional actions section – CTA buttons or links.
  const actionsSection = actionsHtml
    ? `
      <tr>
        <td colspan="2" style="padding: 10px 24px 10px 24px;">
          <div style="
            border-radius: 12px;
            border: 1px dashed #d1d5db;
            background: #f9fafb;
            padding: 12px 14px;
          ">
            <div style="
              font-size: 11px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              font-weight: 600;
              color: #6b7280;
              margin-bottom: 6px;
            ">
              Next steps
            </div>
            <div style="font-size: 13px; color: #374151; display: flex; flex-wrap: wrap; gap: 8px;">
              ${actionsHtml}
            </div>
          </div>
        </td>
      </tr>
    `
    : "";

  // Optional footer note.
  const footerNoteSection = footerNoteHtml
    ? `
      <tr>
        <td colspan="2" style="padding: 6px 24px 0 24px;">
          <div style="font-size: 11px; color: #6b7280; line-height: 1.6;">
            ${footerNoteHtml}
          </div>
        </td>
      </tr>
    `
    : "";

  // Optional terms block.
  const termsSection = termsHtml
    ? `
      <tr>
        <td colspan="2" style="padding: 8px 24px 0 24px;">
          <div style="
            border-top: 1px solid #e5e7eb;
            margin-top: 8px;
            padding-top: 10px;
            font-size: 11px;
            color: #6b7280;
            line-height: 1.6;
          ">
            ${termsHtml}
          </div>
        </td>
      </tr>
    `
    : "";

  // Optional meta block at very bottom as tiny text.
  let metaRows: string[] = [];
  if (meta) {
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined || value === null || value === "") continue;
      metaRows.push(
        `<tr><td style="padding: 0 24px; font-size: 10px; color: #9ca3af;">${key}: ${String(
          value
        )}</td></tr>`
      );
    }
  }

  const metaSection =
    metaRows.length > 0
      ? `
      <tr>
        <td colspan="2" style="padding-top: 8px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
            ${metaRows.join("")}
          </table>
        </td>
      </tr>
    `
      : "";

  // Final HTML (table-based, email-safe).
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${quoteNumber} – Foam Quote</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body style="margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
      <tr>
        <td align="center" style="padding: 24px 8px;">
          <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="
            border-collapse: collapse;
            background: linear-gradient(135deg, #f3f4f6 0%, #ffffff 40%, #eff6ff 100%);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
          ">
            <!-- Header: logo + contact -->
            <tr>
              <td colspan="2" style="padding: 0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                  ${logoBlock}
                  ${contactBlockHtml}
                </table>
              </td>
            </tr>

            <!-- Hero: quote number, status, summary -->
            ${heroSection}

            <!-- Customer line -->
            ${toLine}

            <!-- Spacer -->
            <tr>
              <td colspan="2" style="height: 6px;"></td>
            </tr>

            <!-- Specs + Dimensions row -->
            ${specsAndDimsRow}

            <!-- Layout preview -->
            ${layoutPreviewSection}

            <!-- Notes & assumptions -->
            ${notesSection}

            <!-- Pricing -->
            ${pricingSection}

            <!-- Actions / CTAs -->
            ${actionsSection}

            <!-- Footer note + terms + meta -->
            ${footerNoteSection}
            ${termsSection}
            ${metaSection}

            <!-- Bottom spacer -->
            <tr>
              <td colspan="2" style="height: 16px;"></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;
}
