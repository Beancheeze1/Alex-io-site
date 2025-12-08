// app/api/boxes/add-to-quote/route.ts
//
// Attach a selected carton to a quote.
// Called from the layout editor when the user clicks "Pick this box".
//
// POST JSON:
//   {
//     "quote_no": "Q-AI-20251208-032309",
//     "sku": "BP-RSC-16x12x6",
//     "qty": 250
//   }
//
// Behaviour (Path A, DB-safe):
//   - Looks up quotes.id by quote_no
//   - Does NOT require a row in public.boxes
//   - Inserts a row into quote_box_selections (quote_id, quote_no, sku, qty)
//   - Inserts a simple carton row into quote_items so it shows on the quote print.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function bad(body: any, status = 400) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const quoteNo = String(body.quote_no ?? "").trim();
  const sku = String(body.sku ?? "").trim();
  const qtyNum = Number(body.qty ?? 1);

  if (!quoteNo || !sku || !Number.isFinite(qtyNum) || qtyNum <= 0) {
    return bad({
      ok: false,
      error: "MISSING_FIELDS",
      message: "quote_no, sku and a positive qty are required.",
    });
  }

  try {
    // 1) Look up the quote by quote_no
    const quote = await one<{ id: number }>(
      `
      select id
      from quotes
      where quote_no = $1
      `,
      [quoteNo],
    );

    if (!quote) {
      return bad(
        {
          ok: false,
          error: "QUOTE_NOT_FOUND",
          message: `No quote for ${quoteNo}`,
        },
        404,
      );
    }

    // 2) Record the selection (no box_id required for now)
    await q(
      `
      insert into quote_box_selections (
        quote_id,
        quote_no,
        sku,
        qty
      )
      values ($1, $2, $3, $4)
      `,
      [quote.id, quoteNo, sku, qtyNum],
    );

    // 3) Add a simple carton line item so it shows in the quote viewer.
    //    Keep dims/material null for now; use notes to explain.
    const notes = `[CARTON] SKU ${sku}`;

    await q(
      `
      insert into quote_items (
        quote_id,
        product_id,
        length_in,
        width_in,
        height_in,
        material_id,
        qty,
        notes
      )
      values ($1, null, null, null, null, null, $2, $3)
      `,
      [quote.id, qtyNum, notes],
    );

    return ok({ ok: true }, 200);
  } catch (err) {
    console.error("Error in /api/boxes/add-to-quote:", err);
    return bad(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: "Unexpected error adding carton to quote.",
      },
      500,
    );
  }
}
