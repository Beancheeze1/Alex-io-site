// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
// Path-A safe and compatible with the current orchestrator.
//
// Input shape (from orchestrator):
//   {
//     customerLine: string,
//     specs: {
//       L_in: number,
//       W_in: number,
//       H_in: number,
//       qty: number,
//       density_pcf: number | null,
//       foam_family: string | null
//     },
//     material: {
//       name: string | null,
//       density_lbft3: number | null,
//       kerf_pct: number | null,
//       min_charge: number | null
//     },
//     pricing: {
//       piece_ci: number | null,
//       order_ci: number | null,
//       order_ci_with_waste: number | null,
//       total: number | null,
//       raw?: number | null,
//       used_min_charge?: boolean | null
//     },
//     missing: string[],
//     facts: {
//       cavityCount?: number | null,
//       cavityDims?: string[] | null,
//       // plus the rest of the memory bag
//     }
//   }

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

function fmtNumber(
  n: number | null | undefined,
  decimals: number = 0
): string {
  if (n == null || isNaN(Number(n))) return "-";
  return Number(n).toFixed(decimals);
}

function safe(v: any): string {
  return v == null ? "" : String(v);
}

function prettyFoamFamilyLabel(
  famCode: string | null,
  fallbackName: string | null
): string | null {
  const code = (famCode || "").toUpperCase().trim();

  if (code === "PE") return "Polyethylene";
  if (code === "EPE") return "Expanded polyethylene";
  if (code === "PU") return "Polyurethane";
  if (code === "EVA") return "EVA foam";
  if (code === "HONEYCOMB") return "Honeycomb";

  // If we don’t recognize the code, fall back to DB name if we have one
  if (fallbackName && fallbackName.trim()) return fallbackName.trim();

  // Otherwise, fall back to the raw code (or null)
  return code || null;
}

function buildMaterialLine(
  famCode: string | null,
  density_pcf: number | null | undefined,
  fallbackName: string | null
): string {
  const label = prettyFoamFamilyLabel(famCode, fallbackName);
  const dens = density_pcf != null && !isNaN(Number(density_pcf))
    ? `${Number(density_pcf).toFixed(1)} lb/ft³`
    : null;

  if (label && dens) return `${label} – ${dens}`;
  if (label) return label;
  if (dens) return dens;
  return "-";
}

export function renderQuoteEmail(input: any): string {
  const s = input?.specs || {};
  const m = input?.material || {};
  const p = input?.pricing || {};
  const missing: string[] = Array.isArray(input?.missing) ? input.missing : [];

  // Dimensions
  const dimsText = `${s.L_in || 0} × ${s.W_in || 0} × ${s.H_in || 0}"`;

  // Family / density
  const foamFamilyCode = s.foam_family ? String(s.foam_family) : null;
  const densityPcf: number | null =
    typeof s.density_pcf === "number"
      ? s.density_pcf
      : typeof m.density_lbft3 === "number"
      ? m.density_lbft3
      : null;

  const materialLine = buildMaterialLine(
    foamFamilyCode,
    densityPcf,
    m.name ?? null
  );

  // Kerf / waste
  const kerfPct = typeof m.kerf_pct === "number" ? m.kerf_pct : null;

  // Pricing bits from calc_foam_quote()
  const pieceCi = typeof p.piece_ci === "number" ? p.piece_ci : null;
  const orderCi = typeof p.order_ci === "number" ? p.order_ci : null;
  const orderCiWaste =
    typeof p.order_ci_with_waste === "number" ? p.order_ci_with_waste : null;

  const foamTotal = typeof p.total === "number" ? p.total : 0;

  // Derive price per CI if volumes are available
  let pricePerCi: number | null = null;
  if (foamTotal > 0 && orderCiWaste && orderCiWaste > 0) {
    pricePerCi = foamTotal / orderCiWaste;
  } else if (foamTotal > 0 && orderCi && orderCi > 0) {
    pricePerCi = foamTotal / orderCi;
  }

  // ================== Skiving Logic (Option B) ==================
  // Non-integer thickness → skiving surcharge
  const thickness = Number(s.H_in || 0);
  const requiresSkive =
    thickness > 0 && Math.abs(thickness - Math.round(thickness)) > 0.001;

  // 20% of foam total + $12 setup (Option B)
  const skiveRatePct = 0.20; // 20%
  const skiveSetup = 12.0;   // flat setup fee
  const skiveCost = requiresSkive ? foamTotal * skiveRatePct + skiveSetup : 0;

  // Grand total includes skiving when applicable
  const grandTotal = foamTotal + skiveCost;

  const skiveRow = requiresSkive
    ? `
      <tr>
        <td style="padding:4px 0;color:#900;">Skiving surcharge (non-standard thickness)</td>
        <td style="padding:4px 0;text-align:right;color:#900;">${fmtMoney(skiveCost)}</td>
      </tr>
    `
    : "";

  const skiveNote = requiresSkive
    ? `
      <p style="color:#900;margin-top:6px;font-size:13px;">
        * Skiving required because thickness is not in 1" increments. Surcharge includes
        an estimated setup and additional handling for skived sheet.
      </p>
    `
    : "";

  // ================== Cavity / Cutout Section ==================
  const cavCount: number | null =
    input?.facts?.cavityCount != null ? Number(input.facts.cavityCount) : null;

  const rawCavDims: string[] = Array.isArray(input?.facts?.cavityDims)
    ? input.facts.cavityDims
    : [];

  // Clean up cavity strings and normalize any lingering Ø/ø to DIA
  const cavDimsClean = rawCavDims
    .filter((x) => x && String(x).trim())
    .map((c: string) => {
      const trimmed = c.trim();
      if (trimmed.startsWith("ø") || trimmed.startsWith("Ø")) {
        return `DIA ${trimmed.slice(1)}`;
      }
      // If orchestrator normalized to "DIA 6x1" already, keep as-is.
      return trimmed;
    });

  const cavCountLine =
    cavCount != null
      ? `<li><strong>Count:</strong> ${cavCount}</li>`
      : "";

  const cavSizesLine =
    cavDimsClean.length > 0
      ? `<li><strong>Sizes:</strong> ${cavDimsClean.join(", ")}</li>`
      : "";

  const cutoutsSection =
    cavCountLine || cavSizesLine
      ? `
  <h3 style="margin:22px 0 10px 0;font-size:16px;">Cutouts</h3>
  <ul style="margin:0 0 12px 18px;padding:0;">
    ${cavCountLine}
    ${cavSizesLine}
  </ul>
  `
      : "";

  // ================== Missing Data Section ==================
  const missingHtml =
    missing && missing.length
      ? `
  <p style="margin:10px 0 4px 0;">To firm this up, I still need:</p>
  <ul style="margin:4px 0 14px 20px;color:#555;">
    ${missing.map((mItem) => `<li>${safe(mItem)}</li>`).join("")}
  </ul>
  `
      : `
  <p style="margin:10px 0 14px 0;">
    It looks like I have enough information to run numbers. Here’s a working estimate:
  </p>
  `;

  // ================== Full HTML ==================
  return `
<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.45;">

  <!-- Opener -->
  <p>${safe(input?.customerLine)}</p>

  <!-- Missing / follow-up questions -->
  ${missingHtml}

  <!-- Specs -->
  <h3 style="margin:20px 0 8px 0;font-size:16px;">Specifications</h3>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <tr>
      <td style="padding:4px 0;">Dimensions</td>
      <td style="padding:4px 0;text-align:right;"><strong>${dimsText}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Quantity</td>
      <td style="padding:4px 0;text-align:right;"><strong>${safe(s.qty)}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Material</td>
      <td style="padding:4px 0;text-align:right;"><strong>${materialLine}</strong></td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Kerf / waste</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${kerfPct != null ? fmtNumber(kerfPct, 1) + "%" : "-"}</strong>
      </td>
    </tr>
  </table>

  ${cutoutsSection}

  <!-- Pricing breakdown -->
  <h3 style="margin:22px 0 8px 0;font-size:16px;">Pricing breakdown</h3>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <tr>
      <td style="padding:4px 0;">Piece volume</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${fmtNumber(pieceCi, 0)} in³</strong>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Order volume</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${fmtNumber(orderCi, 0)} in³</strong>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Order volume w/ waste</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${fmtNumber(orderCiWaste, 0)} in³</strong>
      </td>
    </tr>
    <tr>
      <td style="padding:4px 0;">Price per cubic inch</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${pricePerCi != null ? fmtMoney(pricePerCi) : "-"}</strong>
      </td>
    </tr>
  </table>

  <h3 style="margin:18px 0 8px 0;font-size:16px;">Totals</h3>
  <table style="border-collapse:collapse;width:100%;max-width:520px;">
    <tr>
      <td style="padding:4px 0;">Foam total</td>
      <td style="padding:4px 0;text-align:right;">
        <strong>${fmtMoney(foamTotal)}</strong>
      </td>
    </tr>

    ${skiveRow}

    <tr>
      <td style="padding:6px 0;font-size:15px;"><strong>Grand total</strong></td>
      <td style="padding:6px 0;font-size:15px;text-align:right;">
        <strong>${fmtMoney(grandTotal)}</strong>
      </td>
    </tr>
  </table>

  ${skiveNote}

  ${
    p.used_min_charge
      ? `
  <p style="margin-top:6px;font-size:13px;color:#555;">
    Minimum order charge was applied on this configuration. If you’d like, I can show
    alternate quantities or layouts to make better use of that minimum.
  </p>
  `
      : ""
  }

  <hr style="margin:24px 0 14px 0;border:0;border-top:1px solid #ddd;">

  <p style="font-size:13px;color:#666;margin:0 0 6px 0;">
    If you’d like, I can also send:
  </p>
  <ul style="margin:0 0 14px 18px;font-size:13px;color:#666;">
    <li>Alternate densities or foam types (PE, EPE, PU, etc.)</li>
    <li>Price breaks for different quantities</li>
    <li>Options for multi-cavity layouts or matching lid foam</li>
  </ul>

  <p style="font-size:12px;color:#888;margin:0 0 4px 0;">
    Example of a clear quote request I can parse well:
  </p>
  <pre style="font-size:12px;color:#666;background:#f7f7f7;padding:8px 10px;border-radius:4px;white-space:pre-wrap;margin:0;">
Outside size: 10 x 10 x 2"
Quantity: 75 pieces
Foam family: EPE
Density: 1.7 lb
Cutouts:
- Count: 1
- Sizes: DIA 1 x 0.5
  </pre>

</div>
  `;
}
