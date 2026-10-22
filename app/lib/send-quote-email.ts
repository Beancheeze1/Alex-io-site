// app/lib/send-quote-email.ts
//
// Step 37J: the customer quote email, moved out of /api/admin/send-quote so
// two callers share it:
//   - Admin "Send to customer" (/api/admin/send-quote), as before.
//   - A buyer's new boxes-only quote (/api/quote/boxes-only and /multi):
//     sent automatically when the quote is created, the same way a foam
//     quote is emailed by /api/ai/orchestrate.
// Same content, sender, links (the buyer's private edit link) and email log
// as before. Never sends anything when the quote has no email address.
//
// Data is loaded DIRECTLY from the DB (not via HTTP to /api/quote/print)
// so there are no auth/cookie forwarding issues and packaging + printing
// totals are always correct.
//
// Step 29A: sent with the shop's name as the sender name, replies to the
// shop (Settings reply-to, else the quote's sales rep, else the shop page
// email), links on the shop's own address, the shop's name in the subject,
// and logged in the quote's email list.

import { loadShippingSettings } from "@/lib/shipping-settings";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { computePrintCharges } from "@/app/lib/pricing/print-charges";
import { renderQuoteEmail, type TemplateLineItem, type TemplateLayoutLayer } from "@/app/lib/email/quoteTemplate";
import { computePricing } from "@/app/lib/pricing/compute";
import { lockedChargeSettings, lockedFoamPrice, quotePriceModel } from "@/app/lib/pricing/foam-lock";
import { foamChargeLines, latestLayoutJson, quoteFoamGeometry } from "@/app/lib/pricing/foam-quote";
import type { FoamGeometry } from "@/app/lib/pricing/foam-geometry";
import { loadApprovalRow, quoteTerms } from "@/app/lib/quote-approval";
import { computeApproval } from "@/app/lib/quote-approval-core";
import { logQuoteEmail, shopSender } from "@/app/lib/quote-mail";
import { displayRevisionLabel } from "@/app/lib/revision-label";
import { freightForQuote } from "@/app/lib/freight";
import { boxStyleLabel } from "@/lib/box-styles";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  locked?: boolean; // Step 36E
};

type ItemRow = {
  id: number;
  quote_id: number;
  length_in: string;
  width_in: string;
  height_in: string;
  qty: number;
  material_id: number;
  material_name: string | null;
  material_family: string | null;
  density_lb_ft3: number | null;
  notes: string | null;
  // Step 10B: saved price lock
  stored_unit_usd?: string | number | null;
  stored_total_usd?: string | number | null;
  calc_snapshot?: unknown;
};

type PkgRow = {
  id: number;
  sku: string;
  qty: number;
  unit_price_usd: number | null;
  extended_price_usd: number | null;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: number | null;
  inside_width_in: number | null;
  inside_height_in: number | null;
};

type LayoutRow = {
  id: number;
  layout_json: any;
  notes: string | null;
};

function isLayoutLayerRow(notes: string | null): boolean {
  return String(notes || "").toUpperCase().includes("[LAYOUT-LAYER]");
}

function isPackagingRow(notes: string | null): boolean {
  return String(notes || "").includes("Requested shipping carton") ||
    String(notes || "").includes("[PACKAGING]");
}

function isNonWholeInch(v: any): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && Math.abs(n - Math.round(n)) > 0.01;
}

export type SendQuoteEmailResult =
  | { ok: true; quoteNo: string; to: string; subject: string; revision: string | null }
  | { ok: false; error: string; status: number; detail?: string };

export async function sendQuoteEmail(opts: {
  quoteNo: string;
  tenantId: number;
  to?: string;
  subject?: string;
  /** Who sent it, for the quote's email list ("Pat Smith", "automatic (new quote)"). */
  by: string;
  /** Mark the quote "sent" (draft / applied / revised only). Default true. */
  markSent?: boolean;
}): Promise<SendQuoteEmailResult> {
  const quoteNo = String(opts.quoteNo || "").trim();
  const tenantId = Number(opts.tenantId);
  if (!quoteNo) return { ok: false, error: "missing_quoteNo", status: 400 };
  if (!Number.isFinite(tenantId) || tenantId <= 0) return { ok: false, error: "missing_tenant", status: 400 };

  try {
    // 1) Load quote header directly from DB
    let quote: QuoteRow | null;
    try {
      quote = await one<QuoteRow>(
        `SELECT id, quote_no, customer_name, email, phone, status, created_at,
                COALESCE((to_jsonb(quotes) ->> 'locked')::boolean, false) AS locked
         FROM quotes
         WHERE quote_no = $1 AND tenant_id = $2
         LIMIT 1`,
        [quoteNo, tenantId],
      );
    } catch (e: any) {
      return { ok: false, error: "db_quote_lookup_failed", detail: String(e?.message || e), status: 500 };
    }
    if (!quote) return { ok: false, error: "quote_not_found", status: 404 };

    const to = (typeof opts.to === "string" && opts.to.trim())
      ? opts.to.trim()
      : (quote.email || "").trim();
    if (!to) return { ok: false, error: "missing_customer_email", status: 400 };

    // 2) Load facts from KV
    let facts: any = {};
    try {
      facts = (await loadFacts(quoteNo)) || {};
    } catch (e: any) {
      // Non-fatal — facts just won't be available
      console.error(`[send-quote] loadFacts failed: ${e?.message || e}`);
    }

    // 3) Load quote items from DB
    let itemsRaw: ItemRow[] = [];
    try {
      itemsRaw = await q<ItemRow>(
        `SELECT qi.id, qi.quote_id,
                qi.length_in, qi.width_in, qi.height_in,
                qi.qty, qi.material_id,
                m.name as material_name,
                m.material_family,
                m.density_lb_ft3,
                qi.notes,
                qi.price_unit_usd AS stored_unit_usd,
                qi.price_total_usd AS stored_total_usd,
                qi.calc_snapshot
         FROM quote_items qi
         LEFT JOIN materials m ON m.id = qi.material_id
         WHERE qi.quote_id = $1
         ORDER BY qi.id ASC`,
        [quote.id],
      );
    } catch (e: any) {
      return { ok: false, error: "db_items_failed", detail: String(e?.message || e), status: 500 };
    }

    // 4) Price each billable foam item
    type PricedItem = ItemRow & { price_unit_usd: number | null; price_total_usd: number | null };
    const items: PricedItem[] = [];
    const hasLayerRows = itemsRaw.some(it => isLayoutLayerRow(it.notes));
    const layeredSkiveRequired = itemsRaw.some(
      it => isLayoutLayerRow(it.notes) && isNonWholeInch(it.height_in)
    );
    let skiveConsumed = false;
    let primaryCalcRaw: any = {};
    let primaryCalcCaptured = false;

    // Step 23: same as the quote page — price model, and the billable foam
    // set's geometry (cavities, cut length, dies, glue lines) from the layout.
    const priceModel = await quotePriceModel(quoteNo);
    const layoutJsonForPricing = await latestLayoutJson(quote.id);
    let primaryGeom: FoamGeometry | null = null;
    let primaryQty = 0;

    for (const it of itemsRaw) {
      const L = Number(it.length_in);
      const W = Number(it.width_in);
      const H = Number(it.height_in);
      const qty = Number(it.qty);
      const mid = Number(it.material_id);

      if (isLayoutLayerRow(it.notes) || isPackagingRow(it.notes)) {
        items.push({ ...it, price_unit_usd: null, price_total_usd: null });
        continue;
      }

      if (![L, W, H].every(n => Number.isFinite(n) && n > 0) || !(qty > 0) || !(mid > 0)) {
        items.push({ ...it, price_unit_usd: null, price_total_usd: null });
        continue;
      }

      const forceSkive = !skiveConsumed && hasLayerRows && layeredSkiveRequired;
      let cavityCi = 0;
      if (!primaryGeom) {
        primaryGeom = quoteFoamGeometry(layoutJsonForPricing, { L, W, H });
        primaryQty = qty;
        if (priceModel === 2) cavityCi = primaryGeom.cavity_ci;
      }
      let priced: { unit: number; total: number; raw: any };
      try {
        // Step 10B: price lock — same saved price as the quote page.
        const lockedPrice = await lockedFoamPrice(
          {
            id: it.id,
            price_unit_usd: it.stored_unit_usd,
            price_total_usd: it.stored_total_usd,
            calc_snapshot: it.calc_snapshot,
          },
          { L, W, H, qty, material_id: mid, force_skived: forceSkive, cavity_ci: cavityCi },
          async () => {
            const result = await computePricing({
              L, W, H, qty, material_id: mid,
              force_skived: forceSkive,
              cavity_ci: cavityCi,
              tenant_id: tenantId,
            });
            return { unit: result.total / qty, total: result.total, detail: result };
          },
        );
        priced = {
          unit: lockedPrice.unit,
          total: lockedPrice.total,
          raw: lockedPrice.detail ?? {},
        };
      } catch (e: any) {
        console.error(`[send-quote] computePricing failed for item ${it.id}: ${e?.message}`);
        priced = { unit: 0, total: 0, raw: {} };
      }
      if (forceSkive) skiveConsumed = true;
      if (!primaryCalcCaptured) { primaryCalcRaw = priced.raw; primaryCalcCaptured = true; }

      items.push({ ...it, price_unit_usd: priced.unit, price_total_usd: priced.total });
    }

    // 5) Load packaging lines directly from DB
    // LEFT JOIN (not INNER): quote_box_selections is the source of truth for
    // both stock (box_id set, joins to a real boxes row) and custom (box_id
    // null, own custom_* columns) selections — an INNER JOIN here silently
    // dropped every custom-box row, zeroing packaging subtotal (and understating
    // the printing-upcharge %, since that's computed off foam+packaging).
    // Mirrors the same LEFT JOIN + coalesce pattern already correct in
    // /api/quote/print/route.ts.
    let packagingLines: PkgRow[] = [];
    try {
      packagingLines = await q<PkgRow>(
        `SELECT qbs.id, qbs.sku, qbs.qty,
                qbs.unit_price_usd, qbs.extended_price_usd,
                (to_jsonb(qbs) ->> 'plates_usd')::numeric as plates_usd,
                (to_jsonb(qbs) ->> 'tooling_usd')::numeric as tooling_usd,
                (to_jsonb(qbs) -> 'pricing_detail' ->> 'run_method') as run_method,
                b.vendor,
                coalesce(b.style, qbs.custom_style) as style,
                coalesce(qbs.description, b.description) as description,
                coalesce(b.inside_length_in, qbs.custom_length_in) as inside_length_in,
                coalesce(b.inside_width_in, qbs.custom_width_in) as inside_width_in,
                coalesce(b.inside_height_in, qbs.custom_height_in) as inside_height_in
         FROM quote_box_selections qbs
         LEFT JOIN boxes b ON b.id = qbs.box_id
         WHERE qbs.quote_id = $1`,
        [quote.id],
      );
    } catch (e: any) {
      return { ok: false, error: "db_packaging_failed", detail: String(e?.message || e), status: 500 };
    }

    console.log(`[send-quote] quoteNo=${quoteNo} items=${items.length} packagingLines=${packagingLines.length}`);

    // 6) Compute subtotals and printing
    const foamSubtotal = items.reduce((s, i) => {
      if (isLayoutLayerRow(i.notes) || isPackagingRow(i.notes)) return s;
      return s + (Number(i.price_total_usd) || 0);
    }, 0);

    const packagingSubtotal = packagingLines.reduce(
      (s, l) => s + (Number(l.extended_price_usd) || 0), 0
    );

    let settings: any;
    try {
      // Step 10B: the printing / die-cut settings saved with the quote.
      settings = await lockedChargeSettings(quoteNo, await getPricingSettings(tenantId), true);
    } catch (e: any) {
      return { ok: false, error: "settings_failed", detail: String(e?.message || e), status: 500 };
    }
    // Same printing rules as /api/quote/print (app/lib/pricing/print-charges.ts).
    const platesTotal = packagingLines.reduce((s, l) => s + (Number((l as any).plates_usd) || 0), 0);
    const pc = computePrintCharges({
      facts,
      settings,
      foamSubtotal,
      packagingSubtotal,
      platesTotal,
      runMethods: packagingLines.map((l) => (l as { run_method?: string | null }).run_method),
    });
    const { isPrinted, artSetupFee, printingUpchargePct, printingUpchargeAmt, printingUpcharge } = pc;

    // Step 23: cutting / lamination / old flat die-cut fee — the same
    // foamChargeLines() the quote page uses (app/lib/pricing/foam-quote.ts).
    // The old fee keeps this route's old order qty (the primary row).
    const orderQtyForDieCut = Number(
      items.find((it) => !isLayoutLayerRow(it.notes) && !isPackagingRow(it.notes))?.qty,
    ) || 0;
    const proc = foamChargeLines({
      settings,
      geom: primaryGeom,
      qty: primaryQty,
      legacyQty: orderQtyForDieCut,
      facts,
    });
    const dieCutTriggerQty = Number(settings.die_cut_trigger_qty) || 0;
    // Step 27: one-time cutting dies for die-cut boxes (same as /api/quote/print).
    const boxToolingTotal =
      Math.round(packagingLines.reduce((s, l) => s + (Number((l as { tooling_usd?: unknown }).tooling_usd) || 0), 0) * 100) / 100;
    const processLines: { key: string; label: string; amount: number; note: string | null }[] = [
      ...proc.lines,
      ...(boxToolingTotal > 0
        ? [{ key: "box_die", label: "Box cutting die (one time)", amount: boxToolingTotal, note: null }]
        : []),
    ];
    const dieCuttingCharge = proc.total + boxToolingTotal;

    // Step 30: freight, the same as /api/quote/print (in the total when
    // prepaid & add).
    const preFreightTotal = foamSubtotal + packagingSubtotal + printingUpcharge + dieCuttingCharge;
    const fr = await freightForQuote({
      quoteId: quote.id,
      tenantId: tenantId,
      subtotal: preFreightTotal,
      facts,
    }).catch(() => null);
    const freight = fr?.freight ?? null;
    const freightActive = !!freight && freight.status !== "not_set_up";
    const grandTotal = Math.round((preFreightTotal + (freight && freight.in_total ? freight.cost : 0)) * 100) / 100;
    if (freight && freight.in_total && (freight.status === "estimated" || freight.status === "override" || freight.status === "free")) {
      processLines.push({
        key: "freight",
        label: freight.status === "free" ? "Free freight" : "Freight (prepaid & add)",
        amount: freight.cost,
        note: freight.note || null,
      });
    }
    const freightNote = !freight
      ? null
      : freight.status === "pickup"
        ? "Customer pickup (no freight)"
        : freight.terms === "fob_origin"
          ? `Freight: FOB origin / collect (you pay the carrier)${freight.estimate != null ? `, est. $${freight.estimate.toFixed(2)}` : ""}`
          : freight.status === "needs_zip"
            ? "Freight: add your ship-to ZIP on the quote page"
            : null;

    // Step 28: price valid until / lead time, the same as the quote page.
    let validUntil: string | null = null;
    let leadTime: string | null = null;
    try {
      const ap = computeApproval(await loadApprovalRow(quote.id), grandTotal, await quoteTerms(tenantId));
      leadTime = ap.lead_time;
      if (ap.expires_at && ap.stage !== "confirmed") {
        validUntil = new Date(ap.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      }
    } catch (e) {
      console.warn("[send-quote] quote terms unavailable", String(e));
    }

    // Rough shipping estimate: this shop's % + cap (Step 19: per shop), the
    // same setting the live quote page reads.
    const shipSettings = await loadShippingSettings(tenantId || null).catch(() => null);
    const roughShipPct = shipSettings ? shipSettings.rough_ship_pct : 2.0;
    const shippingCapUsd = shipSettings ? shipSettings.shipping_cap_usd : 200.0;
    const rawShippingEstimate =
      !freightActive && Number.isFinite(roughShipPct) && grandTotal > 0
        ? Math.round(grandTotal * (roughShipPct / 100) * 100) / 100
        : 0;
    const shippingIsCapped = Number.isFinite(shippingCapUsd) && rawShippingEstimate > shippingCapUsd;
    const shippingEstimate = shippingIsCapped ? shippingCapUsd : rawShippingEstimate;

    console.log(`[send-quote] foam=${foamSubtotal} pkg=${packagingSubtotal} artSetup=${artSetupFee} upchargeAmt=${printingUpchargeAmt} dieCut=${dieCuttingCharge} ship=${shippingEstimate} grand=${grandTotal}`);

    // 7) Load layout package
    const layoutPkg = await one<LayoutRow>(
      `SELECT id, layout_json, notes
       FROM quote_layout_packages
       WHERE quote_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [quote.id],
    );

    // 8) Build email line items
    const emailLineItems: TemplateLineItem[] = [];
    const primaryItem = items.find(it => !isLayoutLayerRow(it.notes) && !isPackagingRow(it.notes)) ?? null;

    if (primaryItem) {
      emailLineItems.push({
        id: primaryItem.id,
        label: hasLayerRows ? "Foam set — layered construction" : (primaryItem.material_name || `Material #${primaryItem.material_id}`),
        sublabel: hasLayerRows ? "Includes all bonded layers shown below (for reference)." : (primaryItem.material_family || null),
        dims: `${Number(primaryItem.length_in)} × ${Number(primaryItem.width_in)} × ${Number(primaryItem.height_in)} in`,
        qty: Number(primaryItem.qty),
        unitPrice: primaryItem.price_unit_usd,
        lineTotal: primaryItem.price_total_usd,
        isIncluded: false,
        isPackaging: false,
      });
    }

    for (const it of items.filter(i => isLayoutLayerRow(i.notes))) {
      emailLineItems.push({
        id: it.id,
        label: "Included layer",
        sublabel: [it.material_name, it.material_family].filter(Boolean).join(" · ") || null,
        dims: `${Number(it.length_in)} × ${Number(it.width_in)} × ${Number(it.height_in)} in`,
        qty: Number(it.qty),
        unitPrice: null, lineTotal: null,
        isIncluded: true, isPackaging: false,
      });
    }

    for (const pkg of packagingLines) {
      emailLineItems.push({
        id: pkg.id,
        label: [pkg.description, pkg.sku].filter(Boolean).join(" ").trim() || "Carton",
        // Step 37J: "RSC / shipper", not the bare style key
        // Step 39D: die line parts are a flat blank; the assembly line has no size.
        sublabel:
          pkg.style === "assembly"
            ? "Assembly and packing"
            : pkg.style === "dieline"
              ? "Die-cut part"
              : pkg.style
                ? boxStyleLabel(pkg.style)
                : pkg.vendor || null,
        dims:
          pkg.style === "assembly"
            ? "—"
            : pkg.style === "dieline" && Number(pkg.inside_length_in) > 0 && Number(pkg.inside_width_in) > 0
              ? `${Number(pkg.inside_length_in)} × ${Number(pkg.inside_width_in)} in blank`
              : (pkg.inside_length_in && pkg.inside_width_in && pkg.inside_height_in)
                ? `${pkg.inside_length_in} × ${pkg.inside_width_in} × ${pkg.inside_height_in} in` : "—",
        qty: Number(pkg.qty) || 1,
        unitPrice: pkg.unit_price_usd != null ? Number(pkg.unit_price_usd) : null,
        lineTotal: pkg.extended_price_usd != null ? Number(pkg.extended_price_usd) : null,
        isIncluded: false, isPackaging: true,
      });
    }

    // 9) Build layer summary from layout JSON
    const emailLayers: TemplateLayoutLayer[] = [];
    if (layoutPkg?.layout_json) {
      try {
        const lj = typeof layoutPkg.layout_json === "string"
          ? JSON.parse(layoutPkg.layout_json) : layoutPkg.layout_json;
        const layerArr: any[] = Array.isArray(lj?.layers) ? lj.layers : [];
        for (let i = 0; i < layerArr.length; i++) {
          const lyr = layerArr[i];
          emailLayers.push({
            index: i + 1, total: layerArr.length,
            thickness_in: lyr?.thickness_in != null ? Number(lyr.thickness_in) : null,
            pocket_depth_in: lyr?.pocket_depth_in != null ? Number(lyr.pocket_depth_in) : null,
            materialName: lyr?.material_name || lyr?.material_family || null,
          });
        }
      } catch { /* skip */ }
    }

    // 10) Build URLs (Step 29A: on the shop's own address)
    const sender = await shopSender(tenantId, quote.id);
    const baseUrl = sender.baseUrl;
    const quotePageUrl = `${baseUrl}/quote?quote_no=${encodeURIComponent(quoteNo)}`;
    const layoutUrl: string | null = facts.layout_editor_url || facts.layoutEditorUrl || (() => {
      if (!primaryItem) return null;
      const p = new URLSearchParams();
      p.set("quote_no", quoteNo);
      p.set("dims", `${Number(primaryItem.length_in)}x${Number(primaryItem.width_in)}x${Number(primaryItem.height_in)}`);
      return `${baseUrl}/quote/layout?${p.toString()}`;
    })();

    // 11) Subject line. Step 36E: same pattern as the status emails; the
    // revision only once released (never the internal staging "AS").
    const rev = quote.locked ? displayRevisionLabel(facts || {}, true) || null : null;
    const subject = (typeof opts.subject === "string" && opts.subject.trim())
      ? opts.subject.trim()
      : `${sender.brand}: quote ${quoteNo}${rev ? ` (revision ${rev})` : ""}`;

    // 12) Render HTML
    const density_pcf = primaryItem?.density_lb_ft3 != null ? Number(primaryItem.density_lb_ft3) : null;
    const cavities = Array.isArray(facts?.cavityDims)
      ? (facts.cavityDims as any[]).map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    const html = renderQuoteEmail({
      customerLine: quote.customer_name
        ? `${quote.customer_name}${quote.email ? ` • ${quote.email}` : ""}`
        : (quote.email || ""),
      quoteNumber: quote.quote_no,
      status: quote.status,
      specs: {
        L_in: primaryItem ? Number(primaryItem.length_in) : 0,
        W_in: primaryItem ? Number(primaryItem.width_in) : 0,
        H_in: primaryItem ? Number(primaryItem.height_in) : 0,
        qty: primaryItem ? Number(primaryItem.qty) : 0,
        density_pcf,
        foam_family: primaryItem?.material_family ?? null,
        thickness_under_in: facts?.thickness_under_in ?? facts?.thicknessUnderIn ?? null,
        color: facts?.color ?? null,
        cavityDims: cavities,
      },
      material: {
        name: primaryItem?.material_name || null,
        density_lbft3: density_pcf,
        kerf_pct: typeof primaryCalcRaw?.kerf_pct === "number" ? primaryCalcRaw.kerf_pct : null,
        min_charge: typeof primaryCalcRaw?.min_charge === "number" ? primaryCalcRaw.min_charge : null,
      },
      pricing: {
        total: grandTotal,
        used_min_charge: !!primaryCalcRaw?.used_min_charge,
        piece_ci: typeof primaryCalcRaw?.piece_ci === "number" ? primaryCalcRaw.piece_ci : null,
        order_ci: typeof primaryCalcRaw?.order_ci === "number" ? primaryCalcRaw.order_ci : null,
        order_ci_with_waste: typeof primaryCalcRaw?.order_ci_with_waste === "number" ? primaryCalcRaw.order_ci_with_waste : null,
        raw: { ...primaryCalcRaw, material_family: primaryItem?.material_family ?? null },
        price_breaks: Array.isArray(facts?.price_breaks) ? facts.price_breaks : null,
      },
      missing: [],
      facts: { ...facts, layout_editor_url: layoutUrl },
      lineItems: emailLineItems,
      foamSubtotal,
      packagingSubtotal,
      artSetupFee: artSetupFee > 0 ? artSetupFee : null,
      printingUpchargePct: printingUpchargePct > 0 ? printingUpchargePct : null,
      printingUpchargeAmt: printingUpchargeAmt > 0 ? printingUpchargeAmt : null,
      printingUpcharge: printingUpcharge > 0 ? printingUpcharge : null,
      printLabel: pc.printModel === "per_color" ? "Printing plates (one time)" : null,
      printSublabel: pc.printModel === "per_color" ? pc.printSummary : null,
      dieCuttingCharge: dieCuttingCharge > 0 ? dieCuttingCharge : null,
      dieCutTriggerQty: dieCutTriggerQty > 0 ? dieCutTriggerQty : null,
      processLines: processLines.length > 0 ? processLines : null,
      validUntil,
      leadTime,
      freightNote,
      grandTotal,
      shippingEstimate: shippingEstimate > 0 ? shippingEstimate : null,
      shippingIsCapped,
      roughShipPct: Number.isFinite(roughShipPct) ? roughShipPct : null,
      shippingCapUsd: Number.isFinite(shippingCapUsd) ? shippingCapUsd : null,
      layers: emailLayers.length > 0 ? emailLayers : null,
      layoutNotes: layoutPkg?.notes || null,
      quotePageUrl,
      // Step 36E: shop look + buyer name + released revision
      brand: sender.brand,
      primaryColor: sender.primaryColor,
      onPrimary: sender.onPrimary,
      logoUrl: sender.logoUrl,
      buyerName: quote.customer_name,
      revisionLabel: rev,
    });

    // 13) Send directly via MS Graph (no internal HTTP fetch)
    const TENANT = process.env.MS_TENANT_ID!;
    const CLIENT_ID = process.env.MS_CLIENT_ID!;
    const CLIENT_SECRET = process.env.MS_CLIENT_SECRET!;
    const FROM = process.env.MS_MAILBOX_FROM!;

    // Get OAuth token
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "client_credentials",
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => "");
      return { ok: false, error: "ms_token_failed", detail: `${tokenRes.status} ${t}`, status: 500 };
    }
    const accessToken = (await tokenRes.json()).access_token as string;

    // Send via Graph
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FROM)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject,
            toRecipients: [{ emailAddress: { address: to } }],
            from: { emailAddress: { address: FROM, name: sender.brand } },
            replyTo: [sender.replyTo || process.env.MS_MAILBOX_FROM || ""].filter(Boolean)
              .map(a => ({ emailAddress: { address: a, name: sender.brand } })),
            body: { contentType: "HTML", content: html },
          },
          saveToSentItems: true,
        }),
      }
    );

    const graphText = await graphRes.text().catch(() => "");
    console.log(`[send-quote] graph status=${graphRes.status} to=${to}`);
    const sentOk = graphRes.status === 202 || graphRes.ok;
    await logQuoteEmail({
      quoteId: quote.id,
      tenantId: tenantId,
      kind: "quote",
      to,
      subject,
      status: sentOk ? "sent" : "failed",
      detail: sentOk ? null : `graph_send_${graphRes.status}: ${graphText.slice(0, 300)}`,
      total: grandTotal,
      by: opts.by,
    });

    if (graphRes.status === 202 || graphRes.ok) {
      // Flip quote status -> sent (Step 37J: not for the automatic new-quote email)
      if (opts.markSent !== false) {
        try {
          await q(
            `UPDATE quotes SET status = 'sent'
             WHERE quote_no = $1 AND status IN ('draft', 'applied', 'revised')`,
            [quoteNo],
          );
        } catch (e) {
          console.error(`[send-quote] markSent failed: ${e}`);
        }
      }
      return { ok: true, quoteNo, to, subject, revision: rev };
    }

    return { ok: false, error: "graph_send_failed", status: 500, detail: `${graphRes.status} ${graphText.slice(0, 300)}` };
  } catch (e: any) {
    console.error(`[send-quote] fatal quoteNo=${quoteNo}`, e);
    return { ok: false, error: "fatal", status: 500, detail: String(e?.message || e) };
  }
}

/**
 * Step 37J: a buyer's new boxes-only quote is emailed to them right away
 * (their copy, with the private link to accept it). Never throws: a failed
 * email must not undo the quote. The result is in the quote's email list.
 */
export async function sendNewBoxQuoteEmail(quoteNo: string, tenantId: number): Promise<void> {
  try {
    const r = await sendQuoteEmail({ quoteNo, tenantId, by: "automatic (new quote)", markSent: false });
    if (!r.ok) console.error(`[send-quote] new box quote email not sent quoteNo=${quoteNo}: ${r.error}${r.detail ? ` ${r.detail}` : ""}`);
  } catch (e) {
    console.error(`[send-quote] new box quote email failed quoteNo=${quoteNo}`, e);
  }
}
