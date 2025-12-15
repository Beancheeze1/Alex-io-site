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

  const stack_total_thickness_in = stackHasAny ? stackTotal : null;

  // Choose cavity layer:
  // 1) Prefer active layer (by id) if it has any cavities
  // 2) Else first layer with cavities
  // 3) Else null
  let cavityLayerIndex: number | null = null;

  if (layers.length > 0) {
    if (activeLayerId) {
      const idx = layers.findIndex((ly) => String(ly?.id ?? "") === activeLayerId);
      if (idx >= 0) {
        const cavs = Array.isArray(layers[idx]?.cavities) ? layers[idx]!.cavities! : [];
        if (cavs.length > 0) cavityLayerIndex = idx;
      }
    }

    if (cavityLayerIndex == null) {
      const idx = layers.findIndex((ly) => Array.isArray(ly?.cavities) && (ly.cavities?.length ?? 0) > 0);
      if (idx >= 0) cavityLayerIndex = idx;
    }
  }

  const cavityLayer = cavityLayerIndex != null ? layers[cavityLayerIndex] : null;
  const cavity_layer_thickness_in =
    cavityLayerIndex != null ? pickThicknessIn(cavityLayer) ?? perLayerThickness[cavityLayerIndex] ?? null : null;

  // Max cavity depth in that layer
  let maxCavityDepth = 0;
  let hasDepth = false;

  if (cavityLayer && Array.isArray(cavityLayer.cavities)) {
    for (const cav of cavityLayer.cavities) {
      const d = pickCavityDepthIn(cav);
      if (d != null) {
        hasDepth = true;
        if (d > maxCavityDepth) maxCavityDepth = d;
      }
    }
  }

  const max_cavity_depth_in_layer_in = hasDepth ? maxCavityDepth : null;

  // Min thickness under cavities = layer thickness - deepest cavity (clamp at 0)
  let min_thickness_under_cavities_in: number | null = null;
  if (cavity_layer_thickness_in != null && max_cavity_depth_in_layer_in != null) {
    const raw = cavity_layer_thickness_in - max_cavity_depth_in_layer_in;
    min_thickness_under_cavities_in = raw >= 0 ? raw : 0;
  }

  return {
    stack_total_thickness_in,
    cavity_layer_index: cavityLayerIndex,
    cavity_layer_thickness_in,
    max_cavity_depth_in_layer_in,
    min_thickness_under_cavities_in,
  };
}

async function attachPricingToItem(item: ItemRow): Promise<ItemRow> {
  try {
    const { L, W, H } = parseDimsNums(item);
    const qty = Number(item.qty);
    const materialId = Number(item.material_id);

    if (![L, W, H, qty, materialId].every((n) => Number.isFinite(n) && n > 0)) {
      // Keep original item if we can't safely calc.
      return item;
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    const resp = await fetch(`${base}/api/quotes/calc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        length_in: L,
        width_in: W,
        height_in: H,
        material_id: materialId,
        qty,
        cavities: [], // IMPORTANT: we do not change cavity logic here (Path A)
        round_to_bf: false,
      }),
    });

    const json = (await resp.json().catch(() => null as any)) as any;
    if (!resp.ok || !json || !json.ok || !json.result) {
      // If calc fails for any reason, just return the bare item.
      return item;
    }

    const result = json.result || {};
    const rawTotal = Number(result.total ?? result.price_total ?? 0);
    const total = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 0;
    const piece = qty > 0 && Number.isFinite(total) ? total / qty : null;

    // NEW: compact pricing_meta blob we can use on the UI
    const pricing_meta: ItemRow["pricing_meta"] = {
      variant_used: json.variant_used ?? null,
      piece_ci: result.piece_ci ?? null,
      order_ci: result.order_ci ?? null,
      order_ci_with_waste: result.order_ci_with_waste ?? null,
      price_per_ci: result.price_per_ci ?? null,
      price_per_bf: result.price_per_bf ?? null,
      min_charge: result.min_charge ?? null,
      total: result.total ?? null,
      used_min_charge: !!result.used_min_charge,
      kerf_pct: result.kerf_pct ?? null,
      is_skived: !!result.is_skived,
      skive_pct: result.skive_pct ?? null,
      setup_fee: result.setup_fee ?? null,
      cavities_ci: result.cavities_ci ?? null,
      piece_ci_raw: result.piece_ci_raw ?? null,
      material_name: result.material_name ?? null,
    };

    // Optional pricing_breakdown is currently disabled because the old
    // cost_per_lb column was removed from the materials table. Once we
    // have a new, stable source for cost data (price books, etc.), this
    // can be re-enabled using those fields instead of cost_per_lb.
    let pricing_breakdown: any = undefined;

    return {
      ...item,
      price_total_usd: Number.isFinite(total) ? total : null,
      price_unit_usd: piece != null && Number.isFinite(piece) ? piece : null,
      pricing_meta,
      ...(pricing_breakdown ? { pricing_breakdown } : {}),
    };
  } catch (err) {
    console.error("attachPricingToItem error:", err);
    return item;
  }
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
          created_at
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

    // NEW (Path A): always hydrate facts for this quote_no so UI fields
    // like color can be shown even when DB items exist.
    let facts: any = null;
    try {
      facts = await loadFacts(quote.quote_no);
    } catch {
      facts = null;
    }

    const hydratedColor: string | null =
      facts?.color != null && String(facts.color).trim() !== ""
        ? String(facts.color).trim()
        : null;

    // Attach color to the quote object so the client has a stable place to read it.
    (quote as any).color = hydratedColor;

    const itemsRaw = await q<ItemRow>(
      `
        select
          qi.id,
          qi.quote_id,
          qi.length_in::text,
          qi.width_in::text,
          qi.height_in::text,
          qi.qty,
          qi.material_id,
          m.name as material_name,
          m.material_family,
          m.density_lb_ft3
        from quote_items qi
        left join materials m on m.id = qi.material_id
        where qi.quote_id = $1
        order by qi.id asc
      `,
      [quote.id],
    );

    let items: ItemRow[] = [];

    if (itemsRaw.length > 0) {
      // Normal path: we have stored items in the DB, attach pricing to each.
      items = await Promise.all(itemsRaw.map((it) => attachPricingToItem(it)));
    } else {
      // FALLBACK: no items stored yet. Pull facts from memory (same source as email)
      // and synthesize a primary line item so the print page still shows numbers.
      try {
        const dims = String(facts?.dims || "");
        const [Lraw, Wraw, Hraw] = dims.split("x");
        const L = Number(Lraw);
        const W = Number(Wraw);
        const H = Number(Hraw);
        const qtyFact = Number(facts?.qty ?? 0);
        const matId = Number(facts?.material_id ?? 0);

        if ([L, W, H, qtyFact, matId].every((n) => Number.isFinite(n) && n > 0)) {
          const synthetic: ItemRow = {
            id: 0,
            quote_id: quote.id,
            length_in: L.toString(),
            width_in: W.toString(),
            height_in: H.toString(),
            qty: qtyFact,
            material_id: matId,
            material_name: facts?.material_name || null,
            material_family: facts?.material_family || null,
            density_lb_ft3: Number.isFinite(Number(facts?.material_density_lb_ft3))
              ? Number(facts.material_density_lb_ft3)
              : undefined,
            color: hydratedColor,
            price_total_usd: null,
            price_unit_usd: null,
          };

          const withPricing = await attachPricingToItem(synthetic);
          items = [withPricing];
        } else {
          console.warn(
            "quote/print: no DB items and incomplete facts for quote_no",
            quote.quote_no,
            { dims, qtyFact, matId },
          );
        }
      } catch (err) {
        console.error("quote/print: fallback from memory failed:", err);
      }
    }

    // NEW (Path A): attach color onto each returned item so the UI can read it
    // regardless of whether it looks at quote-level or item-level fields.
    if (hydratedColor) {
      items = items.map((it) => ({ ...it, color: it.color ?? hydratedColor }));
    }

    const layoutPkg = await one<LayoutPkgRow>(
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

    // NEW (Path A): compute thickness metrics from layout stack (if present)
    const layoutMetrics =
      layoutPkg && layoutPkg.layout_json ? computeLayoutThicknessMetrics(layoutPkg.layout_json) : null;

    // ---------- treat layout block as source of truth for primary dims ----------

    // If we have a layout package with a block that has valid dims,
    // override the primary item (items[0]) L/W/H for display + pricing.
    //
    // IMPORTANT (Path A): If a multi-layer stack exists, thickness (H) must
    // come from the stack total (not a single-layer thickness).
    if (layoutPkg && layoutPkg.layout_json && items.length > 0) {
      try {
        const block = layoutPkg.layout_json.block || {};

        const rawLength = block.lengthIn ?? block.length ?? block.L ?? block.l;
        const rawWidth = block.widthIn ?? block.width ?? block.W ?? block.w;

        // Height/thickness selection:
        // - If stack_total_thickness_in exists, that is the source of truth.
        // - Otherwise, fall back to legacy block thickness fields (unchanged behavior).
        const stackH = layoutMetrics?.stack_total_thickness_in ?? null;

        const rawHeightLegacy =
          block.thicknessIn ??
          block.heightIn ??
          block.height ??
          block.H ??
          block.h ??
          block.T ??
          block.t;

        const L = Number(rawLength);
        const W = Number(rawWidth);
        const H = stackH != null ? Number(stackH) : Number(rawHeightLegacy);

        const allFinite = [L, W, H].every((n) => Number.isFinite(n) && n > 0);

        if (allFinite) {
          const primary = items[0];

          const overridden: ItemRow = {
            ...primary,
            length_in: L.toString(),
            width_in: W.toString(),
            height_in: H.toString(),
          };

          const pricedPrimary = await attachPricingToItem(overridden);
          items = [pricedPrimary, ...items.slice(1)];

          // keep color on the priced primary if we had it
          if (hydratedColor) {
            items = items.map((it) => ({ ...it, color: it.color ?? hydratedColor }));
          }
        }
      } catch (overrideErr) {
        console.error("quote/print: failed to override dims from layout block:", overrideErr);
      }
    }

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

      const extendedRaw = row.extended_price_usd;
      let extended: number | null = null;

      if (extendedRaw != null && extendedRaw !== "" && Number.isFinite(Number(extendedRaw))) {
        extended = Number(extendedRaw);
      } else if (unit != null && Number.isFinite(unit) && qty > 0) {
        extended = unit * qty;
      }

      const L =
        row.inside_length_in != null &&
        row.inside_length_in !== "" &&
        Number.isFinite(Number(row.inside_length_in))
          ? Number(row.inside_length_in)
          : null;

      const W =
        row.inside_width_in != null &&
        row.inside_width_in !== "" &&
        Number.isFinite(Number(row.inside_width_in))
          ? Number(row.inside_width_in)
          : null;

      const H =
        row.inside_height_in != null &&
        row.inside_height_in !== "" &&
        Number.isFinite(Number(row.inside_height_in))
          ? Number(row.inside_height_in)
          : null;

      return {
        id: row.id,
        quote_id: row.quote_id,
        box_id: row.box_id,
        sku: row.sku,
        qty,
        unit_price_usd: unit,
        extended_price_usd: extended,
        vendor: row.vendor,
        style: row.style,
        description: row.description,
        inside_length_in: L,
        inside_width_in: W,
        inside_height_in: H,
      };
    });

    // ---------- subtotals: foam + packaging ----------

    // Foam subtotal:
// IMPORTANT (Path A):
// - Only the PRIMARY item contributes to foamSubtotal.
// - [LAYOUT-LAYER] rows are display-only and must NOT be double-counted.
const foamSubtotal = items.reduce((sum, it) => {
  const notes = String((it as any).notes || "");
  if (notes.startsWith("[LAYOUT-LAYER]")) {
    return sum;
  }

  const raw = (it as any).price_total_usd;
  const n = typeof raw === "number" ? raw : raw != null ? Number(raw) : 0;
  return Number.isFinite(n) ? sum + n : sum;
}, 0);


    // Packaging subtotal: sum of carton extended prices.
    const packagingSubtotal = packagingLines.reduce((sum, line) => {
      const n = line.extended_price_usd != null ? Number(line.extended_price_usd) : 0;
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);

    const grandSubtotal = foamSubtotal + packagingSubtotal;

    return ok(
      {
        ok: true,
        quote,
        items,
        layoutPkg,
        // NEW (Path A): expose computed thickness metrics for the client Specs UI
        layoutMetrics,
        packagingLines,
        foamSubtotal,
        packagingSubtotal,
        grandSubtotal,
      },
      200,
    );
  } catch (err) {
    console.error("Error in /api/quote/print:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          "There was an unexpected problem loading this quote. Please try again.",
      },
      500,
    );
  }
}
