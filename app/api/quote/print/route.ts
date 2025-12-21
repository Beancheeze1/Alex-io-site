// app/api/quote/print/route.ts
//
// Returns full quote data (header + items + latest layout package)
// by quote_no, and attaches a pricing snapshot to the PRIMARY foam item
// using /api/quotes/calc (authoritative pricing route).
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

  // persisted/display fields (used by QuotePrintClient fallbacks)
  price_unit_usd?: number | null;
  price_total_usd?: number | null;

  // NEW: metadata payload used by QuotePrintClient (already supported there)
  pricing_meta?: {
    min_charge?: number | null;
    used_min_charge?: boolean;
    setup_fee?: number | null;
    kerf_waste_pct?: number | null;
  } | null;

  // NOTE: We intentionally do NOT force pricing_breakdown here yet.
  // The UI already falls back correctly to price_* fields.
  pricing_breakdown?: any | null;
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

/**
 * Try to extract cavities for pricing from facts.
 * We keep this permissive and safe:
 * - If facts contain cavity strings (e.g. ["2x3x0.5","Ø6x1"]), use them.
 * - Otherwise send none (pricing still works).
 */
function extractCavityStringsFromFacts(facts: any): string[] {
  const out: string[] = [];

  if (!facts || typeof facts !== "object") return out;

  // Common shapes we’ve used in the project over time.
  const candidates = [
    (facts as any).cavities,
    (facts as any).cavitySpecs,
    (facts as any).cavity_strings,
    (facts as any).cavityStrings,
    (facts as any).parsed?.cavities,
    (facts as any).layout?.cavities,
  ];

  for (const cand of candidates) {
    if (!cand) continue;

    // If it’s already string[]
    if (Array.isArray(cand) && cand.every((x) => typeof x === "string")) {
      for (const s of cand) {
        const t = String(s).trim();
        if (t) out.push(t);
      }
      break;
    }

    // If it’s object cavities, try to create "LxWxD" strings when possible
    if (Array.isArray(cand) && cand.length > 0 && typeof cand[0] === "object") {
      for (const c of cand) {
        const L = Number((c as any).lengthIn ?? (c as any).length_in ?? (c as any).length);
        const W = Number((c as any).widthIn ?? (c as any).width_in ?? (c as any).width);
        const D = Number((c as any).depthIn ?? (c as any).depth_in ?? (c as any).depth);
        const dia = Number((c as any).diameterIn ?? (c as any).diameter_in ?? (c as any).diameter);

        const shape = typeof (c as any).shape === "string" ? (c as any).shape.toLowerCase() : "";

        // Circle → "Ø{dia}x{depth}"
        if ((shape === "circle" || shape === "round") && Number.isFinite(dia) && dia > 0 && Number.isFinite(D) && D > 0) {
          out.push(`Ø${dia}x${D}`);
          continue;
        }

        // Rect → "LxWxD"
        if (Number.isFinite(L) && L > 0 && Number.isFinite(W) && W > 0 && Number.isFinite(D) && D > 0) {
          out.push(`${L}x${W}x${D}`);
        }
      }
      if (out.length) break;
    }
  }

  // De-dupe
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const s of out) {
    const k = s.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(k);
  }

  return uniq;
}

async function callQuoteCalc(origin: string, payload: any) {
  const url = `${origin}/api/quotes/calc`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Server-to-server: no caching
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => "");
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok || !json || json.ok !== true) {
    const err = (json && (json.error || json.message)) || `HTTP_${res.status}`;
    throw new Error(`quotes_calc_failed:${err}`);
  }

  return json;
}

/**
 * Attach authoritative pricing from /api/quotes/calc.
 * IMPORTANT: This is intended for the PRIMARY item only.
 */
async function attachPricingToPrimaryItem(item: ItemRow, origin: string, facts: any): Promise<ItemRow> {
  const { L, W, H } = parseDimsNums(item);

  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return item;
  if (!Number.isFinite(Number(item.qty)) || item.qty <= 0) return item;
  if (!Number.isFinite(Number(item.material_id)) || item.material_id <= 0) return item;

  const cavities = extractCavityStringsFromFacts(facts);

  const payload = {
    length_in: L,
    width_in: W,
    height_in: H,
    material_id: item.material_id,
    qty: item.qty,
    cavities: cavities.length ? cavities : null,
    round_to_bf: false,
  };

  const calc = await callQuoteCalc(origin, payload);

  const result = calc?.result || {};
  const total = Number(result.total);
  const usedMin = !!result.used_min_charge;

  const unit = Number.isFinite(total) && item.qty > 0 ? total / item.qty : NaN;
  const unitRounded = Number.isFinite(unit) ? Math.round(unit * 100) / 100 : null;

  const totalRounded = Number.isFinite(total) ? Math.round(total * 100) / 100 : null;

  const pricing_meta = {
    min_charge: result.min_charge != null ? Number(result.min_charge) : null,
    used_min_charge: usedMin,
    setup_fee: result.setup_fee != null ? Number(result.setup_fee) : null,
    kerf_waste_pct: result.kerf_pct != null ? Number(result.kerf_pct) : null,
  };

  return {
    ...item,
    price_unit_usd: unitRounded,
    price_total_usd: totalRounded,
    pricing_meta,
    // Leave pricing_breakdown alone for now (UI falls back safely to price fields)
    pricing_breakdown: item.pricing_breakdown ?? null,
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

    // Load facts once (used for pricing cavities + returned to client)
    const facts = await loadFacts(quoteNo);

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

    // Use request origin so we call /api/quotes/calc on the same host
    const origin = req.nextUrl.origin;

    // Pricing policy (Path A):
    // - Price ONLY the primary item (index 0). All other foam rows are "included layers" for display.
    let items: ItemRow[] = [];
    for (let i = 0; i < itemsRaw.length; i++) {
      const it = itemsRaw[i];
      if (i === 0) {
        try {
          items.push(await attachPricingToPrimaryItem(it, origin, facts));
        } catch (err) {
          // If pricing fails, keep item unmodified (UI will show —)
          console.error("attachPricingToPrimaryItem error:", err);
          items.push(it);
        }
      } else {
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

    const foamSubtotal = items.reduce((s, i, idx) => {
      // Path A: subtotal should reflect primary item only
      if (idx !== 0) return s;
      return s + (Number(i.price_total_usd) || 0);
    }, 0);

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
