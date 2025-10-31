// app/api/quotes/[id]/items/route.ts
import { NextResponse } from "next/server";
import { QuoteItemInputSchema } from "@/lib/validators";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Validate path id
  const quoteId = Number(params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });
  }

  // Parse body safely
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate & coerce
  const parsed = QuoteItemInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Minimal insert using your existing table structure
  // (length_in, width_in, height_in, material_id, qty, calc_snapshot, etc.)
  const client = await pool.connect();
  try {
    const ins = await client.query(
      `
      INSERT INTO quote_items
        (quote_id, product_id, length_in, width_in, height_in, material_id, qty, calc_snapshot)
      VALUES
        ($1, NULL, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        quoteId,
        input.length_in,
        input.width_in,
        input.height_in,
        input.material_id,
        input.qty,
        JSON.stringify({ cavities: input.cavities, round_to_bf: input.round_to_bf }),
      ]
    );

    // If you want to also add per-cavity rows, do it here with a VALUES UNNEST or loop.

    return NextResponse.json({ ok: true, item_id: ins.rows[0].id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "DB error", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
