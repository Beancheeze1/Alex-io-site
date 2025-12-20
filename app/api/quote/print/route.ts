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

  // NEW (Path A): optional hydrated field for UI
  color?: string | null;
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

  // NEW: bring notes through so we can detect [LAYOUT-LAYER] rows
  notes?: string | null;

  // NEW (Path A): optional hydrated field for UI
  color?: string | null;

  // These are NOT read from DB; we attach them after calling calc.
  price_unit_usd?: number | null;
  price_total_usd?: number | null;

  // NEW: full pricing metadata from /api/quotes/calc (optional)
  pricing_meta?: {
    variant_used?: string | null;
    // direct carry-through of calc.result
    piece_ci?: number | null;
    order_ci?: number | null;
    order_ci_with_waste?: number | null;
    price_per_ci?: number | null;
    price_per_bf?: number | null;
    min_charge?: number | null;
    total?: number | null;
    used_min_charge?: boolean;
    kerf_pct?: number | null;
    is_skived?: boolean;
    skive_pct?: number | null;
    setup_fee?: number | null;
    cavities_ci?: number | null;
    piece_ci_raw?: number | null;
    material_name?: string | null;
  } | null;

  // NEW: high-level breakdown for UI (material + machine + markup + breaks).
  // This is optional and may be omitted if we can't safely compute it.
  pricing_breakdown?: any;
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

// Raw shape from DB for carton selections + boxes join
type PackagingSelectionRow = {
  id: number;
  quote_id: number;
  box_id: number;
  sku: string;
  qty: number;
  unit_price_usd: number | string | null;
  extended_price_usd: number | string | null;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: number | string | null;
  inside_width_in: number | string | null;
  inside_height_in: number | string | null;
};

// Normalized shape returned to the client
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
  const L = Number(item.length_in);
  const W = Number(item.width_in);
  const H = Number(item.height_in);
  return { L, W, H };
}

// -------------------------------
// NEW (Path A): layout thickness helpers
// -------------------------------

type LayoutLayerLike = {
  id?: string;
  label?: string;
  thicknessIn?: number;
  thickness_in?: number;
  thickness?: number;
  heightIn?: number;
  height_in?: number;
  height?: number;
  cavities?: any[];
};

function asPositiveNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickThicknessIn(layer: any): number | null {
  if (!layer) return null;
  return (
    asPositiveNumber(layer.thicknessIn) ??
    asPositiveNumber(layer.thickness_in) ??
    asPositiveNumber(layer.thickness) ??
    asPositiveNumber(layer.heightIn) ??
    asPositiveNumber(layer.height_in) ??
    asPositiveNumber(layer.height) ??
    null
  );
}

function pickCavityDepthIn(cav: any): number | null {
  if (!cav) return null;
  return (
    asPositiveNumber(cav.depthIn) ??
    asPositiveNumber(cav.depth_in) ??
    asPositiveNumber(cav.depth) ??
    asPositiveNumber(cav.heightIn) ??
    asPositiveNumber(cav.height_in) ??
    asPositiveNumber(cav.h) ??
    asPositiveNumber(cav.H) ??
    null
  );
}

function getLayersFromLayout(layoutJson: any): LayoutLayerLike[] {
  if (!layoutJson) return [];
  // Common shapes we’ve used/seen:
  // - layout.stack (array of layers)
  // - layout.layers (array of layers)
  // - legacy: no layers
  const stack = Array.isArray(layoutJson.stack) ? layoutJson.stack : null;
  const layers = Array.isArray(layoutJson.layers) ? layoutJson.layers : null;
  return (stack ?? layers ?? []) as LayoutLayerLike[];
}

function getActiveLayerId(layoutJson: any): string | null {
  if (!layoutJson) return null;
  const v = layoutJson.activeLayerId ?? layoutJson.active_layer_id ?? null;
  return typeof v === "string" && v.trim() ? v : null;
}

function computeLayoutThicknessMetrics(layoutJson: any) {
  const layers = getLayersFromLayout(layoutJson);
  const activeLayerId = getActiveLayerId(layoutJson);

  // Sum stack thickness
  let stackTotal = 0;
  let stackHasAny = false;

  const perLayerThickness: number[] = layers.map((ly) => {
    const t = pickThicknessIn(ly);
    if (t != null) {
      stackHasAny = true;
      stackTotal += t;
      return t;
    }
    return 0;
  });

  // Active layer cavity depth max (if we can find it)
  let activeCavityMaxDepth: number | null = null;

  const activeLayer =
    activeLayerId && layers.length > 0
      ? layers.find((l: any) => String(l?.id ?? "") === activeLayerId) ?? null
      : null;

  const activeCavities = Array.isArray(activeLayer?.cavities)
    ? (activeLayer as any).cavities
    : Array.isArray(layoutJson?.cavities)
      ? layoutJson.cavities
      : [];

  if (Array.isArray(activeCavities) && activeCavities.length > 0) {
    for (const cav of activeCavities) {
      const d = pickCavityDepthIn(cav);
      if (d != null) {
        if (activeCavityMaxDepth == null || d > activeCavityMaxDepth) activeCavityMaxDepth = d;
      }
    }
  }

  return {
    layer_count: layers.length,
    stack_total_thickness_in: stackHasAny ? stackTotal : null,
    per_layer_thickness_in: perLayerThickness,
    active_layer_id: activeLayerId,
    active_layer_cavity_max_depth_in: activeCavityMaxDepth,
  };
}

function isLayoutLayerItem(it: ItemRow) {
  const notes = String(it.notes ?? "");
  return notes.startsWith("[LAYOUT-LAYER]");
}

async function attachPricingToItem(item: ItemRow): Promise<ItemRow> {
  const { L, W, H } = parseDimsNums(item);

  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return item;
  if (!Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) return item;
  if (!Number.isFinite(Number(item.material_id)) || Number(item.material_id) <= 0) return item;

  const result = await computePricingBreakdown({
    length_in: L,
    width_in: W,
    height_in: H,
    density_lbft3: item.density_lb_ft3 ?? null,
    cost_per_lb: null,
    qty: item.qty,
  } as any);

  const unit = (result as any)?.unitPrice ?? null;
  const total = (result as any)?.extendedPrice ?? null;

  return {
    ...item,
    price_unit_usd: unit != null && Number.isFinite(Number(unit)) ? Number(unit) : item.price_unit_usd ?? null,
    price_total_usd: total != null && Number.isFinite(Number(total)) ? Number(total) : item.price_total_usd ?? null,
  };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const quoteNo = url.searchParams.get("quote_no") || "";

  if (!quoteNo) {
    return bad(
      {
        ok: false,
        error: "MISSING_QUOTE_NO",
        message: "No quote_no was provided in the query string.",
      },
      400,
    );
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
        created_at,
        color
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "NOT_FOUND",
          message: `No quote found with number ${quoteNo}.`,
        },
        404,
      );
    }

    // Load items (including layer rows if present)
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
        m.material_family as material_family,
        m.density_lb_ft3 as density_lb_ft3,
        qi.notes,
        qi.color
      from quote_items qi
      left join materials m on m.id = qi.material_id
      where qi.quote_id = $1
      order by qi.id asc
    `,
      [quote.id],
    );

    // Hydrate color fallback from quote
    const hydratedColor = quote.color ?? null;
    if (hydratedColor) {
      itemsRaw = itemsRaw.map((it) => ({ ...it, color: it.color ?? hydratedColor }));
    }

    // Attach pricing (best-effort) to each item row
    let items: ItemRow[] = [];
    for (const item of itemsRaw) {
      try {
        const withPricing = await attachPricingToItem(item);
        items.push(withPricing);
      } catch (err) {
        console.error("quote/print: attachPricingToItem failed:", err);
        items.push(item);
      }
    }

    // If items missing, try memory fallback to keep quote usable
    if (!items || items.length === 0) {
      const facts = await loadFacts(quoteNo);

      try {
        const dims = String(facts?.dims || "");
        const [Lraw, Wraw, Hraw] = dims.split("x");
        const L = Number(Lraw);
        const W = Number(Wraw);
        const H = Number(Hraw);
        const qtyFact = Number(facts?.qty ?? 0);

        if ([L, W, H, qtyFact].every((n) => Number.isFinite(n) && n > 0)) {
          const synthetic: ItemRow = {
            id: 0,
            quote_id: quote.id,
            length_in: L.toString(),
            width_in: W.toString(),
            height_in: H.toString(),
            qty: qtyFact,
            material_id: 0,
            material_name: facts?.material_name || null,
            material_family: facts?.material_family || null,
            density_lb_ft3: Number.isFinite(Number(facts?.material_density_lb_ft3))
              ? Number(facts.material_density_lb_ft3)
              : undefined,
            color: hydratedColor,
            notes: null,
            price_total_usd: null,
            price_unit_usd: null,
          };

          const withPricing = await attachPricingToItem(synthetic);
          items = [withPricing];
        }
      } catch (err) {
        console.error("quote/print: fallback from memory failed:", err);
      }
    }

    if (hydratedColor) {
      items = items.map((it) => ({ ...it, color: it.color ?? hydratedColor }));
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

    // ------------------------------------------------------------
    // PATH A FIX: Admin exports should honor rounded corners.
    // Regenerate SVG from layout_json (source of truth) so admin preview
    // matches the quote preview renderer (roundedRect + cornerRadiusIn).
    // DXF/STEP remain as stored for now.
    // ------------------------------------------------------------
    if (layoutPkg && layoutPkg.layout_json) {
      try {
        const bundle = buildLayoutExports(layoutPkg.layout_json as any);
        if (bundle?.svg && typeof bundle.svg === "string" && bundle.svg.length > 0) {
          layoutPkg = { ...layoutPkg, svg_text: bundle.svg };
        }
      } catch (err) {
        // Never break quote loading for older quotes or unexpected layout shapes.
        console.warn("quote/print: layout export regen failed (svg only):", err);
      }
    }

    const layoutMetrics =
      layoutPkg && layoutPkg.layout_json
        ? computeLayoutThicknessMetrics(layoutPkg.layout_json)
        : null;

    // ---------- packaging lines: quote_box_selections + boxes ----------
    const packagingSelectionsRaw = await q<any>(
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
        from public.quote_box_selections qbs
        join public.boxes b on b.id = qbs.box_id
        where qbs.quote_id = $1
        order by qbs.id asc
      `,
      [quote.id],
    );

    const packagingLines: PackagingLine[] = packagingSelectionsRaw.map((row: any) => {
      const qty = Number(row.qty) || 0;

      const unitRaw = row.unit_price_usd;
      const unit =
        unitRaw != null && unitRaw !== "" && Number.isFinite(Number(unitRaw))
          ? Number(unitRaw)
          : null;

      const extRaw = row.extended_price_usd;
      const ext =
        extRaw != null && extRaw !== "" && Number.isFinite(Number(extRaw))
          ? Number(extRaw)
          : null;

      const ilRaw = row.inside_length_in;
      const il =
        ilRaw != null && ilRaw !== "" && Number.isFinite(Number(ilRaw))
          ? Number(ilRaw)
          : null;

      const iwRaw = row.inside_width_in;
      const iw =
        iwRaw != null && iwRaw !== "" && Number.isFinite(Number(iwRaw))
          ? Number(iwRaw)
          : null;

      const ihRaw = row.inside_height_in;
      const ih =
        ihRaw != null && ihRaw !== "" && Number.isFinite(Number(ihRaw))
          ? Number(ihRaw)
          : null;

      return {
        id: row.id,
        quote_id: row.quote_id,
        box_id: row.box_id,
        sku: row.sku,
        qty,
        unit_price_usd: unit,
        extended_price_usd: ext,
        vendor: row.vendor ?? null,
        style: row.style ?? null,
        description: row.description ?? null,
        inside_length_in: il,
        inside_width_in: iw,
        inside_height_in: ih,
      };
    });

    // Subtotals
    const foamSubtotal = items.reduce((sum, it) => {
      const raw = (it as any).price_total_usd;
      const n = typeof raw === "number" ? raw : raw != null ? Number(raw) : 0;
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    const packagingSubtotal = packagingLines.reduce((sum, line) => {
      const n = line.extended_price_usd != null ? Number(line.extended_price_usd) : 0;
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    const grandSubtotal = foamSubtotal + packagingSubtotal;

    const facts = await loadFacts(quoteNo);

    return ok({
      ok: true,
      quote,
      items,
      layoutPkg,
      layoutMetrics,
      packagingLines,
      foamSubtotal,
      packagingSubtotal,
      grandSubtotal,
      facts,
    });
  } catch (err) {
    console.error("Error in /api/quote/print:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: "There was an unexpected problem loading this quote. Please try again.",
      },
      500,
    );
  }
}
