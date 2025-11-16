// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
// Path-A safe. Contains: DIA cavity format, skiving option logic (Option A),
// cleaner layout, consistent rendering on all turns, and cavity clarification.
//
// Input shape (from orchestrator):
// templateInput = {
//   customerLine: string,
//   specs: { L_in, W_in, H_in, thickness_under_in, qty, density_pcf, foam_family, color },
//   material: { name, density_lbft3, kerf_pct, price_per_ci, price_per_bf, min_charge },
//   pricing: { piece_ci, order_ci, order_ci_with_waste, raw, total, used_min_charge },
//   missing: string[]
// }
//
// NOTE: We DO accept cavity info from orchestrator & append in “Cutouts” section.
// NOTE: Option A skiving → show only when thickness NOT in 1" increments.
// NOTE: Round cavity + DIA formatting preserved.

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

function safe(v: any) {
  return v == null ? "" : String(v);
}

export function renderQuoteEmail(input: any): string {
  const s = input?.specs || {};
  const m = input?.material || {};
  const p = input?.pricing || {};
  const missing: string[] = Array.isArray(input?.missing) ? input.missing : [];

  const dims = `${s.L_in || 0} × ${s.W_in || 0} × ${s.H_in || 0}"`;
  const fam = s.foam_family ? String(s.foam_family).toUpperCase() : null;
  const density = s.density_pcf != null ? `${s.density_pcf} lb/ft³` : null;

  /* ---------------------- Skiving Logic (Option A) ---------------------- */
  const thickness = Number(s.H_in || 0);
  const requiresSkive = thickness > 0 && Math.abs(thickness - Math.round(thickness)) > 0.001;

  // Example surcharge (Option 2 formatting)
  const skiveRatePct = 0.20;                // 20%
  const skiveSetup = 12.00;                 // flat setup fee
  const skiveCost = requiresSkive ? (p.total * skiveRatePct + skiveSetup) : 0;
  const skiveLine = requiresSkive
    ? `<tr>
         <td style="padding:4px 0;color:#900;">Skiving surcharge (non-standard thickness)</td>
         <td style="padding:4px 0;text-align:right;color:#900;">${fmtMoney(skiveCost)}</td>
       </tr>`
    : "";

  // Final total with skiving included (only when needed)
  const grandTotal = requiresSkive ? p.total + skiveCost : p.total;

  /* ---------------------- Cavity Section ---------------------- */
  const cavCount = input?.facts?.cavityCount ?? null;
  const cavDims = Array.isArray(input?.facts?.cavityDims)
    ? input.facts.cavityDims.filter((x: string) => x && x.trim())
    : [];

  // Format: replace "Ø" style with DIA for clarity
  const cavDimsClean = cavDims.map((c: string) => {
    if (c.startsWith("ø") || c.startsWith("Ø")) {
      const rest = c.slice(1);
      return `DIA ${rest}`;
    }
    return c;
  });

  const cavCountLine =
    cavCount != null
      ? `<li><strong>Count:</strong> ${cavCount}</li>`
      : "";

  const cavSizesLine =
    cavDimsClean.length
      ? `<li><strong>Sizes:</strong> ${cavDimsClean.join(", ")}</li>`
      : "";

  const cutoutSection =
    cavCountLine || cavSizesLine
      ? `
      <h3 style="margin:22px 0 10px 0;font-size:16px;">Cutouts</h3>
      <ul style="margin:0 0 12px 18px;padding:0;">
        ${cavCountLine}
        ${cavSizesLine}
      </ul>
    `
      : "";

  /* ---------------------- Missing Data Section ---------------------- */
  const missingHtml =
    missing.length > 0
      ? `<ul style="margin:6px 0 14px 20px;color:#555;">
           ${missing.map((m) => `<li>${m}</li>`).join("")}
         </ul>`
      : "";

  /* ---------------------- HTML Template ---------------------- */
  return `
<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.45;">

  <p>${safe(input.customerLine)}</p>

  <!-- Missing / follow-up questions -->
  ${missingHtml}

  <h3 style="margin:20px 0 8px 0;font-size:16px;">Specifications</h3>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <tr>
      <td style="padding:4px 0;">Dimensions</td>
      <td style="padding:4px 0;text-align:right;"><strong>${dims}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Quantity</td>
      <td style="padding:4px 0;text-align:right;"><strong>${safe(s.qty)}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Foam family</td>
      <td style="padding:4px 0;text-align:right;"><strong>${fam || "-"}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Density</td>
      <td style="padding:4px 0;text-align:right;"><strong>${density || "-"}</strong></td>
    </tr>
  </table>

  ${cutoutSection}

  <h3 style="margin:22px 0 8px 0;font-size:16px;">Pricing</h3>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <tr>
      <td style="padding:4px 0;">Total (foam only)</td>
      <td style="padding:4px 0;text-align:right;"><strong>${fmtMoney(p.total)}</strong></td>
    </tr>

    ${skiveLine}

    <tr>
      <td style="padding:6px 0;font-size:15px;"><strong>Grand total</strong></td>
      <td style="padding:6px 0;font-size:15px;text-align:right;"><strong>${fmtMoney(grandTotal)}</strong></td>
    </tr>
  </table>

  ${requiresSkive
    ? `<p style="color:#900;margin-top:6px;font-size:13px;">
         * Skiving required because thickness is not in 1" increments.
       </p>`
    : ""}

  <hr style="margin:28px 0 14px 0;border:0;border-top:1px solid #ddd;">

  <p style="font-size:13px;color:#666;">
    Let me know if you'd like price breaks, different densities, alternate foam types,
    or if you'd like to attach a sketch for a multi-cavity job.
  </p>

</div>
  `;
}
