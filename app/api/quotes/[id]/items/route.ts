// app/api/quotes/[id]/items/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { QuoteIdParam, QuoteItemBody } from "@/lib/validators";
import { getPool } from "@/lib/db"; // keep your existing db helper

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: { id: string } }
) {
  try {
    // Validate params & body
    const { id } = QuoteIdParam.parse(ctx.params);
    const body = QuoteItemBody.parse(await req.json());

    const pool = await getPool();

    // Use calc_foam_quote to compute pricing snapshot
    const calc = await pool.query(
      `SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6,$7) AS snapshot`,
      [
        body.length_in,
        body.width_in,
        body.height_in,
        body.material_id,
        body.qty,
        JSON.stringify(body.cavities ?? []),
        body.round_to_bf ?? 0.1,
      ],
    );

    const snapshot = calc.rows[0]?.snapshot ?? null;

    // Insert quote_items row
    const insItem = await pool.query(
      `INSERT INTO quote_items
         (quote_id, product_id, length_in, width_in, height_in,
          material_id, qty, price_unit_usd, price_total_usd, calc_snapshot)
       VALUES
         ($1, NULL, $2, $3, $4, $5, $6,
          ($7 ->> 'price_unit_usd')::numeric,
          ($7 ->> 'price_total_usd')::numeric,
          $7::jsonb)
       RETURNING id`,
      [
        id,
        body.length_in, body.width_in, body.height_in,
        body.material_id, body.qty,
        snapshot,
      ],
    );

    const itemId = insItem.rows[0].id;

    // Insert cavities (if any)
    if ((body.cavities ?? []).length > 0) {
      const valuesSql: string[] = [];
      const values: any[] = [];
      let p = 1;
      for (const cav of body.cavities!) {
        valuesSql.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        values.push(itemId, cav.count ?? 1, cav.l, cav.w, cav.d, `Cavity`);
      }
      await pool.query(
        `INSERT INTO quote_item_cavities
           (quote_item_id, count, cav_length_in, cav_width_in, cav_depth_in, label)
         VALUES ${valuesSql.join(",")}`,
        values,
      );
    }

    return NextResponse.json({ ok: true, item_id: itemId, snapshot }, { status: 200 });
  } catch (err: any) {
    // Zod or DB errors
    const msg =
      err?.issues?.[0]?.message ||
      err?.message ||
      "Unknown error";
    const code = typeof err?.code === "string" ? err.code : undefined;
    return NextResponse.json({ ok: false, error: msg, code }, { status: 400 });
  }
}
