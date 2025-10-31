// app/api/quotes/[id]/reprice/route.ts
import { NextResponse } from "next/server";
import { QuoteIdParam, RepriceBody } from "@/lib/validators";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: { id: string } }
) {
  try {
    // Note: we validate id (numeric), but we don't need it for math,
    // it's mainly so the endpoint shape is consistent.
    QuoteIdParam.parse(ctx.params);
    const body = RepriceBody.parse(await req.json());

    const pool = await getPool();
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
    return NextResponse.json({ ok: true, snapshot }, { status: 200 });
  } catch (err: any) {
    const msg =
      err?.issues?.[0]?.message ||
      err?.message ||
      "Unknown error";
    const code = typeof err?.code === "string" ? err.code : undefined;
    return NextResponse.json({ ok: false, error: msg, code }, { status: 400 });
  }
}
