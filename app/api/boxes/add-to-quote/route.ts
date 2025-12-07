// app/api/boxes/add-to-quote/route.ts
//
// POST /api/boxes/add-to-quote
//
// Body JSON:
//   {
//     "quote_no": "Q-AI-2025...",
//     "box_id": 123,        // preferred
//     "sku": "RSC-30-24-18",// optional if box_id omitted
//     "qty": 250            // optional, defaults to 1
//   }
//
// Behavior:
//   - Looks up the quote by quote_no.
//   - Looks up the box in public.boxes (by id or sku).
//   - Upserts a row into public.quote_box_selections:
//       * If a selection already exists for (quote_id, box_id), updates qty.
//       * Otherwise inserts a new selection row.
//   - When possible, also inserts a carton line into public.quote_items
//     using the box inside dimensions and the primary line's material_id.
//   - Returns ok:true + the selection row, and optionally box_item_id.
//
// Path A note:
//   - We do NOT change existing foam items or pricing logic.
//   - Carton quote_items rows are inserted with NULL pricing fields so
//     they can be surfaced as separate line items without affecting
//     current price calculations.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

type QuoteRow = {
  id: number;
  quote_no: string;
};

type BoxRow = {
  id: number;
  vendor: string | null;
  style: string | null;
  sku: string;
  inside_length_in: number;
  inside_width_in: number;
  inside_height_in: number;
};

type PrimaryItemRow = {
  id: number;
  material_id: number;
};

type BodyIn = {
  quote_no?: string;
  box_id?: number;
  sku?: string;
  qty?: number;
};

function parseQty(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const quote_no = (body.quote_no || "").trim();
    if (!quote_no) {
      return NextResponse.json(
        { ok: false, error: "quote_no is required" },
        { status: 400 },
      );
    }

    const hasBoxId = body.box_id !== undefined && body.box_id !== null;
    const hasSku = typeof body.sku === "string" && body.sku.trim().length > 0;

    if (!hasBoxId && !hasSku) {
      return NextResponse.json(
        {
          ok: false,
          error: "You must provide either box_id or sku",
        },
        { status: 400 },
      );
    }

    const qty = parseQty(body.qty, 1);

    // Look up the quote id from quotes table
    const quote = (await one<QuoteRow>(
      `SELECT id, quote_no
       FROM public."quotes"
       WHERE quote_no = $1`,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return NextResponse.json(
        {
          ok: false,
          error: `Quote not found for quote_no=${quote_no}`,
        },
        { status: 404 },
      );
    }

    // Look up the box in our boxes catalog (including inside dims)
    let box: BoxRow | null = null;

    if (hasBoxId) {
      box = (await one<BoxRow>(
        `SELECT
           id,
           vendor,
           style,
           sku,
           inside_length_in,
           inside_width_in,
           inside_height_in
         FROM public."boxes"
         WHERE id = $1`,
        [body.box_id],
      )) as BoxRow | null;
    } else if (hasSku) {
      const sku = body.sku!.trim();
      box = (await one<BoxRow>(
        `SELECT
           id,
           vendor,
           style,
           sku,
           inside_length_in,
           inside_width_in,
           inside_height_in
         FROM public."boxes"
         WHERE sku = $1
         ORDER BY id
         LIMIT 1`,
        [sku],
      )) as BoxRow | null;
    }

    if (!box) {
      return NextResponse.json(
        {
          ok: false,
          error: "Box not found in boxes catalog",
        },
        { status: 404 },
      );
    }

    // Upsert into quote_box_selections:
    //  - If a row already exists for (quote_id, box_id), update qty.
    //  - Otherwise insert a new row.
    let selection: any = null;

    const existingSelection = (await one<{
      id: number;
    }>(
      `
      SELECT id
      FROM public.quote_box_selections
      WHERE quote_id = $1
        AND box_id = $2
      ORDER BY id ASC
      LIMIT 1
      `,
      [quote.id, box.id],
    )) as { id: number } | null;

    if (existingSelection) {
      const rows = await q(
        `
        UPDATE public.quote_box_selections
        SET qty = $1
        WHERE id = $2
        RETURNING id, quote_id, quote_no, box_id, sku, qty, created_at
        `,
        [qty, existingSelection.id],
      );
      selection = rows[0] ?? null;
    } else {
      const rows = await q(
        `
        INSERT INTO public.quote_box_selections
          (quote_id, quote_no, box_id, sku, qty)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, quote_id, quote_no, box_id, sku, qty, created_at
        `,
        [quote.id, quote.quote_no, box.id, box.sku, qty],
      );
      selection = rows[0] ?? null;
    }

    // Try to also insert a carton line into quote_items.
    // We keep this best-effort and only do it if we can find a primary line
    // item to borrow material_id from.
    let boxItemId: number | null = null;

    const primaryItem = (await one<PrimaryItemRow>(
      `
      SELECT id, material_id
      FROM public.quote_items
      WHERE quote_id = $1
      ORDER BY id ASC
      LIMIT 1
      `,
      [quote.id],
    )) as PrimaryItemRow | null;

    if (primaryItem) {
      const L = Number(box.inside_length_in) || 0;
      const W = Number(box.inside_width_in) || 0;
      const H = Number(box.inside_height_in) || 0;

      if (L > 0 && W > 0 && H > 0) {
        const labelParts: string[] = [];

        if (box.vendor && box.vendor.trim().length > 0) {
          labelParts.push(box.vendor.trim());
        }

        labelParts.push(box.sku);

        if (box.style && box.style.trim().length > 0) {
          labelParts.push(`(${box.style.trim()})`);
        }

        const notes = `Requested shipping carton: ${labelParts.join(" ")}`;

        const rows = await q(
          `
          INSERT INTO public.quote_items
            (
              quote_id,
              product_id,
              length_in,
              width_in,
              height_in,
              material_id,
              qty,
              notes,
              price_unit_usd,
              price_total_usd,
              calc_snapshot
            )
          VALUES
            (
              $1,
              NULL,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              NULL,
              NULL,
              NULL
            )
          RETURNING id
          `,
          [quote.id, L, W, H, primaryItem.material_id, qty, notes],
        );

        if (rows && rows[0] && typeof rows[0].id === "number") {
          boxItemId = rows[0].id as number;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      selection,
      box_item_id: boxItemId,
    });
  } catch (err: any) {
    console.error("Error in /api/boxes/add-to-quote:", err);
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
