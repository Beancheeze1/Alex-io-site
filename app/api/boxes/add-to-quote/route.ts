// app/api/boxes/add-to-quote/route.ts
//
// Attach a selected carton to a quote.
// Called from the layout editor when the user clicks "Pick this box".
//
// POST JSON:
//   {
//     "quote_no": "Q-AI-20251208-032309",
//     "sku": "BOX-123",
//     "qty": 250
//   }
//
// Behaviour:
//   - Looks up quotes.id by quote_no
//   - Looks up boxes.id by sku
//   - Inserts a row into quote_box_selections (quote_id, quote_no, box_id, sku, qty)
//   - Inserts a carton "note" row into quote_items so it shows on the quote print.
//

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
        { ok: false, error: "QUOTE_NOT_FOUND", message: `No quote for ${quoteNo}` },
        404,
      );
    }

    // 2) Look up the box by sku (we only require id; product_id is optional / ignored)
    const box = await one<{ id: number }>(
      `
      select id
      from boxes
      where sku = $1
      limit 1
      `,
      [sku],
    );

    if (!box) {
      return bad(
        { ok: false, error: "BOX_NOT_FOUND", message: `No box with sku ${sku}` },
        404,
      );
    }

    // 3) Record the selection so we can audit / change later
    await q(
      `
      insert into quote_box_selections (
        quote_id,
        quote_no,
        box_id,
        sku,
        qty
      )
      values ($1, $2, $3, $4, $5)
      `,
      [quote.id, quoteNo, box.id, sku, qtyNum],
    );

    // 4) Add a simple carton line item so it shows in the quote viewer.
    //    We keep dims/material null for now and use the notes to explain.
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
