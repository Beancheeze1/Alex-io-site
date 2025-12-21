// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches a pricing snapshot to each item.
//
// GET /api/quote/print?quote_no=Q-AI-20251116-115613
//
// PATH A FIX (real pricing):
// - Only price AFTER Apply-to-Quote created quote_items.
// - Use the real deterministic endpoint /api/quotes/calc (material-based).
// - If no quote_items exist yet, pricing stays blank (UI shows "—") which is correct.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { buildLayoutExports } from "@/app/lib/layout/exports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type QuoteRow = {
  id: number;
  quote_no: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
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
  material_family?: string | null;
  density_lb_ft3?: number | null;
  notes?: string | null;

  // priced outputs (stored/attached)
  price_unit_usd?: number | null;
  price_total_usd?: number | null;

  // optional meta (client uses this for copy)
  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_waste_pct?: number | null;
  } | null;

  // optional breakdown (client reads unitPrice/extendedPrice/breaks)
  pricing_breakdown?: {
    volumeIn3: number;
    materialWeightLb: number;
    materialCost: number;
    machineMinutes: number;
    machineCost: number;
    rawCost: number;
    markupFactor: number;
    sellPrice: number;
    unitPrice: number;
    extendedPrice: number;
    qty: number;
    breaks: { qty: number; unit: number; total: number }[];
  } | null;
};

type LayoutPkgRow = {
  id: number;
  quote_id: number;
  layout_json: any;
  notes: string | null;
  svg_text: string | null;
  dxf_text: string | null;
  step_text: string | null;
  created_at: string;
};

export type PackagingLine = {
  id: number;
  quote_id: number;
  box_id: number;
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

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

function parseDimsNums(item: ItemRow) {
  return {
    L: Number(item.length_in),
    W: Number(item.width_in),
    H: Number(item.height_in),
  };
}

function safeNum(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Call the real deterministic pricing endpoint.
 * NOTE: This only runs once quote_items exist (Apply-to-Quote has happened).
 */
async function callQuotesCalc(origin: string, payload: any) {
  const url = `${origin}/api/quotes/calc`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  // If calc errors, keep the item unpriced (do not break the whole print endpoint)
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`quotes_calc_failed_${res.status}:${txt}`);
  }

  const json = (await res.json().catch(() => null)) as any;
  if (!json || json.ok !== true || !json.result) {
    throw new Error(`quotes_calc_bad_response`);
  }

  return json;
}

/**
 * Attach real pricing to a quote item using /api/quotes/calc.
 * Path A:
 * - We do NOT guess material.
 * - We do NOT price if dims/material/qty are invalid.
 * - We do NOT explode the whole request if pricing fails.
 */
async function attachPricingToItem(item: ItemRow, origin: string): Promise<ItemRow> {
  const { L, W, H } = parseDimsNums(item);

  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return item;
  if (!Number.isFinite(Number(item.qty)) || item.qty <= 0) return item;
  if (!Number.isFinite(Number(item.material_id)) || item.material_id <= 0) return item;

  // Cavities are intentionally NOT used for pricing in v1 unless you decide otherwise.
  // (If you want them included later, we can wire them from facts/layout.)
  const payload = {
    length_in: L,
    width_in: W,
    height_in: H,
    material_id: item.material_id,
    qty: item.qty,
    cavities: [],
    round_to_bf: false,
  };

  const calc = await callQuotesCalc(origin, payload);
  const r = calc.result || {};

  const total = safeNum(r.total);
  const qty = Number(item.qty);
  const unit = total != null && qty > 0 ? Math.round((total / qty) * 100) / 100 : null;

  // Build a minimal breakdown object that your UI already understands.
  // We keep the "extra fields" zeroed because /api/quotes/calc returns
  // total/min_charge/kerf/setup, not material+machine cost components.
  const volumeIn3 = Math.max(0, L * W * H);

  const breakQtys = [1, 10, 25, 50, 100, 150, 250];
  const breaks = breakQtys.map((bq) => {
    const bTotal = unit != null ? unit * bq : 0;
    return { qty: bq, unit: unit ?? 0, total: bTotal };
  });

  return {
    ...item,
    price_unit_usd: unit ?? item.price_unit_usd ?? null,
    price_total_usd: total ?? item.price_total_usd ?? null,

    pricing_meta: {
      min_charge: safeNum(r.min_charge),
      used_min_charge: !!r.used_min_charge,
      setup_fee: safeNum(r.setup_fee),
      kerf_waste_pct: safeNum(r.kerf_pct),
    },

    pricing_breakdown: unit != null && total != null
      ? {
          volumeIn3,
          materialWeightLb: 0,
          materialCost: 0,
          machineMinutes: 0,
          machineCost: 0,
          rawCost: 0,
          markupFactor: safeNum(r.markup_factor) ?? 1,
          sellPrice: total,
          unitPrice: unit,
          extendedPrice: total,
          qty,
          breaks,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const quoteNo = req.nextUrl.searchParams.get("quote_no");

  if (!quoteNo) {
    return bad({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

  // Origin for calling /api/quotes/calc on the same deployment
  const origin = req.nextUrl.origin;

  try {
    const quote = await one<QuoteRow>(
      `
      select
        id,
        quote_no,
        customer_name,
        email,
        phone,
        company,
        status,
        created_at
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad({ ok: false, error: "NOT_FOUND" }, 404);
    }

    const itemsRaw = await q<ItemRow>(
      `
      select
        qi.id,
        qi.quote_id,
        qi.length_in,
        qi.width_in,
        qi.height_in,
        qi.qty,
        qi.material_id,
        m.name as material_name,
        m.material_family,
        m.density_lb_ft3,
        qi.notes
      from quote_items qi
      left join materials m on m.id = qi.material_id
      where qi.quote_id = $1
      order by qi.id asc
      `,
      [quote.id],
    );

    // PATH A: If there are no quote_items, that means Apply-to-Quote has not happened yet.
    // We return empty items and subtotals 0. Client will correctly show "—".
    let items: ItemRow[] = [];
    if (itemsRaw && itemsRaw.length > 0) {
      for (const it of itemsRaw) {
        try {
          items.push(await attachPricingToItem(it, origin));
        } catch {
          items.push(it);
        }
      }
    }

    let layoutPkg = await one<LayoutPkgRow>(
      `
      select
        id,
        quote_id,
        layout_json,
        notes,
        svg_text,
        dxf_text,
        step_text,
        created_at
      from quote_layout_packages
      where quote_id = $1
      order by created_at desc
      limit 1
      `,
      [quote.id],
    );

    // ✅ SVG regen (roundedRect fix) — keep as-is
    if (layoutPkg?.layout_json) {
      try {
        const bundle = buildLayoutExports(layoutPkg.layout_json);
        if (bundle?.svg) {
          layoutPkg = { ...layoutPkg, svg_text: bundle.svg };
        }
      } catch {}
    }

    const packagingLines: PackagingLine[] = await q(
      `
      select
        qbs.id,
        qbs.quote_id,
        qbs.box_id,
        qbs.sku,
        qbs.qty,
        qbs.unit_price_usd,
        qbs.extended_price_usd,
        b.vendor,
        b.style,
        b.description,
        b.inside_length_in,
        b.inside_width_in,
        b.inside_height_in
      from quote_box_selections qbs
      join boxes b on b.id = qbs.box_id
      where qbs.quote_id = $1
      `,
      [quote.id],
    );

    const foamSubtotal = items.reduce((s, i) => s + (Number(i.price_total_usd) || 0), 0);
    const packagingSubtotal = packagingLines.reduce((s, l) => s + (Number(l.extended_price_usd) || 0), 0);

    return ok({
      ok: true,
      quote,
      items,
      layoutPkg,
      packagingLines,
      foamSubtotal,
      packagingSubtotal,
      grandSubtotal: foamSubtotal + packagingSubtotal,
      facts: await loadFacts(quoteNo),
    });
  } catch (err) {
    console.error(err);
    return bad({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
