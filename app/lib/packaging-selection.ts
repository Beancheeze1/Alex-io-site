// app/lib/packaging-selection.ts
//
// Single source of truth for computing a packaging-selection row's
// description and price — for both "stock" (a real catalog box) and
// "custom" (a customer/rep-typed size with no direct catalog row) kinds.
// Called at write time (when the selection is created, its grade changes,
// or the order qty changes on Apply) instead of live on every render.
//
// Custom RSC (Corrugated Step 3A): priced by the corrugated engine
// (lib/corrugated.ts priceCustomRsc) from the shop's saved board grades and
// rates. If the engine can't price it (grade has no cost per MSF, no default
// grade, settings missing), it falls back to the nearest stock box's tier
// price and flags the row needs_review with a staff-only note.
// Custom mailers keep nearest-stock pricing (die-cut styles: Phase 2).
// Printing is NOT included here yet (Step 3B).

import { q, one } from "@/lib/db";
import { resolveBoxUnitPrice, type BoxTierInputs } from "@/app/lib/box-tier-pricing";
import { priceCustomRsc, type CustomRscQuote } from "@/lib/corrugated";

export type StockBoxRow = {
  id: number;
  sku: string;
  vendor: string | null;
  style: string | null;
  description: string | null;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
};

export type ResolvedSelection = {
  description: string;
  unit_price_usd: number | null;
  extended_price_usd: number | null;
};

export type PricingSource = "corrugated_engine" | "nearest_stock" | "none";

export type CustomResolvedSelection = ResolvedSelection & {
  board_grade_id: number | null;
  board_grade_name: string | null;
  pricing_source: PricingSource;
  needs_review: boolean;
  pricing_note: string | null;
  pricing_detail: Record<string, unknown> | null;
};

function roundToCents(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

async function fetchTier(boxId: number): Promise<BoxTierInputs | null> {
  return one<BoxTierInputs>(
    `
    SELECT
      base_unit_price,
      tier1_min_qty, tier1_unit_price,
      tier2_min_qty, tier2_unit_price,
      tier3_min_qty, tier3_unit_price,
      tier4_min_qty, tier4_unit_price
    FROM public.box_price_tiers
    WHERE box_id = $1
    `,
    [boxId],
  );
}

function priceForQty(tier: BoxTierInputs | null, qty: number): { unit: number | null; extended: number | null } {
  const qtyForPrice = Math.max(1, qty || 1);
  const unit = resolveBoxUnitPrice(tier, qtyForPrice);
  const extended = unit != null ? roundToCents(unit * qtyForPrice) : null;
  return { unit, extended };
}

/**
 * Resolve description + price for a real stock catalog box selection.
 */
export async function resolveStockSelection(
  box: StockBoxRow,
  qty: number,
): Promise<ResolvedSelection> {
  const tier = await fetchTier(box.id);
  const { unit, extended } = priceForQty(tier, qty);

  const description =
    box.description && box.description.trim().length > 0
      ? box.description.trim()
      : box.style
        ? `${box.style} ${box.sku}`
        : box.sku;

  return { description, unit_price_usd: unit, extended_price_usd: extended };
}

/**
 * The closest stock box that fits the custom inside dims (either
 * orientation), priced from its tiers. Scoped to the shared catalog plus
 * this tenant's own sizes, so a price is never borrowed from another
 * tenant's private catalog entry.
 */
async function nearestStockPrice(
  L: number,
  W: number,
  H: number,
  qty: number,
  tenantId: number | null,
): Promise<{ unit: number | null; extended: number | null }> {
  const candidates = await q<StockBoxRow>(
    `
    SELECT id, sku, vendor, style, description, inside_length_in, inside_width_in, inside_height_in
    FROM public.boxes
    WHERE (
      (inside_length_in >= $1 AND inside_width_in >= $2 AND inside_height_in >= $3)
      OR
      (inside_length_in >= $2 AND inside_width_in >= $1 AND inside_height_in >= $3)
    )
    AND (tenant_id IS NULL OR tenant_id = $4)
    ORDER BY inside_length_in * inside_width_in * inside_height_in ASC
    LIMIT 1
    `,
    [L, W, H, tenantId],
  );
  const best = candidates?.[0] ?? null;
  if (!best) return { unit: null, extended: null };
  const tier = await fetchTier(best.id);
  return priceForQty(tier, qty);
}

/**
 * Resolve description + price for a customer/rep-typed custom box size.
 * RSC: corrugated engine with the given grade (or the shop's default), with
 * nearest-stock fallback + needs_review. Mailer: nearest stock.
 */
export async function resolveCustomSelection(
  customLengthIn: number,
  customWidthIn: number,
  customHeightIn: number,
  customStyle: string,
  qty: number,
  tenantId: number | null = null,
  opts: { gradeId?: number | null } = {},
): Promise<CustomResolvedSelection> {
  const L = customLengthIn;
  const W = customWidthIn;
  const H = customHeightIn;
  const qtyForPrice = Math.max(1, Math.round(qty || 1));
  const baseDesc = `Custom box ${L} x ${W} x ${H} in`;
  const style = String(customStyle || "").toLowerCase();

  if (style !== "rsc" || !tenantId) {
    const p = await nearestStockPrice(L, W, H, qtyForPrice, tenantId);
    return {
      description: `${baseDesc} (${customStyle})`,
      unit_price_usd: p.unit,
      extended_price_usd: p.extended,
      board_grade_id: null,
      board_grade_name: null,
      pricing_source: p.unit != null ? "nearest_stock" : "none",
      needs_review: false,
      pricing_note: null,
      pricing_detail: null,
    };
  }

  const reqBase = { dims: { L, W, D: H }, quantities: [qtyForPrice], colors: [], sides: 1 as const };
  let engine: CustomRscQuote | null = null;
  let engineError: string | null = null;
  try {
    engine = await priceCustomRsc(tenantId, { ...reqBase, grade_id: opts.gradeId ?? null });
    // A grade that was deactivated since it was picked: use the shop default.
    if (!engine.ok && engine.error === "grade_not_found" && opts.gradeId != null) {
      engine = await priceCustomRsc(tenantId, { ...reqBase, grade_id: null });
    }
  } catch (e) {
    console.error("[packaging-selection] corrugated pricing failed", e);
    engineError = "Corrugated pricing is unavailable.";
  }

  const gradeId = engine?.grade?.id ?? null;
  const gradeName = engine?.grade?.name ?? null;
  const description = gradeName ? `${baseDesc} (rsc, ${gradeName})` : `${baseDesc} (rsc)`;

  if (engine && engine.ok) {
    const qp = engine.quantities[0];
    return {
      description,
      unit_price_usd: qp.unit_price_usd,
      extended_price_usd: qp.extended_usd,
      board_grade_id: gradeId,
      board_grade_name: gradeName,
      pricing_source: "corrugated_engine",
      needs_review: false,
      pricing_note: engine.warnings.length ? `Check corrugated rates: ${engine.warnings.join(" ")}` : null,
      pricing_detail: { blank: engine.blank, quantity: qp, warnings: engine.warnings },
    };
  }

  // Fallback (approved): nearest stock price, flagged for staff review.
  const p = await nearestStockPrice(L, W, H, qtyForPrice, tenantId);
  const reason = engine && !engine.ok ? engine.message : engineError ?? "Corrugated pricing is unavailable.";
  return {
    description,
    unit_price_usd: p.unit,
    extended_price_usd: p.extended,
    board_grade_id: gradeId,
    board_grade_name: gradeName,
    pricing_source: p.unit != null ? "nearest_stock" : "none",
    needs_review: true,
    pricing_note: (p.unit != null ? "Priced from the nearest stock box. " : "No price yet. ") + reason,
    pricing_detail: engine && !engine.ok ? { error: engine.error } : null,
  };
}

/** Columns returned after writing a custom selection. */
export const CUSTOM_SELECTION_RETURNING = `
  id, quote_id, quote_no, kind, box_id, sku,
  custom_length_in, custom_width_in, custom_height_in, custom_style,
  description, qty, created_at, unit_price_usd, extended_price_usd,
  board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note`;

/** INSERT for a kind='custom' selection row from a resolved price. */
export function customSelectionInsert(args: {
  quoteId: number;
  quoteNo: string;
  L: number;
  W: number;
  H: number;
  style: string;
  qty: number;
  resolved: CustomResolvedSelection;
}): { text: string; values: unknown[] } {
  const r = args.resolved;
  return {
    text: `
      INSERT INTO public.quote_box_selections
        (quote_id, quote_no, kind, box_id, sku,
         custom_length_in, custom_width_in, custom_height_in, custom_style,
         description, qty, unit_price_usd, extended_price_usd,
         board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note, pricing_detail)
      VALUES
        ($1, $2, 'custom', NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      args.quoteId, args.quoteNo, args.L, args.W, args.H, args.style,
      r.description, args.qty, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
    ],
  };
}

/** UPDATE an existing custom selection row with a freshly resolved price. */
export function customSelectionUpdate(
  id: number,
  r: CustomResolvedSelection,
): { text: string; values: unknown[] } {
  return {
    text: `
      UPDATE public.quote_box_selections
         SET description = $2,
             unit_price_usd = $3,
             extended_price_usd = $4,
             board_grade_id = $5,
             board_grade_name = $6,
             pricing_source = $7,
             needs_review = $8,
             pricing_note = $9,
             pricing_detail = $10::jsonb
       WHERE id = $1
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      id, r.description, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
    ],
  };
}
