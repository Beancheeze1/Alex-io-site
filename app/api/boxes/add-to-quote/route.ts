// app/api/boxes/add-to-quote/route.ts
//
// POST /api/boxes/add-to-quote
//
// Body JSON:
//   {
//     "quote_no": "Q-AI-2025...",
//     "box_id": 123,            // preferred
//     "sku": "BP-RSC-16x12x6",  // optional if box_id omitted
//     "qty": 250                // optional, defaults to 1
//   }
////
//// Behavior (Path A):
////   - Looks up the quote by quote_no.
////   - Looks up the box in public.boxes (by id or sku).
////   - Upserts a row into public.quote_box_selections:
////       * If (quote_id, box_id) exists, increments qty (qty = qty + incomingQty).
////       * Otherwise inserts a new selection row.
////   - Best-effort: inserts a single carton line into public.quote_items using the
////     box inside dimensions and the primary line's material_id (only when the
////     selection row is first created, not on subsequent qty bumps).
////   - Returns ok:true + the selection row, and optionally box_item_id.
////
//// Notes:
////   - Does NOT change existing foam items or pricing logic.
////   - Carton quote_items rows are inserted with NULL pricing fields so they
////     don't affect existing calculations.
////   - NEW: When possible, uses boxes.list_price_usd to populate
////     unit_price_usd and extended_price_usd on quote_box_selections.

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BodyIn = {
  quote_no?: string;
  box_id?: number | string | null;
  sku?: string | null;
  qty?: number | string | null;
};

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
  list_price_usd: number | null;
};

type PrimaryItemRow = {
  id: number;
  material_id: number | null;
};

type SelectionRow = {
  id: number;
  qty: number;
  unit_price_usd: number | null;
};

// ---------- helpers ----------

function parseQty(raw: any, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

// Round to 2 decimals, returning null if invalid or <= 0.
function normalizeUnitPrice(raw: any): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

// Round to 2 decimals for extended price.
function normalizeExtendedPrice(raw: any): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Compute the effective carton unit price for this selection.
 *
 * For now (Path A):
 *   - If there is an existing unit price (manual override), keep it.
 *   - Otherwise, use boxes.list_price_usd (rounded to 2 decimals).
 *
 * In the future, this function can be expanded for tiered pricing
 * without touching the rest of the route.
 */
function computeCartonUnitPrice(opts: {
  box: BoxRow;
  existingUnitPrice: number | null;
  newQty: number;
}): number | null {
  const { box, existingUnitPrice } = opts;

  // Respect any previously-set unit_price_usd (manual override).
  if (existingUnitPrice != null && Number.isFinite(existingUnitPrice)) {
    return normalizeUnitPrice(existingUnitPrice);
  }

  // Fallback to catalog list_price_usd.
  const fromBox = normalizeUnitPrice(box.list_price_usd);
  if (fromBox != null) return fromBox;

  // No pricing available; allow NULL price.
  return null;
}

// ---------- POST /api/boxes/add-to-quote ----------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BodyIn;

    const quote_no = (body.quote_no || "").trim();
    if (!quote_no) {
      return bad({ ok: false, error: "MISSING_QUOTE_NO" }, 400);
    }

    const hasBoxId = body.box_id !== undefined && body.box_id !== null;
    const hasSku =
      typeof body.sku === "string" && body.sku.trim().length > 0;

    if (!hasBoxId && !hasSku) {
      return bad(
        {
          ok: false,
          error: "MISSING_BOX",
          message: "You must provide either box_id or sku.",
        },
        400,
      );
    }

    const incomingQty = parseQty(body.qty, 1);

    // 1) Look up quote
    const quote = (await one<QuoteRow>(
      `
      SELECT id, quote_no
      FROM public."quotes"
      WHERE quote_no = $1
      `,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "QUOTE_NOT_FOUND",
          message: `No quote found with number ${quote_no}.`,
        },
        404,
      );
    }

    // 2) Look up box (now including list_price_usd)
    let box: BoxRow | null = null;

    if (hasBoxId) {
      const idNum = Number(body.box_id);
      if (Number.isFinite(idNum) && idNum > 0) {
        box = (await one<BoxRow>(
          `
          SELECT
            id,
            vendor,
            style,
            sku,
            inside_length_in,
            inside_width_in,
            inside_height_in,
            list_price_usd
          FROM public.boxes
          WHERE id = $1
          `,
          [idNum],
        )) as BoxRow | null;
      }
    } else if (hasSku) {
      const sku = (body.sku || "").trim();
      box = (await one<BoxRow>(
        `
        SELECT
          id,
          vendor,
          style,
          sku,
          inside_length_in,
          inside_width_in,
          inside_height_in,
          list_price_usd
        FROM public.boxes
        WHERE sku = $1
        `,
        [sku],
      )) as BoxRow | null;
    }

    if (!box) {
      const sku = (body.sku || "").trim();
      return bad(
        {
          ok: false,
          error: "BOX_NOT_FOUND",
          message: sku
            ? `No box with sku ${sku} found in boxes catalog.`
            : "Box not found in boxes catalog.",
        },
        404,
      );
    }

    // 3) Upsert into quote_box_selections (incrementing qty on duplicates)
    let selection:
      | {
          id: number;
          quote_id: number;
          quote_no: string;
          box_id: number;
          sku: string;
          qty: number;
          created_at: string;
        }
      | null = null;

    const existingSelection = (await one<SelectionRow>(
      `
      SELECT id, qty, unit_price_usd
      FROM public.quote_box_selections
      WHERE quote_id = $1
        AND box_id = $2
      ORDER BY id ASC
      LIMIT 1
      `,
      [quote.id, box.id],
    )) as SelectionRow | null;

    const isNewSelection = !existingSelection;

    if (existingSelection) {
      const newQty = (existingSelection.qty ?? 0) + incomingQty;

      const effectiveUnitPrice = computeCartonUnitPrice({
        box,
        existingUnitPrice: existingSelection.unit_price_usd,
        newQty,
      });

      const extendedPrice =
        effectiveUnitPrice != null
          ? normalizeExtendedPrice(effectiveUnitPrice * newQty)
          : null;

      const rows = await q(
        `
        UPDATE public.quote_box_selections
        SET
          qty = $1,
          unit_price_usd = $2,
          extended_price_usd = $3
        WHERE id = $4
        RETURNING id, quote_id, quote_no, box_id, sku, qty, created_at
        `,
        [newQty, effectiveUnitPrice, extendedPrice, existingSelection.id],
      );
      selection = (rows[0] ?? null) as any;
    } else {
      const effectiveUnitPrice = computeCartonUnitPrice({
        box,
        existingUnitPrice: null,
        newQty: incomingQty,
      });

      const extendedPrice =
        effectiveUnitPrice != null
          ? normalizeExtendedPrice(effectiveUnitPrice * incomingQty)
          : null;

      const rows = await q(
        `
        INSERT INTO public.quote_box_selections
          (quote_id, quote_no, box_id, sku, qty, unit_price_usd, extended_price_usd)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, quote_id, quote_no, box_id, sku, qty, created_at
        `,
        [
          quote.id,
          quote.quote_no,
          box.id,
          box.sku,
          incomingQty,
          effectiveUnitPrice,
          extendedPrice,
        ],
      );
      selection = (rows[0] ?? null) as any;
    }

    // 4) Best-effort: also insert a carton line into quote_items
    //    Only when we *create* a new selection, to avoid duplicate carton items.
    let boxItemId: number | null = null;

    if (isNewSelection) {
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

      if (primaryItem && primaryItem.material_id != null) {
        const L = Number(box.inside_length_in);
        const W = Number(box.inside_width_in);
        const H = Number(box.inside_height_in);

        if (L > 0 && W > 0 && H > 0) {
          const labelParts: string[] = [];

          labelParts.push(`${L} x ${W} x ${H} in`);
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
            [
              quote.id,
              L,
              W,
              H,
              primaryItem.material_id,
              incomingQty,
              notes,
            ],
          );

          if (rows && rows[0] && typeof rows[0].id === "number") {
            boxItemId = rows[0].id as number;
          }
        }
      }
    }

    return ok({
      ok: true,
      selection,
      box_item_id: boxItemId,
    });
  } catch (err: any) {
    console.error("Error in /api/boxes/add-to-quote:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        detail: String(err?.message ?? err),
        message: "Unexpected error adding carton to quote.",
      },
      { status: 500 },
    );
  }
}
