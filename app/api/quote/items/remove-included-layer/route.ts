// app/api/quote/items/remove-included-layer/route.ts
//
// POST /api/quote/items/remove-included-layer
//
// Body JSON:
//   {
//     "quote_no": "Q-AI-20251201-000001",
//     "quote_item_id": 123
//   }
//
// Behavior:
//   - Looks up the quote by quote_no
//   - Validates quote_item belongs to quote
//   - Allows deletion ONLY for included-layer rows (notes like "[LAYOUT-LAYER]")
//   - Hard blocks primary foam rows

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InBody = {
  quote_no?: string;
  quote_item_id?: number;
};

type QuoteRow = {
  id: number;
  quote_no: string;
};

type ItemRow = {
  id: number;
  quote_id: number;
  notes?: string | null;
};

function isIncludedLayerRow(item: ItemRow | null | undefined) {
  const notes = String(item?.notes || "");
  return notes.toUpperCase().includes("[LAYOUT-LAYER]");
}

function isPrimaryFoamRow(item: ItemRow | null | undefined) {
  const notes = String(item?.notes || "").toUpperCase();
  return notes.includes("[PRIMARY]") || notes.includes("[LAYOUT-PRIMARY]");
}

export async function POST(req: NextRequest) {
  try {
    let body: InBody;
    try {
      body = (await req.json()) as InBody;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "BAD_JSON",
          message: "Request body must be valid JSON.",
        },
        { status: 400 },
      );
    }

    const quoteNo = body.quote_no?.trim();
    const quoteItemId = body.quote_item_id;

    if (!quoteNo) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_QUOTE_NO",
          message: "quote_no is required.",
        },
        { status: 400 },
      );
    }

    if (quoteItemId === undefined || quoteItemId === null || !Number.isFinite(Number(quoteItemId))) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_QUOTE_ITEM_ID",
          message: "quote_item_id is required.",
        },
        { status: 400 },
      );
    }

    const quote = await one<QuoteRow>(
      `
      SELECT id, quote_no
      FROM public."quotes"
      WHERE quote_no = $1
      LIMIT 1
    `,
      [quoteNo],
    );

    if (!quote) {
      return NextResponse.json(
        {
          ok: false,
          error: "QUOTE_NOT_FOUND",
          message: `No quote found for quote_no ${quoteNo}.`,
        },
        { status: 404 },
      );
    }

    const item = await one<ItemRow>(
      `
      SELECT id, quote_id, notes
      FROM public."quote_items"
      WHERE id = $1
        AND quote_id = $2
      LIMIT 1
    `,
      [Number(quoteItemId), quote.id],
    );

    if (!item) {
      return NextResponse.json(
        {
          ok: false,
          error: "ITEM_NOT_FOUND",
          message: "Quote item not found for this quote.",
        },
        { status: 404 },
      );
    }

    if (isPrimaryFoamRow(item)) {
      return NextResponse.json(
        {
          ok: false,
          error: "PRIMARY_NOT_REMOVABLE",
          message: "Primary foam item cannot be removed.",
        },
        { status: 400 },
      );
    }

    if (!isIncludedLayerRow(item)) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_INCLUDED_LAYER",
          message: "Only included-layer rows can be removed.",
        },
        { status: 400 },
      );
    }

    const deletedRows = await q(
      `
      DELETE FROM public."quote_items"
      WHERE id = $1
        AND quote_id = $2
        AND notes ILIKE '%[LAYOUT-LAYER]%'
      RETURNING id
    `,
      [item.id, quote.id],
    );

    if (!Array.isArray(deletedRows) || deletedRows.length !== 1) {
      return NextResponse.json(
        {
          ok: false,
          error: "not_deletable",
          message: "Included layer could not be removed.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Error in /api/quote/items/remove-included-layer:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: err?.message || "Unexpected error removing included layer.",
      },
      { status: 500 },
    );
  }
}
