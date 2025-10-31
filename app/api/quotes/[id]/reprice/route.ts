// app/api/quotes/[id]/reprice/route.ts
import { NextResponse } from "next/server";
import { QuoteItemInputSchema } from "@/lib/validators";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const quoteId = Number(params.id);
  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = QuoteItemInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Call your calc function (from schema you shared earlier)
  // calc_foam_quote(length, width, height, material_id, qty, cavities_json, round_to_bf)
  const client = await pool.connect();
  try {
    const calc = await client.query(
      `
      SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6,$7) as quote_json
      `,
      [
        input.length_in,
        input.width_in,
        input.height_in,
        input.material_id,
        input.qty,
        JSON.stringify(input.cavities),
        input.round_to_bf ?? 0.10,
      ]
    );

    const result = calc.rows[0]?.quote_json ?? null;
    return NextResponse.json({ ok: true, preview: result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: "Calc error", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
