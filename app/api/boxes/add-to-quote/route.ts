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
//
// Behavior (Path A):
//   - Looks up the quote by quote_no.
//   - Looks up the box in public.boxes (by id or sku).
//   - Upserts a row into public.quote_box_selections:
//       * If (quote_id, box_id) exists, SETS qty to incomingQty.
//       * Otherwise inserts a new selection row.
//   - NEW: After upsert, prices the carton selection using public.box_price_tiers
//         (base price + up to 4 tiers keyed by box_id).
//   - Best-effort: inserts a single carton line into public.quote_items using the
//     box inside dimensions and the primary line's material_id (only when the
//     selection row is first created, not on subsequent qty bumps).
//   - NEW: Best-effort keeps the existing carton quote_items row qty in sync,
//          because the Interactive Quote reads quote_items.
//   - Returns ok:true + the selection row, and optionally box_item_id.
//
// Notes:
//   - Does NOT change existing foam items or pricing logic.
//   - Carton quote_items rows are still inserted with NULL foam pricing fields;
//     carton pricing lives on quote_box_selections for packagingSubtotal.

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
};

type PrimaryItemRow = {
  id: number;
  material_id: number | null;
};

type SelectionRow = {
  id: number;
  quote_id: number;
  quote_no: string;
  box_id: number;
  sku: string;
  qty: number;
  created_at: string;
  unit_price_usd?: number | null;
  extended_price_usd?: number | null;
};

// NOTE: matches the schema used by /api/admin/boxes
type TierRow = {
  base_unit_price: string | number | null;
  tier1_min_qty: number | null;
  tier1_unit_price: string | number | null;
  tier2_min_qty: number | null;
  tier2_unit_price: string | number | null;
  tier3_min_qty: number | null;
  tier3_unit_price: string | number | null;
  tier4_min_qty: number | null;
  tier4_unit_price: string | number | null;
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

function toNumberOrNull(raw: any): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function roundToCents(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

// POST /api/boxes/add-to-quote
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

    // 1) Quote
    const quote = (await one(
      `
      SELECT id, quote_no
      FROM public.quotes
      WHERE quote_no = $1
      `,
      [quote_no],
    )) as QuoteRow | null;

    if (!quote) {
      return bad({ ok: false, error: "QUOTE_NOT_FOUND" }, 404);
    }

    // 2) Box lookup
    let box: BoxRow | null = null;

    if (hasBoxId) {
      const idNum = toNumberOrNull(body.box_id);
      if (idNum == null) {
        return bad({ ok: false, error: "INVALID_BOX_ID" }, 400);
      }

      box = (await one(
        `
        SELECT id, vendor, style, sku, inside_length_in, inside_width_in, inside_height_in
        FROM public.boxes
        WHERE id = $1
        `,
        [idNum],
      )) as BoxRow | null;
    } else if (hasSku) {
      const sku = (body.sku || "").trim();
      box = (await one(
        `
        SELECT id, vendor, style, sku, inside_length_in, inside_width_in, inside_height_in
        FROM public.boxes
        WHERE sku = $1
        `,
        [sku],
      )) as BoxRow | null;
    }

    if (!box) {
      return bad({ ok: false, error: "BOX_NOT_FOUND" }, 404);
    }

    // 3) Upsert selection row
    const existingSelection = (await one(
      `
      SELECT id, qty
      FROM public.quote_box_selections
      WHERE quote_id = $1 AND box_id = $2
      `,
      [quote.id, box.id],
    )) as { id: number; qty: number } | null;

    let selection: SelectionRow | null;

    const isNewSelection = !existingSelection;

    if (existingSelection) {
      // FIX: set to incoming qty (do not increment)
      const newQty = incomingQty;

      const rows = await q(
        `
        UPDATE public.quote_box_selections
        SET qty = $1
        WHERE id = $2
        RETURNING
          id,
          quote_id,
          quote_no,
          box_id,
          sku,
          qty,
          created_at,
          unit_price_usd,
          extended_price_usd
        `,
        [newQty, existingSelection.id],
      );
      selection = (rows[0] ?? null) as SelectionRow | null;
    } else {
      const rows = await q(
        `
        INSERT INTO public.quote_box_selections
          (quote_id, quote_no, box_id, sku, qty)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          quote_id,
          quote_no,
          box_id,
          sku,
          qty,
          created_at,
          unit_price_usd,
          extended_price_usd
        `,
        [quote.id, quote.quote_no, box.id, box.sku, incomingQty],
      );
      selection = (rows[0] ?? null) as SelectionRow | null;
    }

    if (!selection) {
      return bad(
        {
          ok: false,
          error: "SELECTION_FAILED",
          message: "Unable to create or update carton selection row.",
        },
        500,
      );
    }

    // 3a.5) Keep the carton quote_items row qty in sync (Interactive Quote reads quote_items)
    // Best-effort: update any existing carton line item that matches this sku.
    try {
      await q(
        `
        UPDATE public.quote_items
        SET qty = $1
        WHERE quote_id = $2
          AND product_id IS NULL
          AND price_unit_usd IS NULL
          AND calc_snapshot IS NULL
          AND notes ILIKE $3
        `,
        [selection.qty, quote.id, `%${box.sku}%`],
      );
    } catch (err) {
      console.warn("[boxes/add-to-quote] qty sync skipped", err);
    }

    // 3b) Price the carton selection using box_price_tiers (by box_id)
    //
    // Schema columns expected:
    //   box_id, base_unit_price,
    //   tier1_min_qty, tier1_unit_price, ... tier4...
    //
    const tier = (await one(
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
      [box.id],
    )) as TierRow | null;

    // Determine unit price for selection.qty
    const qtyForPrice = Math.max(1, selection.qty ?? 1);

    const base = tier?.base_unit_price != null ? Number(tier.base_unit_price) : null;

    const tiers = [
      {
        min: tier?.tier1_min_qty ?? null,
        unit: tier?.tier1_unit_price != null ? Number(tier.tier1_unit_price) : null,
      },
      {
        min: tier?.tier2_min_qty ?? null,
        unit: tier?.tier2_unit_price != null ? Number(tier.tier2_unit_price) : null,
      },
      {
        min: tier?.tier3_min_qty ?? null,
        unit: tier?.tier3_unit_price != null ? Number(tier.tier3_unit_price) : null,
      },
      {
        min: tier?.tier4_min_qty ?? null,
        unit: tier?.tier4_unit_price != null ? Number(tier.tier4_unit_price) : null,
      },
    ].filter((t) => t.min != null && Number.isFinite(t.min as any) && (t.min as number) > 0);

    let unitPrice: number | null = base;

    for (const t of tiers) {
      const minQty = t.min as number;
      const u = t.unit;
      if (u != null && Number.isFinite(u) && qtyForPrice >= minQty) {
        unitPrice = u;
      }
    }

    const extendedPrice =
      unitPrice != null ? roundToCents(unitPrice * qtyForPrice) : null;

    const priced = await q(
      `
      UPDATE public.quote_box_selections
      SET unit_price_usd = $1,
          extended_price_usd = $2
      WHERE id = $3
      RETURNING
        id,
        quote_id,
        quote_no,
        box_id,
        sku,
        qty,
        created_at,
        unit_price_usd,
        extended_price_usd
      `,
      [unitPrice, extendedPrice, selection.id],
    );

    const pricedSelection = (priced?.[0] ?? selection) as SelectionRow;

    // 4) Insert a carton line into quote_items (best-effort, only on first create)
    let boxItemId: number | null = null;

    if (isNewSelection) {
      const primaryItem = (await one(
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
          boxItemId = rows[0].id;
        }
      }
    }

    return ok({
      ok: true,
      selection: pricedSelection,
      box_item_id: boxItemId,
    });
  } catch (err: any) {
    console.error("Error in /api/boxes/add-to-quote", err);
    return bad(
      {
        ok: false,
        error: "INTERNAL_ERROR",
        message: String(err?.message || err),
      },
      500,
    );
  }
}
