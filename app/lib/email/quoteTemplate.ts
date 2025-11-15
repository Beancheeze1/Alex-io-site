// app/lib/email/quoteTemplate.ts
import { usd } from "@/app/lib/money";

const EXAMPLE_INPUT_HTML = `
<div style="margin:6px 0 10px 0;padding:8px 10px;border-radius:8px;background:#f4f4f8;border:1px solid #ddd;">
  <div style="font-weight:600;margin-bottom:2px;">Example input:</div>
  <div style="font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;line-height:1.2;margin:0;">
    250 pcs — 10×10×3 in, 1.7 lb PE, 2 cavities (Ø6×0.5 in and 1×1×0.5 in).
  </div>
</div>
`.trim();

type QuoteRenderInput = {
  customerLine?: string;
  specs: {
    L_in: number;
    W_in: number;
    H_in: number;
    thickness_under_in?: number | null;
    qty: number;
    density_pcf?: number | null;
    foam_family?: string | null;
    color?: string | null;
  };
  material?: {
    name?: string | null;
    density_lbft3?: number | null;
    kerf_pct?: number | null;
    price_per_ci?: number | null;
    price_per_bf?: number | null;
    min_charge?: number | null;
  } | null;
  pricing: {
    piece_ci: number;
    order_ci: number;
    order_ci_with_waste: number;
    raw?: number | null;
    total: number;
    used_min_charge?: boolean;
  };
  missing?: string[];
};

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 8px;color:#555">${label}</td>
    <td style="padding:6px 8px;text-align:right;color:#111"><strong>${value}</strong></td>
  </tr>`;
}

export function renderQuoteEmail(i: QuoteRenderInput) {
  const s = i.specs;
  const p = i.pricing;
  const m = i.material || {};

  const dimsText =
    s.L_in && s.W_in && s.H_in ? `${s.L_in} × ${s.W_in} × ${s.H_in} in` : "TBD";
  const qtyText = s.qty ? s.qty.toLocaleString() : "TBD";
  const densityText =
    typeof s.density_pcf === "number" ? `${s.density_pcf} pcf` : "TBD";
  const foamFamilyText = s.foam_family || "TBD";

  const specsTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
    ${row("Outside size", dimsText)}
    ${row("Quantity", qtyText)}
    ${row("Density", densityText)}
    ${row("Foam family", foamFamilyText)}
  </table>
  `;

  const matBits: string[] = [];
  if (m.name) matBits.push(String(m.name));
  if (typeof m.density_lbft3 === "number") matBits.push(`${m.density_lbft3} pcf`);
  const matLine = matBits.length ? matBits.join(" — ") : "TBD";

  const minCharge = m.min_charge ?? 0;
  const totalLabel = p.used_min_charge
    ? "Order total (min charge applied)"
    : "Order total";

  const priceRows: string[] = [];
  priceRows.push(row("Material", matLine));
  priceRows.push(row("Material waste (kerf)", `${m.kerf_pct ?? 0}%`));
  priceRows.push(row("Piece volume (CI)", `${p.piece_ci.toFixed(0)} in³`));
  priceRows.push(
    row("Order volume + waste (CI)", `${p.order_ci_with_waste.toFixed(0)} in³`),
  );
  if (p.raw != null) {
    priceRows.push(row("Computed price (before min charge)", usd(p.raw)));
  }
  priceRows.push(row("Minimum charge (if applied)", usd(minCharge)));
  priceRows.push(row(totalLabel, usd(p.total)));

  const priceTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
    ${priceRows.join("")}
  </table>
  `;

  const perPiece =
    s.qty > 0 && p.total > 0 ? p.total / Math.max(1, s.qty) : null;

  let priceBreaksHtml = "";
  if (perPiece && s.qty > 0) {
    priceBreaksHtml = `
    <h3 style="margin:18px 0 8px 0">Price breaks</h3>
    <p style="margin:0 0 4px 0;">
      At ${s.qty.toLocaleString()} pcs, this works out to about <strong>${usd(
        perPiece,
      )}</strong> per piece.
    </p>
    <p style="margin:4px 0 0 0;color:#555;">
      If you'd like, I can add formal price breaks at higher quantities (for example 2×, 5×, or 10× this volume) — just reply with the ranges you'd like to see.
    </p>
    `;
  }

  const missingItems = (i.missing || []).filter((s) => !!s && s.trim().length);
  const missingList = missingItems.length
    ? `
      <p style="margin:0 0 8px 0;">To finalize, please confirm:</p>
      <ul style="margin:0 0 14px 18px;padding:0;color:#111;">
        ${missingItems.map((m) => `<li>${m}</li>`).join("")}
      </ul>
    `
    : `
      <p style="margin:0 0 12px 0;">
        Great — I have everything I need for a preliminary price based on these specs.
      </p>
    `;

  const exampleBlock = EXAMPLE_INPUT_HTML
    ? `<div style="margin-bottom:14px;">${EXAMPLE_INPUT_HTML}</div>`
    : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">
    ${exampleBlock}
    <p style="margin:0 0 12px 0;">
      ${i.customerLine || "Thanks for reaching out — here's your preliminary quote."}
    </p>
    ${missingList}
    <h3 style="margin:14px 0 8px 0">Specs</h3>
    ${specsTable}
    <h3 style="margin:18px 0 8px 0">Pricing</h3>
    ${priceTable}
    ${priceBreaksHtml}
    <p style="color:#666;margin-top:12px">
      This is a preliminary price based on the information we have so far. We'll firm it up once we confirm any missing details or adjustments, and we can easily re-run the numbers if the quantity or material changes.
    </p>
    <p>— Alex-IO Estimator</p>
  </div>
  `.trim();
}
