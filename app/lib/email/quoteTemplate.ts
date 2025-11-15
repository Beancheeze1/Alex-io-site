// app/lib/email/quoteTemplate.ts
import { usd } from "@/app/lib/money";

const EXAMPLE_INPUT_HTML = `
<div style="margin:6px 0 10px 0;padding:8px 10px;border-radius:8px;background:#f4f4f8;border:1px solid #ddd;">
  <div style="font-weight:600;margin-bottom:2px;">Example of a great first message:</div>
  <div style="font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;line-height:1.2;margin:0;">
    Outside size: 18x12x3 in<br/>
    Quantity: 250<br/>
    Foam family: EPE<br/>
    Density: 1.7 lb<br/>
    Cavities: 2<br/>
    Cavity sizes: Ø6x1, 3x3x1
  </div>
</div>
`.trim();



type QuoteRenderInput = {
  customerLine?: string;               // e.g., "Thanks for reaching out — here’s your preliminary quote."
  specs: {
    L_in: number; W_in: number; H_in: number;
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

  const specsTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
    ${row("Outside size", `${s.L_in} × ${s.W_in} × ${s.H_in} in`)}
    ${s.thickness_under_in!=null ? row("Thickness under", `${s.thickness_under_in} in`) : ""}
    ${row("Quantity", String(s.qty))}
    ${s.density_pcf!=null ? row("Density", `${s.density_pcf} pcf`) : ""}
    ${s.foam_family ? row("Foam family", s.foam_family.toUpperCase()) : ""}
    ${s.color ? row("Color", s.color) : ""}
  </table>`;

  const matBits: string[] = [];
  if (m.name) matBits.push(m.name);
  if (m.density_lbft3!=null) matBits.push(`${m.density_lbft3} pcf`);
  const matLine = matBits.length ? matBits.join(" — ") : "TBD";

  const priceTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px">
    ${row("Material", matLine)}
    ${row("Material waste (kerf)", `${m.kerf_pct ?? 0}%`)}
    ${row("Piece volume (CI)", `${p.piece_ci.toFixed(0)} in³`)}
    ${row("Order volume + waste (CI)", `${p.order_ci_with_waste.toFixed(0)} in³`)}
    ${p.raw!=null ? row("Computed price", usd(p.raw)) : ""}
    ${row("Minimum charge", usd(m.min_charge ?? 0))}
    ${row("Prelim total", usd(p.total))}
  </table>
  `;

  const missingList = (i.missing && i.missing.length)
    ? `<p style="margin:12px 0 6px 0">To finalize, please confirm:</p>
       <ul style="margin:0 0 12px 20px">${i.missing.slice(0,6).map(x=>`<li>${x}</li>`).join("")}</ul>`
    : "";

  const exampleBlock =
    i.missing && i.missing.length ? EXAMPLE_INPUT_HTML : "";



  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">
    ${exampleBlock}
    <p style="margin:0 0 12px 0;">
      ${i.customerLine || "Thanks for reaching out — here’s your preliminary quote."}
    </p>
    ${missingList}
    <h3 style="margin:14px 0 8px 0">Specs</h3>
    ${specsTable}
    <h3 style="margin:18px 0 8px 0">Pricing</h3>
    ${priceTable}
    <p style="color:#666;margin-top:12px">This is a preliminary price based on the details above. I’ll firm it up once we confirm any missing info or adjustments.</p>
    <p>— Alex-IO Estimator</p>
  </div>
  `.trim();
}
