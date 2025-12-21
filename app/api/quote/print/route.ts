// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches pricing snapshot to the PRIMARY item
// by calling the real volumetric calc route.
//
// GET /api/quote/print?quote_no=Q-AI-20251116-115613

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

  price_unit_usd?: number | null;
  price_total_usd?: number | null;

  // Optional metadata used by some UIs/templates (safe to attach if present)
  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_waste_pct?: number | null;
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

function cleanStringArray(x: any): string[] {
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const v of x) {
    const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
    if (s) out.push(s);
  }
  return out;
}

/**
 * Best-effort extraction of cavity strings from facts.
 * We intentionally keep this conservative + non-destructive.
 */
function extractCavityStrings(facts: any): string[] {
  if (!facts || typeof facts !== "object") return [];

  // Most common: facts.cavities = ["5x4x1","3x3x1"] or ["Ø6x1"]
  const direct = cleanStringArray((facts as any).cavities);
  if (direct.length) return direct;

  // Alternate common keys
  const alt1 = cleanStringArray((facts as any).cavityDims);
  if (alt1.length) return alt1;

  const alt2 = cleanStringArray((facts as any).cavity_dims);
  if (alt2.length) return alt2;

  const alt3 = cleanStringArray((facts as any).cavity_list);
  if (alt3.length) return alt3;

  // Nested shapes some versions used
  const nested = (facts as any).parsed || (facts as any).specs || null;
  if (nested && typeof nested === "object") {
    const n1 = cleanStringArray((nested as any).cavities);
    if (n1.length) return n1;
    const n2 = cleanStringArray((nested as any).cavityDims);
    if (n2.length) return n2;
  }

  return [];
}

/**
 * Call the real volumetric pricing route.
 * Returns { unitPrice, total, kerf_pct, used_min_charge, min_charge, setup_fee }
 */
async function callVolumetricCalc(args: {
  origin: string;
  length_in: number;
  width_in: number;
  height_in: number;
  material_id: number;
  qty: number;
  cavities: string[];
}): Promise<{
  unitPrice: number | null;
  total: number | null;
  kerf_pct?: number | null;
  used_min_charge?: boolean;
  min_charge?: number | null;
  setup_fee?: number | null;
}> {
  const url = `${args.origin}/api/quotes/calc`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // IMPORTANT: keep payload simple + deterministic
    body: JSON.stringify({
      length_in: args.length_in,
      width_in: args.width_in,
      height_in: args.height_in,
      material_id: args.material_id,
      qty: args.qty,
      cavities: args.cavities || [],
      round_to_bf: false,
    }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as any;

  if (!res.ok || !json?.ok) {
    // Fail soft: no throw here; caller will fallback gracefully.
    return { unitPrice: null, total: null };
  }

  const total = Number(json?.result?.total);
  const qty = Number(args.qty);

  const totalOk = Number.isFinite(total) && total >= 0;
  const qtyOk = Number.isFinite(qty) && qty > 0;

  const unitPrice = totalOk && qtyOk ? Math.round((total / qty) * 100) / 100 : null;

  return {
    unitPrice,
    total: totalOk ? Math.round(total * 100) / 100 : null,
    kerf_pct: typeof json?.result?.kerf_pct === "number" ? json.result.kerf_pct : null,
    used_min_charge: !!json?.result?.used_min_charge,
    min_charge: typeof json?.result?.min_charge === "number" ? json.result.min_charge : null,
    setup_fee: typeof json?.result?.setup_fee === "number" ? json.result.setup_fee : null,
  };
}

async function attachPricingToPrimaryItem(args: {
  origin: string;
  item: ItemRow;
  cavities: string[];
}): Promise<ItemRow> {
  const { item } = args;
  const { L, W, H } = parseDimsNums(item);

  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return item;
  if (!Number.isFinite(Number(item.qty)) || item.qty <= 0) return item;
  if (!Number.isFinite(Number(item.material_id)) || item.material_id <= 0) return item;

  const priced = await callVolumetricCalc({
    origin: args.origin,
    length_in: L,
    width_in: W,
    height_in: H,
    material_id: item.material_id,
    qty: item.qty,
    cavities: args.cavities || [],
  });

  return {
    ...item,
    price_unit_usd: priced.unitPrice ?? null,
    price_total_usd: priced.total ?? null,
    pricing_meta: {
      min_charge: priced.min_charge ?? null,
      used_min_charge: !!priced.used_min_charge,
      setup_fee: priced.setup_fee ?? null,
      kerf_waste_pct: priced.kerf_pct ?? null,
    },
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

    // Load facts once (needed for cavity strings and to return to caller)
    const facts = await loadFacts(quoteNo);
    const cavitiesFromFacts = extractCavityStrings(facts);

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

    // IMPORTANT: Only the PRIMARY row gets priced (the UI treats others as Included layers)
    const origin = req.nextUrl.origin;

    const items: ItemRow[] = [];
    if (itemsRaw.length > 0) {
      const primary = itemsRaw[0];
      let pricedPrimary: ItemRow = primary;

      try {
        pricedPrimary = await attachPricingToPrimaryItem({
          origin,
          item: primary,
          cavities: cavitiesFromFacts,
        });
      } catch {
        pricedPrimary = primary;
      }

      items.push(pricedPrimary);

      for (let i = 1; i < itemsRaw.length; i++) {
        items.push({
          ...itemsRaw[i],
          price_unit_usd: null,
          price_total_usd: null,
        });
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

    // ✅ SVG regen (roundedRect fix)
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

    // Foam subtotal should come ONLY from the primary priced row.
    const foamSubtotal = items.length > 0 ? Number(items[0].price_total_usd) || 0 : 0;
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
      facts,
    });
  } catch (err) {
    console.error(err);
    return bad({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
