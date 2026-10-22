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
import { addAdminAlert } from "@/lib/admin-alerts";
import { boxEditGuard } from "@/lib/box-edit-guard";

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
      tenant_id: number | null;
      locked: boolean | null;
    }>(
      `
      SELECT id, quote_no, tenant_id, locked
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

    // Step 14: buyers may change boxes until the quote is released (rate-limited);
    // shop staff always may.
    const guard = await boxEditGuard(req, quote);
    if (guard) return guard;

    const quoteId = quote.id;
    const selIdNum = Number(selectionId);

    // 2) Fetch selection SKU (so we can delete its shadow quote_items rows)
    const sel = await one<{
      sku: string | null;
      custom_style: string | null;
    }>(
      `
      SELECT sku, custom_style
      FROM public."quote_box_selections"
      WHERE id = $1
        AND quote_id = $2
      LIMIT 1
      `,
      [selIdNum, quoteId],
    );

    // Step 39D: a display's assembly / packing line goes with the display;
    // it's managed on the admin quote page, not removed like a box.
    if (sel?.custom_style === "assembly") {
      return NextResponse.json(
        { ok: false, error: "ASSEMBLY_LINE", message: "Assembly and packing is part of the display. Ask the shop to change it." },
        { status: 400 },
      );
    }
    // Step 39D2: a display's parts go together; staff remove one on the Display card.
    if (sel) {
      const asm = await one<{ id: number }>(
        `SELECT id FROM public."quote_box_selections" WHERE quote_id = $1 AND custom_style = 'assembly' LIMIT 1`,
        [quoteId],
      );
      if (asm) {
        return NextResponse.json(
          { ok: false, error: "DISPLAY_PART", message: "This is part of a display. Ask the shop to change the display." },
          { status: 400 },
        );
      }
    }

    const sku = sel?.sku?.trim() || null;

    // 3) Delete the selection row
    const delSelResult = await q(
      `
      DELETE FROM public."quote_box_selections"
      WHERE id = $1
        AND quote_id = $2
      RETURNING id
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

   // 4) NEW: Delete ALL carton shadow quote_items rows for this quote.
// These rows were inserted as "Requested shipping carton: ..." and can surface
// as unwanted "Included layer" lines if they accumulate.
// We intentionally delete by prefix only (not SKU) because selections may be empty
// but ghosts can still exist from previous swaps.
let deletedItemCount = 0;

try {
  const delItemsResult = await q(
    `
    DELETE FROM public."quote_items"
    WHERE quote_id = $1
      AND product_id IS NULL
      AND notes ILIKE 'Requested shipping carton:%'
    `,
    [quoteId],
  );

  deletedItemCount =
    // @ts-ignore
    typeof (delItemsResult as any)?.rowCount === "number"
      ? // @ts-ignore
        (delItemsResult as any).rowCount
      : Array.isArray(delItemsResult)
        ? delItemsResult.length
        : 0;
} catch (err) {
  console.warn("[boxes/remove-from-quote] carton shadow cleanup skipped", err);
}


    if (deletedCount > 0) {
      await addAdminAlert({
        req,
        quoteNo: quote.quote_no,
        kind: "buyer_change",
        title: "Box removed",
        detail: sku ? `Removed ${sku}` : "A box was removed from the quote.",
      });
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
