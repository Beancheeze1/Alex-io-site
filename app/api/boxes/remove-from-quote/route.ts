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
// Behavior:
//   - Looks up the quote by quote_no
//   - Deletes the *carton selection* row from public."quote_box_selections"
//     that matches (id = selectionId AND quote_id = quote.id)
//   - Does NOT touch foam/other quote_items (safe for layout + pricing)
//   - Returns { ok: true, deletedCount } on success

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

    // 1) Look up the quote so we can safely scope the delete
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

    // 2) Delete from quote_box_selections for this quote
    //    This is what /api/boxes/for-quote reads to show cartons in the print view.
    const result = await q(
      `
      DELETE FROM public."quote_box_selections"
      WHERE id = $1
        AND quote_id = $2
    `,
      [selIdNum, quoteId],
    );

    // q(...) returns an array of rows for SELECT; for DELETE we care about rowCount if available.
    const deletedCount =
      // @ts-ignore – some pg clients expose rowCount
      typeof (result as any)?.rowCount === "number"
        ? // @ts-ignore
          (result as any).rowCount
        : // fall back to 0/1 based on length, if driver returns deleted rows
          Array.isArray(result)
        ? result.length
        : 0;

    return NextResponse.json({
      ok: true,
      deletedCount,
      quoteId,
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
