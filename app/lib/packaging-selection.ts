// app/lib/packaging-selection.ts
//
// Single source of truth for computing a packaging-selection row's
// description and price — for both "stock" (a real catalog box) and
// "custom" (a customer/rep-typed size with no direct catalog row) kinds.
// Called once, at write time (when the selection is created), instead of
// being recomputed live every time a quote is rendered.

import { q, one } from "@/lib/db";
import { resolveBoxUnitPrice, type BoxTierInputs } from "@/app/lib/box-tier-pricing";

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
 * Resolve description + price for a customer/rep-typed custom box size.
 * There's no catalog row to price directly, so we find the closest stock
 * box that actually fits the custom inside dims (in either orientation)
 * and freeze ITS tier price at write time — the same "pricing uses the
 * closest matching standard carton" behavior that used to be recomputed
 * live on every render (see findAndPriceClosestBox in
 * app/api/quote/print/route.ts, which this replaces).
 */
export async function resolveCustomSelection(
  customLengthIn: number,
  customWidthIn: number,
  customHeightIn: number,
  customStyle: string,
  qty: number,
): Promise<ResolvedSelection> {
  const description = `Custom box ${customLengthIn} x ${customWidthIn} x ${customHeightIn} in (${customStyle})`;

  const candidates = await q<StockBoxRow>(
    `
    SELECT id, sku, vendor, style, description, inside_length_in, inside_width_in, inside_height_in
    FROM public.boxes
    WHERE (
      (inside_length_in >= $1 AND inside_width_in >= $2 AND inside_height_in >= $3)
      OR
      (inside_length_in >= $2 AND inside_width_in >= $1 AND inside_height_in >= $3)
    )
    ORDER BY inside_length_in * inside_width_in * inside_height_in ASC
    LIMIT 1
    `,
    [customLengthIn, customWidthIn, customHeightIn],
  );

  const best = candidates?.[0] ?? null;
  if (!best) {
    return { description, unit_price_usd: null, extended_price_usd: null };
  }

  const tier = await fetchTier(best.id);
  const { unit, extended } = priceForQty(tier, qty);

  return { description, unit_price_usd: unit, extended_price_usd: extended };
}
