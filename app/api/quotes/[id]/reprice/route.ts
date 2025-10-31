// app/api/quotes/[id]/reprice/route.ts
import { NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotes/:id/reprice
 * Body: { length_in, width_in, height_in, material_id, qty, cavities[], round_to_bf }
 * -> returns calc json (does not write)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const quoteId = parseInt(params.id, 10);
  if (!Number.isFinite(quoteId)) return NextResponse.json({ ok: false, error: "Bad id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { length_in, width_in, height_in, material_id, qty = 1, cavities = [], round_to_bf = 0.10 } = body || {};
  if (!(length_in && width_in && height_in && material_id)) {
    return NextResponse.json({ ok: false, error: "length_in, width_in, height_in, material_id are required" }, { status: 400 });
  }

  const calc = await one<{ j: any }>(
    `SELECT public.calc_foam_quote($1,$2,$3,$4,$5,$6::jsonb,$7) AS j`,
    [length_in, width_in, height_in, material_id, qty, JSON.stringify(cavities ?? []), round_to_bf]
  );

  return NextResponse.json({ ok: true, quote_id: quoteId, calc: calc?.j ?? null });
}
