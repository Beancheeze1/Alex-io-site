// app/api/quotes/[id]/items/route.ts
import { NextResponse } from "next/server";
import { q, one } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/quotes/:id/items */
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });

  const rows = await q(`
    SELECT qi.*, p.sku, p.name AS product_name
    FROM public.quote_items qi
    LEFT JOIN public.products p ON p.id = qi.product_id
    WHERE qi.quote_id = $1
    ORDER BY qi.id ASC
  `, [id]);

  return NextResponse.json({ ok: true, items: rows });
}

/**
 * POST /api/quotes/:id/items
 * Body:
 * {
 *   "sku": "FOAM-BLK-VALVE",        // or null, you can pass dimensions instead
 *   "length_in": 10, "width_in": 6, "height_in": 3,
 *   "material_id": 1,
 *   "qty": 2,
 *   "cavities": [{"count":1,"l":3,"w":3,"d":2}],
 *   "round_to_bf": 0.10
 * }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const quoteId = parseInt(params.id, 10);
  if (!Number.isFinite(quoteId)) return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  let { sku, length_in, width_in, height_in, material_id, qty = 1, cavities = [], round_to_bf = 0.10 } = body || {};

  // If SKU provided, hydrate dims/material from product
  if (sku) {
    const prod = await one(`
      SELECT id, base_length_in AS l, base_width_in AS w, base_height_in AS h, material_id
      FROM public.products WHERE sku = $1
    `, [sku]);
    if (!prod) return NextResponse.json({ ok: false, error: "SKU not found" }, { status: 404 });
    length_in ??= prod.l; width_in ??= prod.w; height_in ??= prod.h; material_id ??= prod.material_id;
  }

  if (!(length_in && width_in && height_in && material_id)) {
    return NextResponse.json({ ok: false, error: "length_in, width_in, height_in, material_id are required" }, { status: 400 });
  }

  // Use server-side SQL function calc_foam_quote
  const calc = await one<{ j: any }>(
    `SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6::jsonb,$7) AS j`,
    [length_in, width_in, height_in, material_id, qty, JSON.stringify(cavities ?? []), round_to_bf]
  );
  if (!calc) return NextResponse.json({ ok: false, error: "calc failed" }, { status: 500 });

  // Optional: link product if SKU exists
  const product = sku
    ? await one<{ id: number }>(`SELECT id FROM public.products WHERE sku=$1`, [sku])
    : null;

  const inserted = await one(`
    INSERT INTO public.quote_items
      (quote_id, product_id, length_in, width_in, height_in, material_id, qty,
       notes, price_unit_usd, price_total_usd, calc_snapshot)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7,
       $8, ($9->>'price_unit_usd')::numeric, ($9->>'price_total_usd')::numeric, $9)
    RETURNING *
  `, [
    quoteId,
    product?.id ?? null,
    length_in, width_in, height_in,
    material_id, qty,
    sku ? `Auto from SKU ${sku}` : null,
    calc.j, // price_unit_usd & price_total_usd extracted in SQL
  ]);

  return NextResponse.json({ ok: true, item: inserted }, { status: 201 });
}
