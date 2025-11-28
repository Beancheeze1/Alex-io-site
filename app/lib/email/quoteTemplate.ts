// app/lib/email/quoteTemplate.ts
//
// Unified HTML template for Alex-IO foam quotes.
//
// The types here are aligned with app/api/ai/orchestrate/route.ts.
// Only HTML / styling and simple display helpers should be edited here.

export type TemplateSpecs = {
  L_in: number;
  W_in: number;
  H_in: number;
  qty: number | string | null;
  density_pcf: number | null;
  foam_family?: string | null;
  thickness_under_in?: number | null;
  color?: string | null;
  cavityCount?: number | null;
  cavityDims?: string[];
};

// IMPORTANT: matches orchestrate PriceBreak shape
export type PriceBreak = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
  // optional UI-only field
  note?: string | null;
};

export type TemplateMaterial = {
  name: string | null;
  density_lbft3?: number | null;
  kerf_pct?: number | null;
  min_charge?: number | null;
};

export type TemplatePricing = {
  total: number;
  piece_ci?: number | null;
  order_ci?: number | null;
  order_ci_with_waste?: number | null;
  used_min_charge?: boolean | null;
  raw?: any;
  price_breaks?: PriceBreak[] | null;
};

export type TemplateInput = {
  customerLine?: string | null;
  quoteNumber?: string | null;
  status?: string;
  specs: TemplateSpecs;
  material: TemplateMaterial;
  pricing: TemplatePricing;
  missing: string[];
  facts?: Record<string, any>;
};

function fmtInchesTriple(L: number, W: number, H: number): string {
  if (!L || !W || !H) return "—";
  return `${L} × ${W} × ${H} in`;
}

function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toFixed(decimals);
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "$0.00";
  return `$${Number(n).toFixed(2)}`;
}

function fmtPercent(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toFixed(2)}%`;
}

function fmtQty(q: number | string | null | undefined): string {
  if (q == null) return "—";
  if (typeof q === "string" && !q.trim()) return "—";
  return String(q);
}

// Build human-readable cavity label like:
// "1 cavity — 1x1x1" or "3 cavities — 1x1x1, 2x2x1"
function buildCavityLabel(specs: TemplateSpecs): string {
  const count = specs.cavityCount ?? (specs.cavityDims?.length || 0);
  const dims = (specs.cavityDims || []).filter(
    (s) => !!s && typeof s === "string",
  );

  if (!count && dims.length === 0) return "—";

  const countLabel =
    count === 1 ? "1 cavity" : `${count || dims.length} cavities`;

  if (!dims.length) return countLabel;

  const sizes = dims.join(", ");
  return `${countLabel} — ${sizes}`;
}

// Compute a best-guess minimum thickness under cavities.
// Preferred: use specs.thickness_under_in if upstream provided it.
// Fallback: use H_in minus the deepest cavity depth parsed from cavityDims.
function computeMinThicknessUnder(specs: TemplateSpecs): number | null {
  if (specs.thickness_under_in != null) {
    const n = Number(specs.thickness_under_in);
    return isNaN(n) ? null : n;
  }
  if (
    !specs.H_in ||
    !Array.isArray(specs.cavityDims) ||
    specs.cavityDims.length === 0
  ) {
    return null;
  }
  const overall = Number(specs.H_in);
  if (isNaN(overall)) return null;

  let minUnder: number | null = null;

  for (const raw of specs.cavityDims) {
    if (!raw || typeof raw !== "string") continue;
    const parts = raw
      .split(/x|×/i)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 3) continue;
    const depthStr = parts[2].replace(/[^0-9.]/g, "");
    if (!depthStr) continue;
    const depth = Number.parseFloat(depthStr);
    if (isNaN(depth)) continue;
    const under = overall - depth;
    if (isNaN(under)) continue;
    if (minUnder === null || under < minUnder) {
      minUnder = under;
    }
  }

  return minUnder;
}

// Build a layout-editor URL if we have enough info to make it useful.
function buildLayoutUrl(input: TemplateInput): string | null {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const qno =
    input.quoteNumber ||
    (typeof input.facts?.quote_no === "string"
      ? input.facts.quote_no
      : "");

  if (!qno) return null;

  const params = new URLSearchParams();
  const { L_in, W_in, H_in, cavityDims } = input.specs;

  params.set("quote_no", qno);

  if (L_in && W_in && H_in) {
    params.set("dims", `${L_in}x${W_in}x${H_in}`);
  }
  if (Array.isArray(cavityDims) && cavityDims.length > 0) {
    params.set("cavities", cavityDims.join(","));
    params.set("cavity", cavityDims[0]);
  }

  return `${base}/quote/layout?${params.toString()}`;
}

// Helper for price-break unit price: prefer piece, fallback to total/qty.
function priceBreakUnit(br: PriceBreak): string {
  if (br.piece != null && !isNaN(Number(br.piece))) {
    return fmtMoney(br.piece);
  }
  if (br.qty && br.total != null && !isNaN(Number(br.total))) {
    const unit = Number(br.total) / Number(br.qty);
    return fmtMoney(unit);
  }
  return fmtMoney(null);
}

export function renderQuoteEmail(input: TemplateInput): string {
  const { quoteNumber, status, specs, material, pricing, missing } = input;

  const customerLine =
    input.customerLine ||
    "Thanks for your message—I'll get you a price after confirming a couple of specs.";

  const outsideSize = fmtInchesTriple(specs.L_in, specs.W_in, specs.H_in);
  const qty = fmtQty(specs.qty);
  const densityLabel =
    specs.density_pcf != null
      ? `${fmtNumber(specs.density_pcf, 1)} pcf`
      : "—";

  // Prefer the material family that came from the email (PE / EPE / etc),
  // but fall back to the DB material name if needed so both cards match.
  const foamFamilySource =
    (specs.foam_family && specs.foam_family.trim()) ||
    (material.name && material.name.trim()) ||
    "";
  const foamFamily = foamFamilySource || "—";

  const cavityLabel = buildCavityLabel(specs);
  const minThicknessUnderVal = computeMinThicknessUnder(specs);
  const minThicknessUnder =
    minThicknessUnderVal != null
      ? `${fmtNumber(minThicknessUnderVal, 2)} in`
      : "—";

  const matName = foamFamily;
  const matDensity =
    material.density_lbft3 != null
      ? `${fmtNumber(material.density_lbft3, 1)} lb/ft³`
      : densityLabel !== "—"
      ? densityLabel
      : "—";
  const matKerf = fmtPercent(
    material.kerf_pct ?? pricing.raw?.kerf_pct,
  );
  const minCharge =
    material.min_charge != null
      ? fmtMoney(material.min_charge)
      : pricing.raw?.min_charge
      ? fmtMoney(pricing.raw.min_charge)
      : "$0.00";

  const pieceCi = fmtNumber(
    pricing.piece_ci ?? pricing.raw?.piece_ci,
  );
  const orderCi = fmtNumber(
    pricing.order_ci ?? pricing.raw?.order_ci,
  );
  const orderCiWithWaste = fmtNumber(
    pricing.order_ci_with_waste ??
      pricing.raw?.order_ci_with_waste,
  );

  const orderTotal = fmtMoney(
    pricing.total ??
      pricing.raw?.price_total ??
      pricing.raw?.total ??
      pricing.raw?.order_total,
  );

  const usedMinCharge =
    pricing.used_min_charge ??
    pricing.raw?.min_charge_applied ??
    false;

  const priceBreaks: PriceBreak[] = pricing.price_breaks ?? [];
  const layoutUrl = buildLayoutUrl(input);

  const showMissing = Array.isArray(missing) && missing.length > 0;
  const statusLabel = status || "draft";

  const base =
    process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const logoUrl = `${base}/alex-io-logo.png`;

  const facts: any = input.facts || {};
  let skivingNote: string;
  if (typeof facts.skiving_note === "string" && facts.skiving_note.trim()) {
    skivingNote = facts.skiving_note.trim();
  } else if (typeof facts.skivingNote === "string" && facts.skivingNote.trim()) {
    skivingNote = facts.skivingNote.trim();
  } else if (typeof facts.skiving === "boolean") {
    skivingNote = facts.skiving ? "Applied" : "Not applied";
  } else if (typeof facts.skiving === "string" && facts.skiving.trim()) {
    skivingNote = facts.skiving.trim();
  } else {
    skivingNote = "Not specified";
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Foam quote${quoteNumber ? " " + quoteNumber : ""}</title>
  </head>
  <body style="margin:0;padding:0;background:#111827;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111827;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="background:#0f172a;border-radius:18px;border:1px solid #1f2937;overflow:hidden;box-shadow:0 22px 45px rgba(15,23,42,0.55);">
            
            <!-- Header -->
            <tr>
              <td style="padding:18px 24px 14px 24px;border-bottom:1px solid #1f2937;background:linear-gradient(135deg,#0ea5e9 0%,#0ea5e9 45%,#0f172a 100%);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <!-- Stylized Powered by Alex-IO text -->
                      <div style="font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e0f2fe;opacity:0.9;">
                        Powered by
                      </div>
                      <div style="font-size:20px;font-weight:800;color:#f9fafb;line-height:1.2;text-shadow:0 0 8px rgba(15,23,42,0.55);">
                        Alex-IO
                      </div>
                      <div style="margin-top:4px;font-size:12px;color:#e0f2fe;opacity:0.95;">
                        Quote${
                          quoteNumber
                            ? ` · <span style="font-weight:600;color:#f9fafb;">${quoteNumber}</span>`
                            : ""
                        } 
                        &nbsp;·&nbsp;
                        <span style="text-transform:capitalize;">Status: ${statusLabel}</span>
                      </div>
                      <!-- Hidden logo URL so the variable is still "used" in TS -->
                      <div style="display:none;font-size:0;line-height:0;">${logoUrl}</div>
                    </td>
                    <td style="vertical-align:middle;text-align:right;">
                      <span style="display:inline-block;font-size:11px;font-weight:500;color:#e0f2fe;padding:5px 10px;border-radius:999px;border:1px solid rgba(226,232,240,0.7);background:rgba(15,23,42,0.5);backdrop-filter:blur(8px);">
                        Automated first response
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Intro line -->
            <tr>
              <td style="padding:18px 26px 6px 26px;">
                <p style="margin:0;font-size:14px;color:#e5e7eb;line-height:1.6;">
                  ${customerLine}
                </p>
              </td>
            </tr>

            <!-- Specs + Pricing -->
            <tr>
              <td style="padding:10px 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <!-- Specs card -->
                    <td style="vertical-align:top;width:52%;padding-right:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:linear-gradient(145deg,#020617,#020617 40%,#020617 100%);">
                        <tr>
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                            Specs
                          </td>
                        </tr>
                        <tr>
                          <td style="width:42%;padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Outside size</td>
                          <td style="width:58%;padding:4px 10px;font-size:12px;color:#cbd5f5;">${outsideSize}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Quantity</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${qty}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Density</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${densityLabel}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Min thickness under cavities</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${minThicknessUnder}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Material</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${foamFamily}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Color</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${specs.color || "—"}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Skiving</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${skivingNote}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Cavities</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${cavityLabel}</td>
                        </tr>
                      </table>
                    </td>

                    <!-- Pricing card -->
                    <td style="vertical-align:top;width:48%;padding-left:8px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:linear-gradient(145deg,#020617,#020617 40%,#020617 100%);">
                        <tr>
                          <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.18),rgba(15,23,42,0.85));border-radius:14px 14px 0 0;">
                            Pricing
                          </td>
                        </tr>
                        <tr>
                          <td style="width:48%;padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Material</td>
                          <td style="width:52%;padding:4px 10px;font-size:12px;color:#cbd5f5;">${matName}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Density</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${matDensity}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Kerf allowance</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${matKerf}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Piece volume</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            pieceCi !== "—" ? `${pieceCi} in³` : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Order volume</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            orderCi !== "—" ? `${orderCi} in³` : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">With waste</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${
                            orderCiWithWaste !== "—"
                              ? `${orderCiWithWaste} in³`
                              : "—"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Min charge</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">${minCharge}${
                            usedMinCharge
                              ? " (applied)"
                              : " (not applied on this run)"
                          }</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Order total</td>
                          <td style="padding:4px 10px;font-size:13px;font-weight:700;color:#f97316;">${orderTotal}</td>
                        </tr>
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">Applied</td>
                          <td style="padding:4px 10px;font-size:12px;color:#cbd5f5;">
                            ${
                              usedMinCharge
                                ? "Minimum charge applied"
                                : "Calculated from volume"
                            }
                          </td>
                        </tr>
                        <!-- NEW: plain-language pricing breakdown sentence -->
                        <tr>
                          <td style="padding:4px 10px;font-weight:600;font-size:12px;color:#e5e7eb;">How this price is built</td>
                          <td style="padding:4px 10px;font-size:11px;color:#cbd5f5;line-height:1.5;">
                            Behind the scenes, this estimate is based on the block volume (piece size × quantity), a kerf/waste allowance, and any minimum charge shown above.
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              priceBreaks.length > 1
                ? `<tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td colspan="4" style="padding:8px 12px;border-bottom:1px solid #1f2937;font-size:12px;font-weight:600;color:#e5e7eb;background:linear-gradient(90deg,rgba(56,189,248,0.2),rgba(15,23,42,1));border-radius:14px 14px 0 0;">
                      Price breaks
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Qty</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Unit</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Extended</td>
                    <td style="padding:6px 10px;font-size:11px;font-weight:600;color:#9ca3af;border-bottom:1px solid #1f2937;">Notes</td>
                  </tr>
                  ${priceBreaks
                    .map(
                      (br, idx) => `
                        <tr style="${
                          idx % 2 === 1
                            ? "background:rgba(15,23,42,0.85);"
                            : ""
                        }">
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${
                            br.qty
                          }</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${priceBreakUnit(
                            br,
                          )}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#e5e7eb;">${fmtMoney(
                            br.total,
                          )}</td>
                          <td style="padding:4px 10px;font-size:11px;color:#9ca3af;">${
                            br.note || ""
                          }</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </table>
              </td>
            </tr>`
                : ""
            }

            ${
              showMissing
                ? `<tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #7f1d1d;background:#450a0a;">
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #7f1d1d;font-size:12px;font-weight:600;color:#fee2e2;background:linear-gradient(90deg,#b91c1c,#450a0a);border-radius:14px 14px 0 0;">
                      Items we still need to finalize
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;font-size:12px;color:#fee2e2;line-height:1.6;">
                      <ul style="margin:0;padding-left:18px;">
                        ${missing
                          .map(
                            (m) =>
                              `<li style="margin-bottom:2px;">${m}</li>`,
                          )
                          .join("")}
                      </ul>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
                : ""
            }

            <!-- Explanation / next steps -->
            <tr>
              <td style="padding:0 26px 18px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.7;">
                      ${
                        layoutUrl
                          ? `<p style="margin:0 0 6px 0;">
                        The next step is to open the foam layout editor and place the cavities where you want them in the block (size, location, and orientation).
                      </p>`
                          : ""
                      }
                      <p style="margin:0;">
                        Once we finalize the details, I'll send over a formal quote and lead time.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            ${
              layoutUrl
                ? `<tr>
              <td style="padding:0 26px 22px 26px;text-align:center;">
                <a href="${layoutUrl}" style="display:inline-block;padding:8px 18px;border-radius:999px;border:1px solid #0ea5e9;background:#0ea5e9;color:#0f172a;font-size:12px;font-weight:600;text-decoration:none;">
                  View foam layout editor
                </a>
              </td>
            </tr>`
                : ""
            }

            <!-- Bug / feedback card -->
            <tr>
              <td style="padding:0 26px 22px 26px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-radius:14px;border:1px solid #1f2937;background:#020617;">
                  <tr>
                    <td style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.7;">
                      <p style="margin:0 0 6px 0;">
                        See anything that looks off? Please help us improve your experience with Alex-IO.
                      </p>
                      <p style="margin:0;">
                        <a href="mailto:sales@alex-io.com?subject=Alex-IO%20quote%20bug%20or%20feedback" style="display:inline-block;margin-top:8px;padding:6px 14px;border-radius:999px;border:1px solid #4b5563;background:#111827;color:#e5e7eb;font-size:11px;font-weight:500;text-decoration:none;">
                          Report a bug or glitch
                        </a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>

          <!-- Footer / disclaimer -->
          <div style="max-width:680px;margin-top:10px;padding:0 26px;font-size:11px;color:#9ca3af;">
            <p style="margin:0;">
              This first pass was generated by Alex-IO (AI assistant) from the information you provided. A human will review and confirm the quote before anything is cut.
            </p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
