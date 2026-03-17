// app/api/admin/send-quote/route.ts
//
// Admin-only helper:
//  - Loads quote via /api/quote/print
//  - Runs deterministic pricing via /api/quotes/calc (no pricing math changes)
//  - Renders the customer HTML email via renderQuoteEmail
//  - Sends via /api/ms/send (Graph) with saveToSentItems=true
//  - /api/ms/send flips quotes.status -> 'sent' when quoteNo is provided
//
// IMPORTANT (Path A):
// - No refactors, no schema changes.
// - No changes to pricing math, cavities, layout, etc.
// - This route only orchestrates existing pieces.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { enforceTenantMatch } from "@/lib/tenant-enforce";

import { absoluteUrl } from "@/app/lib/internalFetch";
import { renderQuoteEmail, type TemplateLineItem, type TemplateLayoutLayer } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

type PrintOk = {
  ok: true;
  quote: {
    quote_no: string;
    customer_name: string;
    email: string | null;
    phone: string | null;
    status: string;
    created_at: string;
  };
  items: Array<{
    id: number;
    quote_id: number;
    length_in: string;
    width_in: string;
    height_in: string;
    qty: number;
    material_id: number;
    material_name: string | null;
    material_family?: string | null;
    density_lb_ft3?: number | null;
    notes?: string | null;
    price_unit_usd?: number | null;
    price_total_usd?: number | null;
  }>;
  packagingLines?: Array<{
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
  }>;
  foamSubtotal?: number | null;
  packagingSubtotal?: number | null;
  printingUpcharge?: number | null;
  grandTotal?: number | null;
  layoutPkg?: {
    id: number;
    layout_json: any;
    notes: string | null;
  } | null;
  facts?: any;
};

type PrintErr = { ok: false; error: string; message: string };
type PrintResp = PrintOk | PrintErr;

type CalcOk = {
  ok: true;
  result: {
    total: number;
    used_min_charge?: boolean | null;
    piece_ci?: number | null;
    order_ci?: number | null;
    order_ci_with_waste?: number | null;

    kerf_pct?: number | null;
    min_charge?: number | null;
    setup_fee?: number | null;

    material_name?: string | null;
    [k: string]: any;
  };
};

type CalcErr = { ok: false; error: string; detail?: any };
type CalcResp = CalcOk | CalcErr;

type In = {
  quoteNo: string;
  // Optional overrides (mostly for testing)
  to?: string;
  subject?: string;
};

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromRequest(req);
  const enforced = await enforceTenantMatch(req, user);
  if (!enforced.ok) return NextResponse.json(enforced.body, { status: enforced.status });
  if (!user) return NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });

  let body: In;
  try {
    body = (await req.json()) as In;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const quoteNo = typeof body.quoteNo === "string" ? body.quoteNo.trim() : "";
  if (!quoteNo) return json({ ok: false, error: "missing_quoteNo" }, 400);

  try {
    // 1) Load quote + items + facts (single source of truth)
    const printUrl = absoluteUrl(req, `/api/quote/print?quote_no=${encodeURIComponent(quoteNo)}`);
    const printRes = await fetch(printUrl, { cache: "no-store" });
    const printJson = (await printRes.json()) as PrintResp;

    if (!printRes.ok || !printJson.ok) {
      return json(
        {
          ok: false,
          error: "quote_print_failed",
          status: printRes.status,
          detail: printJson,
        },
        500,
      );
    }

    const quote = printJson.quote;
    const items = Array.isArray(printJson.items) ? printJson.items : [];
    const facts = (printJson as any).facts || {};

    const primary = items[0] || null;
    if (!primary) {
      return json({ ok: false, error: "no_items_on_quote" }, 400);
    }

    const to = (typeof body.to === "string" && body.to.trim()) ? body.to.trim() : (quote.email || "").trim();
    if (!to) return json({ ok: false, error: "missing_customer_email" }, 400);

    // 2) Deterministic calc (no changes to pricing logic)
    const cavitiesFromFacts = Array.isArray(facts?.cavityDims) ? (facts.cavityDims as any[]) : [];
    const cavities = cavitiesFromFacts
      .map((x) => String(x || "").trim())
      .filter((s) => !!s);

    const L = Number(primary.length_in);
    const W = Number(primary.width_in);
    const H = Number(primary.height_in);
    const qty = Number(primary.qty);
    const material_id = Number(primary.material_id);

    if (!Number.isFinite(L) || !Number.isFinite(W) || !Number.isFinite(H) || L <= 0 || W <= 0 || H <= 0) {
      return json({ ok: false, error: "bad_primary_dims", detail: { L, W, H } }, 400);
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return json({ ok: false, error: "bad_primary_qty", detail: { qty } }, 400);
    }
    if (!Number.isFinite(material_id) || material_id <= 0) {
      return json({ ok: false, error: "bad_primary_material_id", detail: { material_id } }, 400);
    }

    const calcUrl = absoluteUrl(req, "/api/quotes/calc");
    const calcRes = await fetch(calcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        length_in: L,
        width_in: W,
        height_in: H,
        material_id,
        qty,
        cavities,
        round_to_bf: false,
      }),
    });

    const calcJson = (await calcRes.json()) as CalcResp;
    if (!calcRes.ok || !calcJson.ok) {
      return json(
        {
          ok: false,
          error: "calc_failed",
          status: calcRes.status,
          detail: calcJson,
        },
        500,
      );
    }

    const result = (calcJson as CalcOk).result || ({} as any);

    // 3) Render customer email HTML (server-side)
    const revisionRaw = typeof facts?.revision === "string" ? facts.revision.trim() : "";
    const rev = revisionRaw ? revisionRaw : null;

    const subject =
      (typeof body.subject === "string" && body.subject.trim())
        ? body.subject.trim()
        : `Quote ${quoteNo}${rev ? ` ${rev}` : ""} — Alex-IO`;

    const density = primary.density_lb_ft3 != null ? Number(primary.density_lb_ft3) : null;
    const density_pcf = density != null && Number.isFinite(density) ? density : null;

    // ── Build rich line items for the email ──────────────────────────────
    const LAYOUT_LAYER_TAG = "[LAYOUT-LAYER]";
    const PACKAGING_TAG = "[PACKAGING]";

    // Helper: is this a layout reference-only row?
    const isLayerRow = (it: typeof items[0]) =>
      String(it.notes || "").toUpperCase().includes(LAYOUT_LAYER_TAG);
    const isPackagingRow = (it: typeof items[0]) =>
      String(it.notes || "").includes("Requested shipping carton") ||
      String(it.notes || "").includes(PACKAGING_TAG);

    const primaryItem = items[0];
    const hasLayerRows = items.some(isLayerRow);

    // Build the primary "Foam set" line first
    const emailLineItems: TemplateLineItem[] = [];

    if (primaryItem && !isLayerRow(primaryItem) && !isPackagingRow(primaryItem)) {
      const unitPx = primaryItem.price_unit_usd != null ? Number(primaryItem.price_unit_usd) : null;
      const totalPx = primaryItem.price_total_usd != null ? Number(primaryItem.price_total_usd) : null;

      emailLineItems.push({
        id: primaryItem.id,
        label: hasLayerRows
          ? "Foam set — layered construction"
          : (primaryItem.material_name || `Material #${primaryItem.material_id}`),
        sublabel: hasLayerRows
          ? "Includes all bonded layers shown below (for reference)."
          : primaryItem.material_family || null,
        dims: `${Number(primaryItem.length_in)} × ${Number(primaryItem.width_in)} × ${Number(primaryItem.height_in)} in`,
        qty: Number(primaryItem.qty),
        unitPrice: unitPx ?? (typeof result.total === "number" && qty > 0 ? result.total / qty : null),
        lineTotal: totalPx ?? (typeof result.total === "number" ? result.total : null),
        isIncluded: false,
        isPackaging: false,
      });
    }

    // Add layout-layer reference rows
    for (const it of items) {
      if (!isLayerRow(it)) continue;
      emailLineItems.push({
        id: it.id,
        label: "Included layer",
        sublabel: [it.material_name, it.material_family ? `${it.material_family}` : null]
          .filter(Boolean)
          .join(" · ") || null,
        dims: `${Number(it.length_in)} × ${Number(it.width_in)} × ${Number(it.height_in)} in`,
        qty: Number(it.qty),
        unitPrice: null,
        lineTotal: null,
        isIncluded: true,
        isPackaging: false,
      });
    }

    // Add packaging lines from print route
    const printPackaging = Array.isArray(printJson.packagingLines) ? printJson.packagingLines : [];
    for (const pkg of printPackaging) {
      const iL = pkg.inside_length_in;
      const iW = pkg.inside_width_in;
      const iH = pkg.inside_height_in;
      const dimStr = (iL && iW && iH) ? `${iL} × ${iW} × ${iH} in` : "—";
      const label = pkg.description
        ? `${pkg.description}${pkg.sku ? ` ${pkg.sku}` : ""}`
        : (pkg.sku || "Carton");
      emailLineItems.push({
        id: pkg.id,
        label: label.trim(),
        sublabel: pkg.style || pkg.vendor || null,
        dims: dimStr,
        qty: Number(pkg.qty) || 1,
        unitPrice: pkg.unit_price_usd != null ? Number(pkg.unit_price_usd) : null,
        lineTotal: pkg.extended_price_usd != null ? Number(pkg.extended_price_usd) : null,
        isIncluded: false,
        isPackaging: true,
      });
    }

    // ── Build layer text summary from layoutPkg ───────────────────────────
    const emailLayers: TemplateLayoutLayer[] = [];
    const layoutPkg = (printJson as any).layoutPkg ?? null;
    if (layoutPkg?.layout_json) {
      try {
        const ljRaw = typeof layoutPkg.layout_json === "string"
          ? JSON.parse(layoutPkg.layout_json)
          : layoutPkg.layout_json;
        const layerArr: any[] = Array.isArray(ljRaw?.layers) ? ljRaw.layers : [];
        for (let i = 0; i < layerArr.length; i++) {
          const lyr = layerArr[i];
          emailLayers.push({
            index: i + 1,
            total: layerArr.length,
            thickness_in: lyr?.thickness_in != null ? Number(lyr.thickness_in) : null,
            pocket_depth_in: lyr?.pocket_depth_in != null ? Number(lyr.pocket_depth_in) : null,
            materialName: lyr?.material_name || lyr?.material_family || null,
          });
        }
      } catch {
        // layout_json parse error — skip layers
      }
    }

    // ── Quote page URL ────────────────────────────────────────────────────
    const _baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const quotePageUrl = `${_baseUrl}/quote/${encodeURIComponent(quoteNo)}`;

    // ── Totals from print route (authoritative — don't recalculate) ──────
    const printFoamSubtotal = typeof (printJson as any).foamSubtotal === "number"
      ? (printJson as any).foamSubtotal : null;
    const printPackagingSubtotal = typeof (printJson as any).packagingSubtotal === "number"
      ? (printJson as any).packagingSubtotal : null;
    const printArtSetupFee = typeof (printJson as any).artSetupFee === "number"
      ? (printJson as any).artSetupFee : null;
    const printUpchargePct = typeof (printJson as any).printingUpchargePct === "number"
      ? (printJson as any).printingUpchargePct : null;
    const printUpchargeAmt = typeof (printJson as any).printingUpchargeAmt === "number"
      ? (printJson as any).printingUpchargeAmt : null;
    const printUpchargeTotal = typeof (printJson as any).printingUpcharge === "number"
      ? (printJson as any).printingUpcharge : 0;
    const printGrandTotal = typeof (printJson as any).grandTotal === "number"
      ? (printJson as any).grandTotal : null;

    const html = renderQuoteEmail({
      customerLine: quote.customer_name ? `${quote.customer_name}${quote.email ? ` • ${quote.email}` : ""}` : (quote.email || ""),
      quoteNumber: quote.quote_no,
      status: quote.status,
      specs: {
        L_in: L,
        W_in: W,
        H_in: H,
        qty,
        density_pcf,
        foam_family: primary.material_family ?? null,
        thickness_under_in: facts?.thickness_under_in ?? facts?.thicknessUnderIn ?? null,
        color: facts?.color ?? null,
        cavityDims: cavities,
      },
      material: {
        name: primary.material_name || result.material_name || null,
        density_lbft3: density_pcf,
        kerf_pct: typeof result.kerf_pct === "number" ? result.kerf_pct : null,
        min_charge: typeof result.min_charge === "number" ? result.min_charge : null,
      },
      pricing: {
        total: printGrandTotal ?? ((typeof result.total === "number" ? result.total : 0) + printUpchargeTotal),
        used_min_charge: !!result.used_min_charge,
        piece_ci: typeof result.piece_ci === "number" ? result.piece_ci : null,
        order_ci: typeof result.order_ci === "number" ? result.order_ci : null,
        order_ci_with_waste: typeof result.order_ci_with_waste === "number" ? result.order_ci_with_waste : null,
        raw: {
          ...result,
          material_family: primary.material_family ?? null,
        },
        price_breaks: Array.isArray(facts?.price_breaks) ? facts.price_breaks : null,
      },
      missing: [],
      facts,
      // Rich data for the new sections
      lineItems: emailLineItems,
      foamSubtotal: printFoamSubtotal,
      packagingSubtotal: printPackagingSubtotal,
      artSetupFee: printArtSetupFee,
      printingUpchargePct: printUpchargePct,
      printingUpchargeAmt: printUpchargeAmt,
      printingUpcharge: printUpchargeTotal > 0 ? printUpchargeTotal : null,
      grandTotal: printGrandTotal,
      layers: emailLayers.length > 0 ? emailLayers : null,
      layoutNotes: layoutPkg?.notes || null,
      quotePageUrl,
    });

    // 4) Send via Graph (existing route flips quotes.status -> 'sent')
    const sendUrl = absoluteUrl(req, "/api/ms/send");
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to,
        subject,
        html,
        replyTo: [process.env.MS_MAILBOX_FROM || ""].filter(Boolean),
        quoteNo,
      }),
    });

    const sendCt = sendRes.headers.get("content-type") || "";
    const sendJson = sendCt.includes("application/json") ? await sendRes.json() : { ok: sendRes.ok, raw: await sendRes.text() };

    if (!sendRes.ok || !sendJson?.ok) {
      return json(
        {
          ok: false,
          error: "ms_send_failed",
          status: sendRes.status,
          detail: sendJson,
        },
        500,
      );
    }

    return json({
      ok: true,
      sent: sendJson.sent || null,
      quoteNo,
      to,
      subject,
      revision: rev,
    });
  } catch (e: any) {
    console.log(`[admin/send-quote] fatal quoteNo=${quoteNo} err=${String(e?.message || e)}`);
    return json({ ok: false, error: "fatal", detail: String(e?.message || e) }, 500);
  }
}