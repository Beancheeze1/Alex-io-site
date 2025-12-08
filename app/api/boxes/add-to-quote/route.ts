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
  const qty = Number(body.qty ?? 1);

  if (!quoteNo || !sku || !Number.isFinite(qty) || qty <= 0) {
    return bad({
      ok: false,
      error: "MISSING_FIELDS",
      message: "quote_no, sku, qty are required"
    });
  }

  try {
    const quote = await one<{ id: number }>(
      `select id from quotes where quote_no = $1`,
      [quoteNo]
    );

    if (!quote) {
      return bad({ ok: false, error: "QUOTE_NOT_FOUND" }, 404);
    }

    const box = await one<{ id: number; product_id: number | null }>(
      `select id, product_id from boxes where sku = $1 limit 1`,
      [sku]
    );

    if (!box) {
      return bad({ ok: false, error: "BOX_NOT_FOUND" }, 404);
    }

    // Add carton selection tracking row
    await q(
      `
      insert into quote_box_selections (quote_id, quote_no, box_id, sku, qty)
      values ($1, $2, $3, $4, $5)
      `,
      [quote.id, quoteNo, box.id, sku, qty]
    );

    // Add a quote item to show carton as a line on the quote
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
      values ($1, $2, null, null, null, null, $3, $4)
      `,
      [
        quote.id,
        box.product_id ?? null,
        qty,
        `[CARTON] SKU ${sku}`
      ]
    );

    return ok({ ok: true }, 200);

  } catch (err) {
    console.error("Error in /api/boxes/add-to-quote", err);
    return bad({ ok: false, error: "SERVER_ERROR" }, 500);
  }
}
