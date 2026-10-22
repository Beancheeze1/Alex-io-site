// app/api/admin/quotes/boxes/route.ts
//
// Step 18: staff edit the boxes on a boxes-only quote (admin quote page,
// "Boxes on this quote" card). Boxes-only quotes have no layout editor, so
// this is where a revised quote's box size, style, board grade, printing and
// quantity change.
//   GET  ?quote_no=…  -> { ok, boxes_only, locked, per_box, rows: [...], grades: [...] }
//   POST { quote_no, box_id, L, W, D, style, grade_id?, qty, colors, sides,
//          cells_across?, cells_down? }   // Step 27: any style; partitions need cells
//        -> updates that box and reprices it
// - Staff (admin / cs / sales) of the quote's shop, or the platform owner.
// - Released (locked) quotes are refused: Revise first.
// - A stock box saved with a different size or style becomes a custom box.
// - Single-size quotes keep one quote-level print spec (facts.print_spec);
//   per-size quotes (facts.print_mode "per_box") keep print on each row.
// - The edited quantity replaces the old one in the compare quantities.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { isPlatformOwner } from "@/lib/admin-auth";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { MAX_COLORS, parsePrintSpec, type PrintSpec } from "@/lib/corrugated-price";
import { repriceQuoteBoxes, rowPrintSpec } from "@/app/lib/packaging-selection";
import { boxStyleOrRsc, parseCustomBoxInput, type BoxStyle } from "@/lib/box-styles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteRow = { id: number; quote_no: string; tenant_id: number; locked: boolean | null };

type BoxRow = {
  id: number;
  kind: string;
  qty: number | string;
  sku: string | null;
  custom_length_in: string | number | null;
  custom_width_in: string | number | null;
  custom_height_in: string | number | null;
  custom_style: string | null;
  custom_cells_across: number | string | null;
  custom_cells_down: number | string | null;
  board_grade_id: string | number | null;
  print_colors: unknown;
  print_sides: number | string | null;
  qty_breaks: unknown;
  description: string | null;
  b_length: string | number | null;
  b_width: string | number | null;
  b_height: string | number | null;
  b_style: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function staffQuote(req: NextRequest, quoteNoRaw: unknown): Promise<{ quote: QuoteRow } | { res: NextResponse }> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) return { res: json({ ok: false, error: "unauthorized" }, 401) };
  if (!isRoleAllowed(user, ["admin", "cs", "sales"])) return { res: json({ ok: false, error: "forbidden" }, 403) };

  const quoteNo = typeof quoteNoRaw === "string" ? quoteNoRaw.trim().slice(0, 40) : "";
  if (!quoteNo) return { res: json({ ok: false, error: "missing_quote_no", message: "quote_no is required." }, 400) };

  const quote = await one<QuoteRow>(
    `SELECT id, quote_no, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
    [quoteNo],
  );
  if (!quote || (Number(quote.tenant_id) !== Number(user.tenant_id) && !isPlatformOwner(user))) {
    return { res: json({ ok: false, error: "not_found", message: "Quote not found." }, 404) };
  }
  return { quote };
}

async function loadRows(quoteId: number): Promise<BoxRow[]> {
  return q<BoxRow>(
    `SELECT qbs.id, qbs.kind, qbs.qty, qbs.sku,
            qbs.custom_length_in, qbs.custom_width_in, qbs.custom_height_in, qbs.custom_style,
            qbs.custom_cells_across, qbs.custom_cells_down,
            qbs.board_grade_id, qbs.print_colors, qbs.print_sides, qbs.qty_breaks, qbs.description,
            b.inside_length_in AS b_length, b.inside_width_in AS b_width, b.inside_height_in AS b_height,
            b.style AS b_style
       FROM public.quote_box_selections qbs
       LEFT JOIN public.boxes b ON b.id = qbs.box_id
      WHERE qbs.quote_id = $1
      ORDER BY qbs.id`,
    [quoteId],
  );
}

/** Step 27: any style in lib/box-styles.ts; old or unknown values read as RSC (mailers stay mailers). */
function styleOf(raw: unknown): BoxStyle {
  return boxStyleOrRsc(raw);
}

/** Whole-number quantities, 1..10M, de-duplicated and ascending. */
function cleanBreaks(raw: unknown): number[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = list.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10_000_000);
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** The compare quantities with the old quantity swapped for the new one. */
function swapBreak(raw: unknown, oldQty: number, newQty: number): number[] {
  const list = cleanBreaks(raw).filter((n) => n !== oldQty);
  return Array.from(new Set([...list, newQty])).sort((a, b) => a - b);
}

function isBoxesOnly(facts: Record<string, unknown>, rows: BoxRow[]): boolean {
  return facts.pack_type === "boxes_only" && rows.length > 0;
}

export async function GET(req: NextRequest) {
  try {
    const r = await staffQuote(req, req.nextUrl.searchParams.get("quote_no"));
    if ("res" in r) return r.res;
    const { quote } = r;

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const rows = await loadRows(quote.id);
    if (!isBoxesOnly(facts, rows)) return json({ ok: true, boxes_only: false });

    const perBox = facts.print_mode === "per_box";
    const quoteSpec = parsePrintSpec(facts.print_spec) ?? { colors: [], sides: 1 };
    const grades = await q<{ id: number | string; name: string; is_default: boolean }>(
      `SELECT id, name, is_default
         FROM public.corrugated_board_grades
        WHERE tenant_id = $1 AND active = true
        ORDER BY sort_order, id`,
      [quote.tenant_id],
    );

    return json({
      ok: true,
      boxes_only: true,
      locked: !!quote.locked,
      per_box: perBox,
      grades: grades.map((g) => ({ id: Number(g.id), name: String(g.name), is_default: g.is_default === true })),
      rows: rows.map((row) => {
        const custom = row.kind === "custom";
        const print: PrintSpec = perBox
          ? (rowPrintSpec(row.print_colors, row.print_sides) ?? { colors: [], sides: 1 })
          : quoteSpec;
        return {
          id: Number(row.id),
          kind: custom ? "custom" : "stock",
          sku: row.sku,
          description: row.description,
          L: Number(custom ? row.custom_length_in : row.b_length) || null,
          W: Number(custom ? row.custom_width_in : row.b_width) || null,
          D: Number(custom ? row.custom_height_in : row.b_height) || null,
          style: styleOf(custom ? row.custom_style : row.b_style),
          cells_across: row.custom_cells_across == null ? null : Number(row.custom_cells_across),
          cells_down: row.custom_cells_down == null ? null : Number(row.custom_cells_down),
          grade_id: row.board_grade_id == null ? null : Number(row.board_grade_id),
          qty: Number(row.qty) || 1,
          colors: print.colors,
          sides: print.sides,
        };
      }),
    });
  } catch (e) {
    console.error("[admin/quotes/boxes] GET failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't load the boxes." }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object") return json({ ok: false, error: "invalid_body" }, 400);
    const r = await staffQuote(req, b.quote_no);
    if ("res" in r) return r.res;
    const { quote } = r;

    if (quote.locked) {
      return json(
        { ok: false, error: "quote_locked", message: "This quote is released. Revise it before changing the boxes." },
        409,
      );
    }

    const facts = ((await loadFacts(quote.quote_no)) || {}) as Record<string, unknown>;
    const rows = await loadRows(quote.id);
    if (!isBoxesOnly(facts, rows)) {
      return json({ ok: false, error: "not_boxes_only", message: "Only boxes-only quotes are edited here." }, 400);
    }

    const boxId = Number(b.box_id);
    const row = rows.find((x) => Number(x.id) === boxId);
    if (!row) return json({ ok: false, error: "box_not_found", message: "That box isn't on this quote." }, 404);

    // ---- Validate (Step 27: any style; pads have no depth, partitions need cells) ----
    // Step 39C: a box priced from a die line keeps its file's size and style;
    // only the quantity, grade and printing change here (Edit lines re-reads the file).
    const isDieline = row.custom_style === "dieline";
    const parsed = isDieline
      ? ({
          ok: true,
          value: { L: Number(row.custom_length_in), W: Number(row.custom_width_in), D: 0, style: "dieline" as BoxStyle, cells: null },
        } as const)
      : parseCustomBoxInput(b);
    if (!parsed.ok) return json({ ok: false, error: "invalid_dims", message: parsed.message }, 400);
    const { L, W, D, style, cells } = parsed.value;
    const qty = Number(b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10_000_000) {
      return json({ ok: false, error: "invalid_qty", message: "Enter a whole-number quantity." }, 400);
    }
    const g = Number(b.grade_id);
    const gradeId = Number.isInteger(g) && g > 0 ? g : null;
    if (gradeId !== null) {
      const ok = await one<{ id: number }>(
        `SELECT id FROM public.corrugated_board_grades WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [gradeId, quote.tenant_id],
      );
      if (!ok) return json({ ok: false, error: "grade_not_found", message: "That board grade isn't active." }, 400);
    }
    const print: PrintSpec = parsePrintSpec({
      colors: Array.isArray(b.colors) ? b.colors.slice(0, MAX_COLORS) : [],
      sides: b.sides,
    }) ?? { colors: [], sides: 1 };

    // ---- Box spec: a stock box keeps its catalog row unless the size or style changed ----
    const oldQty = Number(row.qty) || 1;
    const isStock = row.kind !== "custom";
    const stockUnchanged =
      isStock &&
      Number(row.b_length) === L &&
      Number(row.b_width) === W &&
      Number(row.b_height) === D &&
      styleOf(row.b_style) === style;
    const perBox = facts.print_mode === "per_box";

    if (stockUnchanged) {
      await q(`UPDATE public.quote_box_selections SET qty = $2 WHERE id = $1`, [row.id, qty]);
    } else {
      await q(
        `UPDATE public.quote_box_selections
            SET kind = 'custom', box_id = NULL, sku = NULL,
                custom_length_in = $2, custom_width_in = $3, custom_height_in = $4, custom_style = $5,
                board_grade_id = $6, qty = $7, custom_cells_across = $8, custom_cells_down = $9
          WHERE id = $1`,
        [row.id, L, W, D, style, gradeId, qty, cells?.across ?? null, cells?.down ?? null],
      );
    }

    // ---- Print + compare quantities ----
    if (perBox) {
      await q(
        `UPDATE public.quote_box_selections
            SET print_colors = $2::jsonb, print_sides = $3, qty_breaks = $4::jsonb
          WHERE id = $1`,
        [row.id, JSON.stringify(print.colors), print.sides, JSON.stringify(swapBreak(row.qty_breaks, oldQty, qty))],
      );
    }

    const next: Record<string, unknown> = { ...facts };
    if (!perBox) {
      next.print_spec = print;
      next.printed = print.colors.length > 0 ? 1 : 0;
      next.qty = qty;
      if (Array.isArray(facts.box_qty_breaks)) next.box_qty_breaks = swapBreak(facts.box_qty_breaks, oldQty, qty);
      if (!stockUnchanged && !isDieline) next.customer_box_in = { L, W, H: D, style };
    } else {
      // Per-size quotes: facts.qty follows the first size; printed = any size printed.
      if (Number(rows[0]?.id) === Number(row.id)) next.qty = qty;
      const othersPrinted = rows.some(
        (x) => Number(x.id) !== Number(row.id) && (rowPrintSpec(x.print_colors, x.print_sides)?.colors.length ?? 0) > 0,
      );
      next.printed = othersPrinted || print.colors.length > 0 ? 1 : 0;
    }
    await saveFacts(quote.quote_no, next);

    // ---- Reprice at today's rates (run method, grade and print included) ----
    // Per-size quotes: only this box. Single-size quotes: every box, since the
    // quote-level print spec may have changed.
    if (perBox) {
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), "per_box", { onlyRowId: Number(row.id) });
    } else {
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), print);
    }

    return json({ ok: true, quote_no: quote.quote_no, box_id: Number(row.id) });
  } catch (e) {
    console.error("[admin/quotes/boxes] POST failed:", e);
    return json({ ok: false, error: "server_error", message: "Couldn't save the box. Please try again." }, 500);
  }
}
