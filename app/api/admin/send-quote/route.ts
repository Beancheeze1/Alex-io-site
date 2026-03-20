// app/api/admin/send-quote/route.ts
//
// Admin-only: builds and sends the customer quote email.
//
// Data is loaded DIRECTLY from the DB (not via HTTP to /api/quote/print)
// so there are no auth/cookie forwarding issues and packaging + printing
// totals are always correct.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { getPricingSettings } from "@/app/lib/pricing/settings";
import { absoluteUrl } from "@/app/lib/internalFetch";
import { renderQuoteEmail, type TemplateLineItem, type TemplateLayoutLayer } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

type In = {
  quoteNo: string;
  to?: string;
  subject?: string;
};

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  status: string;
  created_at: string;
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

async function priceViaCalc(
  req: NextRequest,
  params: { L: number; W: number; H: number; qty: number; material_id: number; force_skived?: boolean; tenant_id?: any }
): Promise<{ unit: number; total: number; raw: any }> {
  const url = absoluteUrl(req, `/api/quotes/calc`);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      length_in: params.L,
      width_in: params.W,
      height_in: params.H,
      material_id: params.material_id,
      qty: params.qty,
      cavities: [],
      round_to_bf: false,
      force_skived: params.force_skived === true,
      tenant_id: params.tenant_id ?? null,
    }),
  });
  const j = await r.json().catch(() => ({} as any));
  const total = Number(j?.result?.total ?? j?.result?.price_total ?? j?.total ?? 0);
  const unit = params.qty > 0 ? total / params.qty : 0;
  return {
    unit: Number.isFinite(unit) ? unit : 0,
    total: Number.isFinite(total) ? total : 0,
    raw: j?.result ?? {},
  };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs", "sales"]))
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  let body: In;
  try { body = (await req.json()) as In; }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const quoteNo = typeof body.quoteNo === "string" ? body.quoteNo.trim() : "";
  if (!quoteNo) return json({ ok: false, error: "missing_quoteNo" }, 400);

  try {
    // 1) Load quote header directly from DB
    let quote: QuoteRow | null;
    try {
      quote = await one<QuoteRow>(
        `SELECT id, quote_no, customer_name, email, phone, status, created_at
         FROM quotes
         WHERE quote_no = $1 AND tenant_id = $2
         LIMIT 1`,
        [quoteNo, user.tenant_id],
      );
    } catch (e: any) {
      return json({ ok: false, error: "db_quote_lookup_failed", detail: String(e?.message || e) }, 500);
    }
    if (!quote) return json({ ok: false, error: "quote_not_found" }, 404);

    const to = (typeof body.to === "string" && body.to.trim())
      ? body.to.trim()
      : (quote.email || "").trim();
    if (!to) return json({ ok: false, error: "missing_customer_email" }, 400);

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
                qi.notes
         FROM quote_items qi
         LEFT JOIN materials m ON m.id = qi.material_id
         WHERE qi.quote_id = $1
         ORDER BY qi.id ASC`,
        [quote.id],
      );
    } catch (e: any) {
      return json({ ok: false, error: "db_items_failed", detail: String(e?.message || e) }, 500);
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
      const priced = await priceViaCalc(req, { L, W, H, qty, material_id: mid, force_skived: forceSkive, tenant_id: user.tenant_id });
      if (forceSkive) skiveConsumed = true;
      if (!primaryCalcCaptured) { primaryCalcRaw = priced.raw; primaryCalcCaptured = true; }

      items.push({ ...it, price_unit_usd: priced.unit, price_total_usd: priced.total });
    }

    // 5) Load packaging lines directly from DB
    let packagingLines: PkgRow[] = [];
    try {
      packagingLines = await q<PkgRow>(
        `SELECT qbs.id, qbs.sku, qbs.qty,
                qbs.unit_price_usd, qbs.extended_price_usd,
                b.vendor, b.style, b.description,
                b.inside_length_in, b.inside_width_in, b.inside_height_in
         FROM quote_box_selections qbs
         JOIN boxes b ON b.id = qbs.box_id
         WHERE qbs.quote_id = $1`,
        [quote.id],
      );
    } catch (e: any) {
      return json({ ok: false, error: "db_packaging_failed", detail: String(e?.message || e) }, 500);
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
      settings = await getPricingSettings(user.tenant_id);
    } catch (e: any) {
      return json({ ok: false, error: "settings_failed", detail: String(e?.message || e) }, 500);
    }
    const isPrinted = !!(facts?.printed === 1 || facts?.printed === "1" || facts?.printed === true);
    const artSetupFee = isPrinted ? Number(settings.printing_upcharge_usd || 0) : 0;
    const printingUpchargePct = isPrinted ? Number(settings.printing_upcharge_pct || 0) : 0;
    const printingUpchargeAmt = Math.round((foamSubtotal + packagingSubtotal) * (printingUpchargePct / 100) * 100) / 100;
    const printingUpcharge = artSetupFee + printingUpchargeAmt;
    const grandTotal = foamSubtotal + packagingSubtotal + printingUpcharge;

    console.log(`[send-quote] foam=${foamSubtotal} pkg=${packagingSubtotal} artSetup=${artSetupFee} upchargeAmt=${printingUpchargeAmt} grand=${grandTotal}`);

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
        sublabel: pkg.style || pkg.vendor || null,
        dims: (pkg.inside_length_in && pkg.inside_width_in && pkg.inside_height_in)
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

    // 10) Build URLs
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const quotePageUrl = `${baseUrl}/quote?quote_no=${encodeURIComponent(quoteNo)}`;
    const layoutUrl: string | null = facts.layout_editor_url || facts.layoutEditorUrl || (() => {
      if (!primaryItem) return null;
      const p = new URLSearchParams();
      p.set("quote_no", quoteNo);
      p.set("dims", `${Number(primaryItem.length_in)}x${Number(primaryItem.width_in)}x${Number(primaryItem.height_in)}`);
      return `${baseUrl}/quote/layout?${p.toString()}`;
    })();

    // 11) Subject line
    const revisionRaw = typeof facts?.revision === "string" ? facts.revision.trim() : "";
    const rev = revisionRaw || null;
    const subject = (typeof body.subject === "string" && body.subject.trim())
      ? body.subject.trim()
      : `Quote ${quoteNo}${rev ? ` ${rev}` : ""} — Alex-IO`;

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
      grandTotal,
      layers: emailLayers.length > 0 ? emailLayers : null,
      layoutNotes: layoutPkg?.notes || null,
      quotePageUrl,
    });

    // 13) Send via MS Graph
    const sendUrl = absoluteUrl(req, "/api/ms/send");
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to, subject, html,
        replyTo: [process.env.MS_MAILBOX_FROM || ""].filter(Boolean),
        quoteNo,
      }),
    });

    const sendCt = sendRes.headers.get("content-type") || "";
    const sendJson = sendCt.includes("application/json")
      ? await sendRes.json()
      : { ok: sendRes.ok, raw: await sendRes.text() };

    if (!sendRes.ok || !sendJson?.ok) {
      return json({ ok: false, error: "ms_send_failed", status: sendRes.status, detail: sendJson }, 500);
    }

    return json({ ok: true, sent: sendJson.sent || null, quoteNo, to, subject, revision: rev });

  } catch (e: any) {
    console.error(`[send-quote] fatal quoteNo=${quoteNo}`, e);
    return json({ ok: false, error: "fatal", detail: String(e?.message || e) }, 500);
  }
}