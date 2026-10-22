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
// Step 27: every style in lib/box-styles.ts (HSC, FOL, die-cut mailer and
// tray, pads, partition sets) is priced by the same engine; die-cut styles
// also get a one-time cutting die (tooling_usd, its own line like plates).
// If the engine can't price it, RSC / HSC / FOL / mailer fall back to the
// nearest stock box (needs_review); trays, pads and partitions get no price
// (needs_review). An unknown style keeps the old nearest-stock price.
//
// Printing (Step 3B): quotes on the per-color model carry
// facts.print_spec = { colors, sides }. Engine-priced RSC includes print in its
// unit price; every other box (stock, mailer, fallback) gets a per-box print
// adder from the same rates. Plates are stored per row (plates_usd) and shown
// as one line. Quotes without print_spec keep the legacy art-setup fee + %.
//
// Short runs (Step 15): facts.run_method = "plates" | "digital" is a staff
// choice for the whole quote; missing = auto (under the shop's short-run
// cutoff = digital print + CAD cut, no plates). The method used is saved in
// pricing_detail.run_method on each row.

import { boxShapeIssue } from "@/lib/box-shape"; // Step 39B
import { q, one } from "@/lib/db";
import { resolveBoxUnitPrice, type BoxTierInputs } from "@/app/lib/box-tier-pricing";
import {
  loadCorrugated,
  priceCustomRsc,
  type CorrugatedConfig,
  type CustomRscQuote,
} from "@/lib/corrugated";
import { computeRscBlank } from "@/lib/corrugated-blank";
import {
  describePrintSpec,
  parsePrintSpec,
  parseRunMethod,
  pricePrintAdder,
  type Coverage,
  type PrintAdderResult,
  type PrintSpec,
  type RunMethod,
} from "@/lib/corrugated-price";
import { loadFacts } from "@/app/lib/memory";
import { customBoxBaseDesc, parseBoxStyle, type PartitionCells } from "@/lib/box-styles";

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
    tooling_usd: number | null; // Step 27: one-time cutting die (die-cut styles on the press)
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

/** Step 15: the staff run-method choice for the whole quote, or null (auto). */
export async function quoteRunMethod(quoteNo: string): Promise<RunMethod | null> {
  try {
    const f = ((await loadFacts(quoteNo)) || {}) as Record<string, unknown>;
    return parseRunMethod(f.run_method);
  } catch {
    return null;
  }
}

/** Run-method choice for a quote by id (repricing works from the quote id). */
async function runMethodForQuoteId(quoteId: number): Promise<RunMethod | null> {
  const row = await one<{ quote_no: string | null }>(`SELECT quote_no FROM public.quotes WHERE id = $1`, [quoteId]);
  return row?.quote_no ? quoteRunMethod(String(row.quote_no)) : null;
}

/** RSC blank area (sq ft, no waste) for a box, on the shop's default grade's flute. */
function blankSqftEach(cfg: CorrugatedConfig, L: number, W: number, H: number): number | null {
  if (![L, W, H].every((n) => Number.isFinite(n) && n > 0)) return null;
  const grade = cfg.grades.find((g) => g.active && g.is_default) ?? cfg.grades.find((g) => g.active);
  const flute = cfg.flutes.find((f) => f.flute === grade?.flute) ?? cfg.flutes[0];
  if (!flute) return null;
  const s = cfg.settings;
  return computeRscBlank({ L, W, D: H }, flute, {
    joint_type: s.joint_type,
    flap_pct: s.flap_pct,
    round_to_in: s.round_to_in,
    edge_trim_in: s.edge_trim_in,
    waste_pct: s.waste_pct,
  }).sqft_each;
}

/**
 * Print adder for a non-engine box, from the tenant's corrugated rates.
 * Step 15: method = the quote's run-method choice (null = auto); dims = the
 * box's inside size, for the digital print area.
 */
async function printAdderFor(
  tenantId: number | null,
  qty: number,
  print: PrintSpec | null,
  method: RunMethod | null = null,
  dims: { L: number; W: number; H: number } | null = null,
): Promise<PrintAdderResult | null> {
  if (!print || print.colors.length === 0 || !tenantId) return null;
  try {
    const cfg = await loadCorrugated(tenantId);
    const sqftEach = dims ? blankSqftEach(cfg, dims.L, dims.W, dims.H) : null;
    return pricePrintAdder(qty, print, cfg.settings, { method, sqftEach });
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

/**
 * Step 9A: a box row's own print spec, from its print_colors / print_sides
 * columns (per-size printing on multi-size boxes-only quotes).
 */
export function rowPrintSpec(colors: unknown, sides: unknown): PrintSpec | null {
  let list: unknown = colors;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = null;
    }
  }
  return parsePrintSpec({ colors: Array.isArray(list) ? list : [], sides: Number(sides) === 2 ? 2 : 1 });
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
  opts: {
    gradeId?: number | null;
    print?: PrintSpec | null;
    method?: RunMethod | null;
    cells?: PartitionCells | null; // Step 27: partition sets
  } = {},
): Promise<CustomResolvedSelection> {
  const L = customLengthIn;
  const W = customWidthIn;
  const H = customHeightIn;
  const qtyForPrice = Math.max(1, Math.round(qty || 1));
  // Step 27: any known style is engine-priced.
  const style = parseBoxStyle(customStyle);
  const cells = style === "partition" ? opts.cells ?? null : null;
  const baseDesc = customBoxBaseDesc(style, L, W, H, cells);
  const print = opts.print ?? null;
  const printed = !!print && print.colors.length > 0;
  const method = opts.method ?? null; // Step 15: null = auto by quantity
  const printDesc = (m: RunMethod | null | undefined) => (printed ? ` · ${describePrintSpec(print, m)}` : "");

  if (!style || !tenantId) {
    const p = await nearestStockPrice(L, W, H, qtyForPrice, tenantId);
    const adder = printed ? await printAdderFor(tenantId, qtyForPrice, print, method, { L, W, H }) : null;
    const priced = withAdder(p.unit, p.extended, qtyForPrice, adder);
    return {
      description: `${baseDesc} (${customStyle})${printDesc(adder?.method)}`,
      unit_price_usd: priced.unit,
      extended_price_usd: priced.extended,
      ...printFields(print, adder, adder ? adder.plates_line_usd : null),
      board_grade_id: null,
      board_grade_name: null,
      pricing_source: p.unit != null ? "nearest_stock" : "none",
      needs_review: false,
      pricing_note: adder && adder.warnings.length ? `Check corrugated print rates: ${adder.warnings.join(" ")}` : null,
      pricing_detail: adder ? { run_method: adder.method } : null,
      tooling_usd: null,
    };
  }

  const reqBase = {
    dims: { L, W, D: H },
    quantities: [qtyForPrice],
    colors: print ? print.colors : [],
    sides: (print ? print.sides : 1) as 1 | 2,
    method,
    style,
    cells,
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
  const rscDesc = gradeName ? `${baseDesc} (${style}, ${gradeName})` : `${baseDesc} (${style})`;

  if (engine && engine.ok) {
    const qp = engine.quantities[0];
    // Step 39B: an odd shape (mailer / tray deeper than wide) or a blank bigger
    // than the shop's largest sheet is priced, but flagged for staff to check.
    const shape = boxShapeIssue(style, { L, W, D: H });
    const oversize = engine.warnings.some((w) => /largest sheet/i.test(w));
    const notes = [
      ...(shape ? [`Check the size: ${shape.message}`] : []),
      ...(engine.warnings.length ? [`Check corrugated rates: ${engine.warnings.join(" ")}`] : []),
    ];
    return {
      description: rscDesc + printDesc(qp.method) + (qp.method === "digital" ? " · Short run (CAD cut)" : ""),
      unit_price_usd: qp.unit_price_usd,
      extended_price_usd: qp.extended_usd,
      ...printFields(print, null, qp.plates_line_usd),
      board_grade_id: gradeId,
      board_grade_name: gradeName,
      pricing_source: "corrugated_engine",
      needs_review: !!shape || oversize,
      pricing_note: notes.length ? notes.join(" ") : null,
      pricing_detail: {
        blank: engine.blank,
        quantity: qp,
        warnings: engine.warnings,
        print,
        run_method: qp.method,
        // Step 26: board bought as sheets (null on blank pricing)
        board_method: engine.board_method,
        sheet: engine.sheet,
        // Step 27
        style,
        ...(cells ? { cells } : {}),
        ...(engine.blank.rule_in > 0 ? { die_rule_in: engine.blank.rule_in, die_line_usd: qp.die_line_usd } : {}),
      },
      tooling_usd: qp.die_line_usd > 0 ? qp.die_line_usd : null,
    };
  }

  // Fallback (approved): nearest stock price (+ print adder), flagged for review.
  // Step 27: only for boxes a stock box can stand in for.
  const stockStandIn = style === "rsc" || style === "hsc" || style === "fol" || style === "mailer";
  const p = stockStandIn
    ? await nearestStockPrice(L, W, H, qtyForPrice, tenantId)
    : { unit: null as number | null, extended: null as number | null };
  const adder = printed && stockStandIn ? await printAdderFor(tenantId, qtyForPrice, print, method, { L, W, H }) : null;
  const priced = withAdder(p.unit, p.extended, qtyForPrice, adder);
  const reason = engine && !engine.ok ? engine.message : engineError ?? "Corrugated pricing is unavailable.";
  return {
    description: rscDesc + printDesc(adder?.method),
    unit_price_usd: priced.unit,
    extended_price_usd: priced.extended,
    ...printFields(print, adder, adder ? adder.plates_line_usd : null),
    board_grade_id: gradeId,
    board_grade_name: gradeName,
    pricing_source: p.unit != null ? "nearest_stock" : "none",
    needs_review: true,
    pricing_note: (p.unit != null ? "Priced from the nearest stock box. " : "No price yet. ") + reason,
    pricing_detail:
      engine && !engine.ok
        ? { error: engine.error, ...(adder ? { run_method: adder.method } : {}) }
        : adder
          ? { run_method: adder.method }
          : null,
    tooling_usd: null,
  };
}

/** Columns returned after writing a custom selection. */
export const CUSTOM_SELECTION_RETURNING = `
  id, quote_id, quote_no, kind, box_id, sku,
  custom_length_in, custom_width_in, custom_height_in, custom_style,
  description, qty, created_at, unit_price_usd, extended_price_usd,
  board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note,
  print_colors, print_sides, plates_usd,
  tooling_usd, custom_cells_across, custom_cells_down`;

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
  cells?: PartitionCells | null; // Step 27: partition sets
}): { text: string; values: unknown[] } {
  const r = args.resolved;
  return {
    text: `
      INSERT INTO public.quote_box_selections
        (quote_id, quote_no, kind, box_id, sku,
         custom_length_in, custom_width_in, custom_height_in, custom_style,
         description, qty, unit_price_usd, extended_price_usd,
         board_grade_id, board_grade_name, pricing_source, needs_review, pricing_note, pricing_detail,
         print_colors, print_sides, print_usd, plates_usd,
         tooling_usd, custom_cells_across, custom_cells_down)
      VALUES
        ($1, $2, 'custom', NULL, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
         $17::jsonb, $18, $19, $20, $21, $22, $23)
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      args.quoteId, args.quoteNo, args.L, args.W, args.H, args.style,
      r.description, args.qty, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
      r.print_colors === null ? null : JSON.stringify(r.print_colors),
      r.print_sides, r.print_usd, r.plates_usd,
      r.tooling_usd, args.cells?.across ?? null, args.cells?.down ?? null,
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
             plates_usd = $14,
             tooling_usd = $15
       WHERE id = $1
      RETURNING ${CUSTOM_SELECTION_RETURNING}`,
    values: [
      id, r.description, r.unit_price_usd, r.extended_price_usd,
      r.board_grade_id, r.board_grade_name, r.pricing_source, r.needs_review, r.pricing_note,
      r.pricing_detail === null ? null : JSON.stringify(r.pricing_detail),
      r.print_colors === null ? null : JSON.stringify(r.print_colors),
      r.print_sides, r.print_usd, r.plates_usd, r.tooling_usd,
    ],
  };
}

/** Step 27: a custom row's partition cells (null for other styles / bad data). */
function rowCells(across: unknown, down: unknown): PartitionCells | null {
  const a = Number(across);
  const d = Number(down);
  return Number.isInteger(a) && Number.isInteger(d) && a >= 1 && d >= 1 && a * d >= 2 ? { across: a, down: d } : null;
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
  printArg: PrintSpec | null | "per_box",
  opts: { onlyRowId?: number } = {},
): Promise<void> {
  // Step 9A: printArg "per_box" = each row uses its own print_colors /
  // print_sides (multi-size boxes-only quotes). onlyRowId reprices one row.
  const rows = await q<{
    id: number;
    kind: string;
    qty: number | string;
    custom_length_in: string | number | null;
    custom_width_in: string | number | null;
    custom_height_in: string | number | null;
    custom_style: string | null;
    board_grade_id: string | number | null;
    print_colors: unknown;
    print_sides: number | string | null;
    custom_cells_across: number | string | null;
    custom_cells_down: number | string | null;
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
            qbs.board_grade_id, qbs.print_colors, qbs.print_sides,
            qbs.custom_cells_across, qbs.custom_cells_down,
            b.id AS b_id, b.sku, b.vendor, b.style, b.description AS b_description,
            b.inside_length_in, b.inside_width_in, b.inside_height_in
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
      WHERE qbs.quote_id = $1
        AND ($2::bigint IS NULL OR qbs.id = $2::bigint)`,
    [quoteId, opts.onlyRowId ?? null],
  );
  // Step 15: the quote's run-method choice (null = auto by quantity).
  const method = rows.length > 0 ? await runMethodForQuoteId(quoteId) : null;

  for (const row of rows) {
    const qty = Math.max(1, Math.round(Number(row.qty) || 1));
    const print: PrintSpec | null =
      printArg === "per_box" ? rowPrintSpec(row.print_colors, row.print_sides) : printArg;

    if (row.kind === "custom") {
      const resolved = await resolveCustomSelection(
        Number(row.custom_length_in),
        Number(row.custom_width_in),
        Number(row.custom_height_in),
        String(row.custom_style || ""),
        qty,
        tenantId,
        {
          gradeId: row.board_grade_id == null ? null : Number(row.board_grade_id),
          print,
          method,
          cells: rowCells(row.custom_cells_across, row.custom_cells_down),
        },
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
    const adder = await printAdderFor(tenantId, qty, print, method, {
      L: Number(row.inside_length_in),
      W: Number(row.inside_width_in),
      H: Number(row.inside_height_in),
    });
    const priced = withAdder(base.unit_price_usd, base.extended_price_usd, qty, adder);
    const pf = printFields(print, adder, adder ? adder.plates_line_usd : null);
    // Step 4B: stock rows say how they're printed, like custom rows do.
    const stockDescription =
      print && print.colors.length > 0
        ? `${base.description} · ${describePrintSpec(print, adder?.method)}`
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
              description = $9,
              pricing_detail = $10::jsonb
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
        adder ? JSON.stringify({ run_method: adder.method }) : null,
      ],
    );
  }
}

export type BoxBreakPrice = {
  qty: number;
  boxes_usd: number | null; // all boxes on the quote at this qty (null if any box has no price)
  plates_usd: number; // one-time plates, once per quote
  tooling_usd: number; // Step 27: one-time cutting dies
  total_usd: number | null; // boxes + plates + dies
  unit_usd: number | null; // per box, only when the quote has exactly one box row
};

/**
 * Read-only: price every box on a quote at each of the given quantities
 * (Corrugated Step 5, buyer-picked quantity breaks). Same pricing as
 * repriceQuoteBoxes — custom rows through resolveCustomSelection (engine or
 * nearest stock), stock rows at their catalog tier + print adder — but
 * nothing is written.
 */
export async function priceQuoteBoxesAtQtys(
  quoteId: number,
  tenantId: number | null,
  printArg: PrintSpec | null | "per_box",
  qtys: number[],
  opts: { onlyRowId?: number } = {},
): Promise<BoxBreakPrice[]> {
  // Step 9A: "per_box" = each row's own print; onlyRowId prices one row.
  const rows = await q<{
    id: number;
    kind: string;
    custom_length_in: string | number | null;
    custom_width_in: string | number | null;
    custom_height_in: string | number | null;
    custom_style: string | null;
    board_grade_id: string | number | null;
    print_colors: unknown;
    print_sides: number | string | null;
    custom_cells_across: number | string | null;
    custom_cells_down: number | string | null;
    b_id: number | null;
    sku: string | null;
    vendor: string | null;
    style: string | null;
    b_description: string | null;
    inside_length_in: number | null;
    inside_width_in: number | null;
    inside_height_in: number | null;
  }>(
    `SELECT qbs.id, qbs.kind,
            qbs.custom_length_in, qbs.custom_width_in, qbs.custom_height_in, qbs.custom_style,
            qbs.board_grade_id, qbs.print_colors, qbs.print_sides,
            qbs.custom_cells_across, qbs.custom_cells_down,
            b.id AS b_id, b.sku, b.vendor, b.style, b.description AS b_description,
            b.inside_length_in, b.inside_width_in, b.inside_height_in
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
      WHERE qbs.quote_id = $1
        AND ($2::bigint IS NULL OR qbs.id = $2::bigint)
      ORDER BY qbs.id`,
    [quoteId, opts.onlyRowId ?? null],
  );
  // Step 15: the quote's run-method choice; auto re-decides at each quantity.
  const method = rows.length > 0 ? await runMethodForQuoteId(quoteId) : null;

  const out: BoxBreakPrice[] = [];
  for (const rawQty of qtys) {
    const qty = Math.max(1, Math.round(Number(rawQty) || 1));
    let boxes: number | null = 0;
    let plates = 0;
    let tooling = 0;
    let unit: number | null = null;
    let priced = 0;

    for (const row of rows) {
      const print: PrintSpec | null =
        printArg === "per_box" ? rowPrintSpec(row.print_colors, row.print_sides) : printArg;
      let ext: number | null = null;
      let u: number | null = null;
      let pl: number | null = null;
      let tl: number | null = null;

      if (row.kind === "custom") {
        const r = await resolveCustomSelection(
          Number(row.custom_length_in),
          Number(row.custom_width_in),
          Number(row.custom_height_in),
          String(row.custom_style || ""),
          qty,
          tenantId,
          {
            gradeId: row.board_grade_id == null ? null : Number(row.board_grade_id),
            print,
            method,
            cells: rowCells(row.custom_cells_across, row.custom_cells_down),
          },
        );
        ext = r.extended_price_usd;
        u = r.unit_price_usd;
        pl = r.plates_usd;
        tl = r.tooling_usd;
      } else if (row.b_id != null) {
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
        const adder = await printAdderFor(tenantId, qty, print, method, {
          L: Number(row.inside_length_in),
          W: Number(row.inside_width_in),
          H: Number(row.inside_height_in),
        });
        const p = withAdder(base.unit_price_usd, base.extended_price_usd, qty, adder);
        ext = p.extended;
        u = p.unit;
        pl = adder ? adder.plates_line_usd : null;
      } else {
        continue;
      }

      priced += 1;
      boxes = boxes == null || ext == null ? null : r2(boxes + ext);
      plates = r2(plates + (pl ?? 0));
      tooling = r2(tooling + (tl ?? 0));
      unit = u;
    }

    out.push({
      qty,
      boxes_usd: priced > 0 ? boxes : null,
      plates_usd: plates,
      tooling_usd: tooling,
      total_usd: priced > 0 && boxes != null ? r2(boxes + plates + tooling) : null,
      unit_usd: priced === 1 ? unit : null,
    });
  }
  return out;
}
