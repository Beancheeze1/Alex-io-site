// app/api/quote/box-breaks/route.ts
//
// Boxes-only quantity breaks.
//
// Single-size quotes (Step 5) — quote-level compare quantities in
// facts.box_qty_breaks, one quote-level print_spec:
//   GET  -> { ok, current_qty, locked, breaks: BoxBreakPrice[], boxes: [] }
//   POST { quote_no, qty } switches every box to that saved quantity.
//
// Multi-size quotes (Step 9A) — facts.print_mode = "per_box"; each box row has
// its own qty_breaks and print:
//   GET  -> { ok, current_qty: null, locked, breaks: [], boxes: [{ id, description,
//            current_qty, breaks: BoxBreakPrice[] }] }  (only sizes with 2+ breaks)
//   POST { quote_no, qty, box_id } switches only that size to one of its own
//        saved quantities and reprices that size.
//
// Prices are always computed at the shop's current rates. Never for locked
// quotes (POST). The quote page is public by quote number, so both are open to
// logged-out buyers (rate limited); staff are not limited.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";
import { getCurrentUserFromRequest, isRoleAllowed } from "@/lib/auth";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { parsePrintSpec } from "@/lib/corrugated-price";
import { addAdminAlert } from "@/lib/admin-alerts";
import { priceQuoteBoxesAtQtys, repriceQuoteBoxes, type BoxBreakPrice } from "@/app/lib/packaging-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function bad(error: string, message: string, status = 400) {
  return json({ ok: false, error, message }, status);
}

/** Whole numbers 1..10M, unique, ascending, at most 4. */
function cleanBreaks(raw: unknown): number[] {
  let list: unknown = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = null;
    }
  }
  if (!Array.isArray(list)) return [];
  const set = new Set<number>();
  for (const v of list) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 10_000_000) set.add(n);
  }
  return [...set].sort((a, b) => a - b).slice(0, 4);
}

type QuoteRow = { id: number; tenant_id: number; locked: boolean | null };

/**
 * Step 14: the "On this quote" row shows the saved (price-locked) numbers, not
 * today's rates. Swaps the break equal to the current qty for the stored box
 * line(s); the other breaks stay at today's rates.
 */
async function withStoredCurrent(
  quoteId: number,
  prices: BoxBreakPrice[],
  currentQty: number | null,
  onlyRowId: number | null,
): Promise<(BoxBreakPrice & { stored?: boolean })[]> {
  if (!currentQty) return prices;
  const rows = await q<{ unit: string | null; ext: string | null; plates: string | null }>(
    `SELECT unit_price_usd AS unit, extended_price_usd AS ext, (to_jsonb(qbs) ->> 'plates_usd') AS plates
       FROM public.quote_box_selections qbs
      WHERE quote_id = $1 AND ($2::bigint IS NULL OR id = $2::bigint)`,
    [quoteId, onlyRowId],
  );
  if (!rows.length || rows.some((r) => r.ext == null)) return prices;
  const boxes = Math.round(rows.reduce((s, r) => s + Number(r.ext || 0), 0) * 100) / 100;
  const plates = Math.round(rows.reduce((s, r) => s + Number(r.plates || 0), 0) * 100) / 100;
  const unit = rows.length === 1 && rows[0].unit != null ? Number(rows[0].unit) : null;
  return prices.map((p) =>
    p.qty === currentQty
      ? { qty: p.qty, boxes_usd: boxes, plates_usd: plates, total_usd: Math.round((boxes + plates) * 100) / 100, unit_usd: unit, stored: true }
      : p,
  );
}

type BoxRow = {
  id: number;
  qty: number | string;
  description: string | null;
  qty_breaks: unknown;
};

async function isStaffRequest(req: NextRequest): Promise<boolean> {
  try {
    const user = await getCurrentUserFromRequest(req);
    return !!user && isRoleAllowed(user, ["admin", "cs", "sales"]);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isStaffRequest(req))) {
      const rate = await rateLimit(req, 60, "box-breaks-get");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const quoteNo = (req.nextUrl.searchParams.get("quote_no") || "").trim().slice(0, 40);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");

    const quote = await one<QuoteRow>(
      `SELECT id, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);

    const empty = { ok: true, current_qty: null, locked: !!quote.locked, breaks: [], boxes: [] };
    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, any>;
    if (facts.pack_type !== "boxes_only") return json(empty);

    // ---- Multi-size: per-size compare quantities ----
    if (facts.print_mode === "per_box") {
      const rows = await q<BoxRow>(
        `SELECT id, qty, description, qty_breaks
           FROM public.quote_box_selections
          WHERE quote_id = $1
          ORDER BY id`,
        [quote.id],
      );
      const boxes = [];
      for (const r of rows || []) {
        const breaks = cleanBreaks(r.qty_breaks);
        if (breaks.length < 2) continue;
        const prices = await priceQuoteBoxesAtQtys(quote.id, Number(quote.tenant_id), "per_box", breaks, {
          onlyRowId: Number(r.id),
        });
        const cur = Number(r.qty);
        const curQty = Number.isInteger(cur) && cur > 0 ? cur : null;
        boxes.push({
          id: Number(r.id),
          description: r.description,
          current_qty: curQty,
          breaks: await withStoredCurrent(quote.id, prices, curQty, Number(r.id)),
        });
      }
      return json({ ...empty, boxes });
    }

    // ---- Single size (Step 5) ----
    const breaks = cleanBreaks(facts.box_qty_breaks);
    if (breaks.length < 2) return json(empty);

    const print = parsePrintSpec(facts.print_spec);
    const prices = await priceQuoteBoxesAtQtys(quote.id, Number(quote.tenant_id), print, breaks);
    const current = Number(facts.qty);
    const currentQty = Number.isInteger(current) && current > 0 ? current : null;

    return json({
      ...empty,
      current_qty: currentQty,
      breaks: await withStoredCurrent(quote.id, prices, currentQty, null),
    });
  } catch (e) {
    console.error("[quote/box-breaks] GET failed:", e);
    return bad("server_error", "We couldn't load the quantity prices.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isStaffRequest(req))) {
      const rate = await rateLimit(req, 20, "box-breaks-post");
      if (!rate.success) return rateLimitResponse(rate.reset);
    }

    const b = (await req.json().catch(() => null)) as Record<string, any> | null;
    const quoteNo = typeof b?.quote_no === "string" ? b.quote_no.trim().slice(0, 40) : "";
    const qty = Number(b?.qty);
    const boxId = b?.box_id == null ? null : Number(b.box_id);
    if (!quoteNo) return bad("missing_quote_no", "quote_no is required.");
    if (!Number.isInteger(qty) || qty < 1) return bad("invalid_qty", "Pick one of the quantities on your quote.");

    const quote = await one<QuoteRow>(
      `SELECT id, tenant_id, locked FROM public.quotes WHERE quote_no = $1 LIMIT 1`,
      [quoteNo],
    );
    if (!quote) return bad("not_found", "Quote not found.", 404);
    if (quote.locked) {
      return bad("locked", "This quote is locked. Contact us to change the quantity.", 409);
    }

    const facts = ((await loadFacts(quoteNo)) || {}) as Record<string, any>;
    if (facts.pack_type !== "boxes_only") {
      return bad("not_boxes_only", "Quantity breaks are only available on boxes-only quotes.");
    }

    // ---- Multi-size: switch one size ----
    if (facts.print_mode === "per_box") {
      if (boxId == null || !Number.isInteger(boxId) || boxId <= 0) {
        return bad("missing_box_id", "Pick which box size to change.");
      }
      const row = await one<BoxRow>(
        `SELECT id, qty, description, qty_breaks
           FROM public.quote_box_selections
          WHERE id = $1 AND quote_id = $2
          LIMIT 1`,
        [boxId, quote.id],
      );
      if (!row) return bad("not_found", "That box size isn't on this quote.", 404);
      if (!cleanBreaks(row.qty_breaks).includes(qty)) {
        return bad("not_a_break", "Pick one of the quantities for that box size.");
      }

      // Step 14: the quantity already on the quote — nothing to change or reprice.
      if (Number(row.qty) === qty) return json({ ok: true, qty, box_id: Number(row.id), unchanged: true });

      await q(`UPDATE public.quote_box_selections SET qty = $2 WHERE id = $1`, [row.id, qty]);
      await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), "per_box", { onlyRowId: Number(row.id) });

      // Step 14: facts.qty mirrors size 1 (the first box row).
      const first = await one<{ id: number }>(
        `SELECT id FROM public.quote_box_selections WHERE quote_id = $1 ORDER BY id LIMIT 1`,
        [quote.id],
      );
      if (first && Number(first.id) === Number(row.id)) await saveFacts(quoteNo, { ...facts, qty });

      await addAdminAlert({
        req,
        tenantId: Number(quote.tenant_id),
        quoteNo,
        kind: "buyer_change",
        title: `Quantity changed to ${qty.toLocaleString("en-US")}`,
        detail: row.description ? `${row.description}` : "One box size switched to a compare quantity.",
      });

      return json({ ok: true, qty, box_id: Number(row.id) });
    }

    // ---- Single size (Step 5) ----
    const breaks = cleanBreaks(facts.box_qty_breaks);
    if (!breaks.includes(qty)) return bad("not_a_break", "Pick one of the quantities on your quote.");

    // Step 14: the quantity already on the quote — nothing to change or reprice.
    const onQuote = await one<{ qty: string | number }>(
      `SELECT qty FROM public.quote_box_selections WHERE quote_id = $1 ORDER BY id LIMIT 1`,
      [quote.id],
    );
    if (onQuote && Number(onQuote.qty) === qty) return json({ ok: true, qty, unchanged: true });

    await q(`UPDATE public.quote_box_selections SET qty = $2 WHERE quote_id = $1`, [quote.id, qty]);
    await saveFacts(quoteNo, { ...facts, qty });
    await repriceQuoteBoxes(quote.id, Number(quote.tenant_id), parsePrintSpec(facts.print_spec));

    await addAdminAlert({
      req,
      tenantId: Number(quote.tenant_id),
      quoteNo,
      kind: "buyer_change",
      title: `Quantity changed to ${qty.toLocaleString("en-US")}`,
      detail: "The buyer switched to one of their compare quantities.",
    });

    return json({ ok: true, qty });
  } catch (e) {
    console.error("[quote/box-breaks] POST failed:", e);
    return bad("server_error", "We couldn't change the quantity. Please try again.", 500);
  }
}
