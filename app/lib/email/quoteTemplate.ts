// app/lib/email/quoteTemplate.ts

// Simple USD formatter so we don't depend on external helpers
function usd(value: number | null | undefined): string {
  const n =
    typeof value === "number" && isFinite(value)
      ? value
      : 0;

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const EXAMPLE_INPUT_HTML = `
<div style="margin:6px 0 10px 0;padding:8px 10px;border-radius:8px;background:#f4f4f8;border:1px solid #ddd;">
  <div style="font-weight:600;margin-bottom:2px;">Example input:</div>
  <div style="font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;line-height:1.2;margin:0;">
    250 pcs — 10×10×3 in, 1.7 lb black PE, 2 cavities (Ø6×0.5 in and 1×1×0.5 in).
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

    // Optional skiving-aware fields if the API ever provides them
    foam_only_total?: number | null;
    skive_surcharge?: number | null;
    grand_total?: number | null;
    is_skived?: boolean;
    skive_pct?: number | null;
  };
  missing?: string[];
};

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 8px;color:#555;font-size:13px;">${label}</td>
    <td style="padding:6px 8px;text-align:right;color:#111;font-size:13px;"><strong>${value}</strong></td>
  </tr>`;
}

export function renderQuoteEmail(i: QuoteRenderInput): string {
  const s = i.specs || ({} as QuoteRenderInput["specs"]);
  const p = i.pricing || ({} as QuoteRenderInput["pricing"]);
  const m = i.material || ({} as NonNullable<QuoteRenderInput["material"]>);

  /* ---------- Specs block ---------- */

  const dimsText =
    s.L_in && s.W_in && s.H_in ? `${s.L_in} × ${s.W_in} × ${s.H_in} in` : "TBD";
  const qtyText = s.qty ? s.qty.toLocaleString() : "TBD";
  const densityText =
    typeof s.density_pcf === "number" && isFinite(s.density_pcf)
      ? `${s.density_pcf} pcf`
      : "TBD";
  const foamFamilyText = s.foam_family || "TBD";

  const specsTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px;">
    ${row("Outside size", dimsText)}
    ${row("Quantity", qtyText)}
    ${row("Density", densityText)}
    ${row("Foam family", foamFamilyText)}
  </table>
  `;

  /* ---------- Pricing + skiving logic ---------- */

  const matBits: string[] = [];
  if (m.name) matBits.push(String(m.name));
  if (typeof m.density_lbft3 === "number" && isFinite(m.density_lbft3)) {
    matBits.push(`${m.density_lbft3} pcf`);
  }
  const matLine = matBits.length ? matBits.join(" — ") : "TBD";

  const kerfPct =
    typeof m.kerf_pct === "number" && isFinite(m.kerf_pct) ? m.kerf_pct : 0;

  const pieceCi =
    typeof p.piece_ci === "number" && isFinite(p.piece_ci) ? p.piece_ci : 0;
  const orderCi =
    typeof p.order_ci === "number" && isFinite(p.order_ci) ? p.order_ci : 0;
  const orderCiWaste =
    typeof p.order_ci_with_waste === "number" &&
    isFinite(p.order_ci_with_waste)
      ? p.order_ci_with_waste
      : orderCi;

  const baseTotal =
    typeof p.total === "number" && isFinite(p.total) ? p.total : 0;

  // Start with whatever "grand_total" the API gives, otherwise use total as grand total.
  let grandTotal =
    typeof p.grand_total === "number" && isFinite(p.grand_total)
      ? p.grand_total
      : baseTotal;

  let foamOnlyTotal =
    typeof p.foam_only_total === "number" && isFinite(p.foam_only_total)
      ? p.foam_only_total
      : null;

  let skiveSurcharge =
    typeof p.skive_surcharge === "number" && isFinite(p.skive_surcharge)
      ? p.skive_surcharge
      : null;

  let isSkived = !!p.is_skived;

  const usedMinCharge = !!p.used_min_charge;

  // If the API didn't give us a breakdown, derive it from thickness & a skive pct.
  if (!foamOnlyTotal && !skiveSurcharge) {
    // Thickness to check: prefer "thickness_under_in", fall back to H_in
    const thickness =
      typeof s.thickness_under_in === "number" && isFinite(s.thickness_under_in)
        ? s.thickness_under_in
        : s.H_in;

    const thicknessIsFractional =
      typeof thickness === "number" &&
      isFinite(thickness) &&
      Math.abs(thickness - Math.round(thickness)) > 1e-6;

    const skivePct =
      typeof p.skive_pct === "number" && p.skive_pct && p.skive_pct > 0
        ? p.skive_pct
        : 0.25; // default +25% upcharge, matches DB default skive_upcharge_pct

    if (thicknessIsFractional && grandTotal > 0 && !usedMinCharge) {
      const base = grandTotal / (1 + skivePct);
      foamOnlyTotal = base;
      skiveSurcharge = grandTotal - base;
      isSkived = true;
    }
  }

  const minCharge =
    typeof m.min_charge === "number" && isFinite(m.min_charge)
      ? m.min_charge
      : 0;

  const totalLabel = p.used_min_charge
    ? "Order total (min charge applied)"
    : "Order total";

  const priceRows: string[] = [];
  priceRows.push(row("Material", matLine));
  priceRows.push(row("Material waste (kerf)", `${kerfPct}%`));
  priceRows.push(row("Piece volume (CI)", `${pieceCi.toFixed(0)} in³`));
  priceRows.push(
    row("Order volume + waste (CI)", `${orderCiWaste.toFixed(0)} in³`),
  );

  if (p.raw != null && typeof p.raw === "number" && isFinite(p.raw)) {
    priceRows.push(row("Computed price (before min charge)", usd(p.raw)));
  }

  if (isSkived && foamOnlyTotal != null && skiveSurcharge != null) {
    // Option C: full layout + skiving breakdown
    priceRows.push(row("Total (foam only)", usd(foamOnlyTotal)));
    priceRows.push(
      row(
        "Skiving surcharge (non-standard thickness)",
        `<span style="color:#b91c1c;">${usd(skiveSurcharge)}</span>`,
      ),
    );
    priceRows.push(row("Grand total", usd(grandTotal)));
  } else {
    // Non-skived path: classic layout
    priceRows.push(
      row(
        "Minimum charge (if applied)",
        p.used_min_charge && minCharge > 0 ? usd(minCharge) : usd(0),
      ),
    );
    priceRows.push(row(totalLabel, usd(baseTotal)));
  }

  const priceTable = `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #eee;border-radius:8px;">
    ${priceRows.join("")}
  </table>
  `;

  /* ---------- Price breaks ---------- */

  const effectiveTotal =
    isSkived && foamOnlyTotal != null && skiveSurcharge != null
      ? grandTotal
      : baseTotal;

  const perPiece =
    s.qty > 0 && effectiveTotal > 0
      ? effectiveTotal / Math.max(1, s.qty)
      : null;

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
      If you'd like, I can add formal price breaks at higher quantities (for example 2×, 3×, 5×, and 10× this volume) — just reply with the ranges you'd like to see.
    </p>
    `;
  }

  /* ---------- Missing info / confirmation list ---------- */

  const missingItems = (i.missing || []).filter(
    (line) => !!line && line.trim().length,
  );
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

  /* ---------- Final HTML ---------- */

  const skiveFootnote =
    isSkived && foamOnlyTotal != null && skiveSurcharge != null
      ? `<p style="color:#b91c1c;margin:8px 0 0 0;font-size:12px;">
        * Skiving required because thickness is not in 1&quot; increments. Pricing above includes skiving surcharge and any applicable setup.
      </p>`
      : "";

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;">
    ${exampleBlock}
    <p style="margin:0 0 12px 0;">
      ${
        i.customerLine ||
        "Thanks for sharing the details; I'll review a couple of specifications and get back to you with a quote shortly."
      }
    </p>
    ${missingList}
    <h3 style="margin:14px 0 8px 0">Specs</h3>
    ${specsTable}
    <h3 style="margin:18px 0 8px 0">Pricing</h3>
    ${priceTable}
    ${skiveFootnote}
    ${priceBreaksHtml}
    <p style="color:#666;margin-top:12px">
      This is a preliminary price based on the information we have so far. We'll firm it up once we confirm any missing details or adjustments, and we can easily re-run the numbers if the quantity or material changes (including any skiving or non-standard thickness up-charges).
    </p>
    <p>— Alex-IO Estimator</p>
  </div>
  `.trim();
}
