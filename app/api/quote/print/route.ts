// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches a pricing snapshot to each item using
// the volumetric calc route.
//
// GET /api/quote/print?quote_no=Q-AI-20251116-115613

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";
import { loadFacts } from "@/app/lib/memory";
import { computePricingBreakdown } from "@/app/lib/pricing/compute";
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

  price_unit_usd?: number | null;
  price_total_usd?: number | null;
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

async function attachPricingToItem(item: ItemRow): Promise<ItemRow> {
  const { L, W, H } = parseDimsNums(item);

  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return item;
  if (!Number.isFinite(Number(item.qty)) || item.qty <= 0) return item;
  if (!Number.isFinite(Number(item.material_id)) || item.material_id <= 0) return item;

  const result = await computePricingBreakdown({
    length_in: L,
    width_in: W,
    height_in: H,
    density_lbft3: item.density_lb_ft3 ?? null,
    cost_per_lb: null,
    qty: item.qty,
  } as any);

  return {
    ...item,
    price_unit_usd: Number((result as any)?.unitPrice ?? item.price_unit_usd ?? null),
    price_total_usd: Number((result as any)?.extendedPrice ?? item.price_total_usd ?? null),
  };
}

export async function GET(req: NextRequest) {
  const quoteNo = req.nextUrl.searchParams.get("quote_no");

  if (!quoteNo) {
    return bad({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
  }

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

    let itemsRaw = await q<ItemRow>(
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

    let items: ItemRow[] = [];
    for (const it of itemsRaw) {
      try {
        items.push(await attachPricingToItem(it));
      } catch {
        items.push(it);
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

    // ✅ SVG regen (roundedRect fix) — already correct
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
