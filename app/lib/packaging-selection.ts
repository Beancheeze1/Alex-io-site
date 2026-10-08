// app/lib/packaging-selection.ts
//
// Single source of truth for computing a packaging-selection row's
// description and price — for both "stock" (a real catalog box) and
// "custom" (a customer/rep-typed size with no direct catalog row) kinds.
// Called at write time (selection created, grade changed, qty changed on
// Apply, print changed) instead of live on every render.
//
// Custom RSC (Corrugated Step 3A): priced by the corrugated engine
// (lib/corrugated.ts priceCustomRsc) from the shop's saved board grades and
// rates. If the engine can't price it (grade has no cost per MSF, no default
// grade, settings missing), it falls back to the nearest stock box's tier
// price and flags the row needs_review with a staff-only note.
// Custom mailers keep nearest-stock pricing (die-cut styles: Phase 2).
//
// Printing (Step 3B): quotes on the per-color model carry
// facts.print_spec = { colors, sides }. Engine-priced RSC includes print in its
// unit price; every other box (stock, mailer, fallback) gets a per-box print
// adder from the same rates. Plates are stored per row (plates_usd) and shown
// as one line. Quotes without print_spec keep the legacy art-setup fee + %.

import { q, one } from "@/lib/db";
import { resolveBoxUnitPrice, type BoxTierInputs } from "@/app/lib/box-tier-pricing";
import { loadCorrugated, priceCustomRsc, type CustomRscQuote } from "@/lib/corrugated";
import {
  describePrintSpec,
  parsePrintSpec,
  pricePrintAdder,
  type Coverage,
  type PrintAdderResult,
  type PrintSpec,
} from "@/lib/corrugated-price";
import { loadFacts } from "@/app/lib/memory";

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

export type PrintFields = {
  print_colors: Coverage[] | null; // null = quote not on the per-color model
  print_sides: 1 | 2 | null;
  print_usd: number | null; // adder total for stock / nearest-stock boxes
  plates_usd: number | null; // one-time plates (marked up)
};

export type CustomResolvedSelection = ResolvedSelection &
  PrintFields & {
    board_grade_id: number | null;
    board_grade_name: string | null;
    pricing_source: PricingSource;
    needs_review: boolean;
    pricing_note: string | null;
    pricing_detail: Record<string, unknown> | null;
  };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

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

/** The quote's per-color print spec from its facts, or null (legacy model). */
export async function printSpecForQuote(quoteNo: string): Promise<PrintSpec | null> {
  try {
    const f = (await loadFacts(quoteNo)) || {};
    return parsePrintSpec((f as any).print_spec);
  } catch {
    return null;
  }
}

/** Print adder for a non-engine box, from the tenant's corrugated rates. */
async function printAdderFor(
  tenantId: number | null,
  qty: number,
  print: PrintSpec | null,
): Promise<PrintAdderResult | null> {
  if (!print || print.colors.length === 0 || !tenantId) return null;
  try {
    const cfg = await loadCorrugated(tenantId);
    return pricePrintAdder(qty, print, cfg.settings);
  } catch (e) {
    console.error("[packaging-selection] print adder failed", e);
    return null;
  }
}

/** Adds a print adder to a base unit price (null stays null). */
function withAdder(
  baseUnit: number | null,
  baseExtended: number | null,
  qty: number,
  adder: PrintAdderResult | null,
): { unit: number | null; extended: number | null } {
  if (baseUnit == null || !adder) return { unit: baseUnit, extended: baseExtended };
  const unit = r4(baseUnit + adder.unit_adder_usd);
  return { unit, extended: r2(unit * qty) };
}

function printFields(print: PrintSpec | null, adder: PrintAdderResult | null, plates: number | null): PrintFields {
  const printed = !!print && print.colors.length > 0;
  return {
    print_colors: print ? print.colors : null,
    print_sides: print ? print.sides : null,
    print_usd: adder ? adder.print_total_usd : null,
    plates_usd: printed ? plates : null,
  };
}

/**
 * Resolve description + price for a real stock catalog box selection
 * (catalog tier price; no printing — see repriceQuoteBoxes for print).
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
 * RSC: corrugated engine with the given grade (or the shop's default) and
 * print, with nearest-stock fallback + needs_review. Mailer: nearest stock.
 * Non-engine prices get the per-color print adder when print is given.
 */
export async function resolveCustomSelection(
  customLengthIn: number,
  customWidthIn: number,
  customHeightIn: number,
  customStyle: string,
  qty: number,
  tenantId: number | null = null,
  opts: { gradeId?: number | null; print?: PrintSpec | null } = {},
): Promise<CustomResolvedSelection> {
  const L = customLengthIn;
  const W = customWidthIn;
  const H = customHeightIn;
  const qtyForPrice = Math.max(1, Math.round(qty || 1));
  const baseDesc = `Custom box ${L} x ${W} x ${H} in`;
  const style = String(customStyle || "").toLowerCase();
  const print = opts.print ?? null;
  const printed = !!print && print.colors.length > 0;
  const printDesc = printed ? ` · ${describePrintSpec(print)}` : "";

  if (style !== "rsc" || !tenantId) {
    const p = await nearestStockPrice(L, W, H, qtyForPrice, tenantId);
    const adder = printed ? await printAdderFor(tenantId, qtyForPrice, print) : null;
    const priced = withAdder(p.unit, p.extended, qtyForPrice, adder);
    return {
      description: `${baseDesc} (${customStyle})${printDesc}`,
      unit_price_usd: priced.unit,
      extended_price_usd: priced.extended,
      ...printFields(print, adder, adder ? adder.plates_line_usd : null),
      board_grade_id: null,
      board_grade_name: null,
      pricing_source: p.unit != null ? "nearest_stock" : "none",
      needs_review: false,
      pricing_note: adder && adder.warnings.length ? `Check corrugated print rates: ${adder.warnings.join(" ")}` : null,
      pricing_detail: null,
    };
  }

  const reqBase = {
    dims: { L, W, D: H },
    quantities: [qtyForPrice],
    colors: print ? print.colors : [],
    sides: (print ? print.sides : 1) as 1 | 2,
  };
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
  const description = (gradeName ? `${baseDesc} (rsc, ${gradeName})` : `${baseDesc} (rsc)`) + printDesc;

  if (engine && engine.ok) {
    const qp = engine.quantities[0];
    return {
      description,
      unit_price_usd: qp.unit_price_usd,
      extended_price_usd: qp.extended_usd,
      ...printFields(print, null, engine.plates_line_usd),
      board_grade_id: gradeId,
      board_grade_name: gradeName,
      pricing_source: "corrugated_engine",
      needs_review: false,
      pricing_note: engine.warnings.length ? `Check corrugated rates: ${engine.warnings.join(" ")}` : null,
      pricing_detail: { blank: engine.blank, quantity: qp, warnings: engine.warnings, print },
    };
  }

  // Fallback (approved): nearest stock price (+ print adder), flagged for review.
  const p = await nearestStockPrice(L, W, H, qtyForPrice, tenantId);
  const adder = printed ? await printAdderFor(tenantId, qtyForPrice, print) : null;
  const priced = withAdder(p.unit, p.extended, qtyForPrice, adder);
  const reason = engine && !engine.ok ? engine.message : engineError ?? "Corrugated pricing is unavailable.";
  return {
    description,
    unit_price_usd: priced.unit,
    extended_price_usd: priced.extended,
    ...printFields(print, adder, adder ? adder.plates_line_usd : null),
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
  board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note,
  print_colors, print_sides, plates_usd`;

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
         board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note, pricing_detail,
         print_colors, print_sides, print_usd, plates_usd)
      VALUES
        ($1, $2, 'custom', NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
         $17::jsonb, $18, $19, $20)
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      args.quoteId, args.quoteNo, args.L, args.W, args.H, args.style,
      r.description, args.qty, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
      r.print_colors === null ? null : JSON.stringify(r.print_colors),
      r.print_sides, r.print_usd, r.plates_usd,
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
             pricing_detail = $10::jsonb,
             print_colors = $11::jsonb,
             print_sides = $12,
             print_usd = $13,
             plates_usd = $14
       WHERE id = $1
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      id, r.description, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
      r.print_colors === null ? null : JSON.stringify(r.print_colors),
      r.print_sides, r.print_usd, r.plates_usd,
    ],
  };
}

/**
 * Reprice every box on a quote at its current qty with the quote's print
 * spec (Step 3B): stock rows = catalog tier price + print adder; custom rows
 * = resolveCustomSelection (engine / nearest stock) with their grade + print.
 * Call with the quote's print spec; null leaves printing out (legacy quotes).
 */
export async function repriceQuoteBoxes(
  quoteId: number,
  tenantId: number | null,
  print: PrintSpec | null,
): Promise<void> {
  const rows = await q<{
    id: number;
    kind: string;
    qty: number | string;
    custom_length_in: string | number | null;
    custom_width_in: string | number | null;
    custom_height_in: string | number | null;
    custom_style: string | null;
    board_grade_id: string | number | null;
    b_id: number | null;
    sku: string | null;
    vendor: string | null;
    style: string | null;
    b_description: string | null;
    inside_length_in: number | null;
    inside_width_in: number | null;
    inside_height_in: number | null;
  }>(
    `SELECT qbs.id, qbs.kind, qbs.qty,
            qbs.custom_length_in, qbs.custom_width_in, qbs.custom_height_in, qbs.custom_style,
            qbs.board_grade_id,
            b.id AS b_id, b.sku, b.vendor, b.style, b.description AS b_description,
            b.inside_length_in, b.inside_width_in, b.inside_height_in
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
      WHERE qbs.quote_id = $1`,
    [quoteId],
  );

  for (const row of rows) {
    const qty = Math.max(1, Math.round(Number(row.qty) || 1));

    if (row.kind === "custom") {
      const resolved = await resolveCustomSelection(
        Number(row.custom_length_in),
        Number(row.custom_width_in),
        Number(row.custom_height_in),
        String(row.custom_style || ""),
        qty,
        tenantId,
        { gradeId: row.board_grade_id == null ? null : Number(row.board_grade_id), print },
      );
      const upd = customSelectionUpdate(row.id, resolved);
      await q(upd.text, upd.values);
      continue;
    }

    if (row.b_id == null) continue;
    const base = await resolveStockSelection(
      {
        id: row.b_id,
        sku: String(row.sku || ""),
        vendor: row.vendor,
        style: row.style,
        description: row.b_description,
        inside_length_in: Number(row.inside_length_in),
        inside_width_in: Number(row.inside_width_in),
        inside_height_in: Number(row.inside_height_in),
      },
      qty,
    );
    const adder = await printAdderFor(tenantId, qty, print);
    const priced = withAdder(base.unit_price_usd, base.extended_price_usd, qty, adder);
    const pf = printFields(print, adder, adder ? adder.plates_line_usd : null);
    // Step 4B: stock rows say how they're printed, like custom rows do.
    const stockDescription =
      print && print.colors.length > 0
        ? `${base.description} · ${describePrintSpec(print)}`
        : base.description;
    await q(
      `UPDATE public.quote_box_selections
          SET unit_price_usd = $2,
              extended_price_usd = $3,
              print_colors = $4::jsonb,
              print_sides = $5,
              print_usd = $6,
              plates_usd = $7,
              pricing_note = $8,
              description = $9
        WHERE id = $1`,
      [
        row.id,
        priced.unit,
        priced.extended,
        pf.print_colors === null ? null : JSON.stringify(pf.print_colors),
        pf.print_sides,
        pf.print_usd,
        pf.plates_usd,
        adder && adder.warnings.length ? `Check corrugated print rates: ${adder.warnings.join(" ")}` : null,
        stockDescription,
      ],
    );
  }
}
