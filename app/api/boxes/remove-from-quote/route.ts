// app/api/boxes/remove-from-quote/route.ts
//
// POST /api/boxes/remove-from-quote
//
// Body JSON:
//   {
//     "quoteNo": "Q-AI-20251201-000001",
//     "selectionId": 123
//   }
//
// Behavior (Path A):
//   - Looks up the quote by quote_no
//   - Looks up the carton selection row (to get its SKU) scoped to the quote
//   - Deletes the carton selection from public.quote_box_selections
//   - NEW: Deletes the matching "Requested shipping carton: ..." shadow row(s)
//          from public.quote_items (prevents ghost "Included layer" lines)
//   - Returns { ok: true, deletedCount, deletedItemCount, quoteId }

import { NextRequest, NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InBody = {
  quoteNo?: string;
  selectionId?: number;
};

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

    const quoteNo = body.quoteNo?.trim();
    const selectionId = body.selectionId;

    if (!quoteNo) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_QUOTE_NO",
          message: "quoteNo is required.",
        },
        { status: 400 },
      );
    }

    if (
      selectionId === undefined ||
      selectionId === null ||
      !Number.isFinite(Number(selectionId))
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_SELECTION_ID",
          message: "selectionId is required.",
        },
        { status: 400 },
      );
    }

    // 1) Look up quote
    const quote = await one<{
      id: number;
      quote_no: string;
    }>(
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

    const quoteId = quote.id;
    const selIdNum = Number(selectionId);

    // 2) Fetch selection SKU (so we can delete its shadow quote_items rows)
    const sel = await one<{
      sku: string | null;
    }>(
      `
      SELECT sku
      FROM public."quote_box_selections"
      WHERE id = $1
        AND quote_id = $2
      LIMIT 1
      `,
      [selIdNum, quoteId],
    );

    const sku = sel?.sku?.trim() || null;

    // 3) Delete the selection row
    const delSelResult = await q(
      `
      DELETE FROM public."quote_box_selections"
      WHERE id = $1
        AND quote_id = $2
    `,
      [selIdNum, quoteId],
    );

    const deletedCount =
      // @ts-ignore
      typeof (delSelResult as any)?.rowCount === "number"
        ? // @ts-ignore
          (delSelResult as any).rowCount
        : Array.isArray(delSelResult)
          ? delSelResult.length
          : 0;

    // 4) NEW: Delete the shadow quote_items row(s) for this carton SKU
    // These rows were inserted as "Requested shipping carton: ... <sku> ..."
    // and can surface as unwanted "Included layer" lines if they accumulate.
    let deletedItemCount = 0;

    if (sku) {
      const delItemsResult = await q(
        `
        DELETE FROM public."quote_items"
        WHERE quote_id = $1
          AND product_id IS NULL
          AND notes ILIKE 'Requested shipping carton:%'
          AND notes ILIKE $2
        `,
        [quoteId, `%${sku}%`],
      );

      deletedItemCount =
        // @ts-ignore
        typeof (delItemsResult as any)?.rowCount === "number"
          ? // @ts-ignore
            (delItemsResult as any).rowCount
          : Array.isArray(delItemsResult)
            ? delItemsResult.length
            : 0;
    }

    return NextResponse.json({
      ok: true,
      deletedCount,
      deletedItemCount,
      quoteId,
      sku,
    });
  } catch (err: any) {
    console.error("Error in /api/boxes/remove-from-quote:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message:
          err?.message ||
          "There was an unexpected problem removing this carton selection.",
      },
      { status: 500 },
    );
  }
}
