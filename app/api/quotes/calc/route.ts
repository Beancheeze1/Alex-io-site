// app/api/quotes/calc/route.ts
import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
  material_id: number | string;
  qty: number | string;
  cavities?: string[] | null;   // e.g., ["3x1x0.5", "Ø6x1"]  (server will ignore unknown forms)
  round_to_bf?: boolean;        // whether to round price using board-foot logic
};

function bad(msg: string, detail?: any, code = 400) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status: code });
}
function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  // Lightweight help so your header probe gets 200 OK
  return ok({
    usage: "POST JSON to this endpoint to run calc_foam_quote()",
    expects: {
      length_in: "number",
      width_in: "number",
      height_in: "number",
      material_id: "integer",
      qty: "integer",
      cavities: "string[] (optional) e.g. ['2x3x0.5','Ø6x1']",
      round_to_bf: "boolean (optional)",
    },
    example: {
      length_in: 12,
      width_in: 12,
      height_in: 3,
      material_id: 1,
      qty: 250,
      cavities: ["Ø6x1"],
      round_to_bf: false,
    },
  });
}

export async function POST(req: NextRequest) {
  let body: In;
  try {
    body = (await req.json()) as In;
  } catch {
    return bad("invalid_json");
  }

  const length_in = num(body.length_in);
  const width_in = num(body.width_in);
  const height_in = num(body.height_in);
  const qty = num(body.qty);
  const material_id = num(body.material_id);
  const round_to_bf = !!body.round_to_bf;

  if (length_in == null || width_in == null || height_in == null) {
    return bad("missing_or_bad_dimensions", { length_in, width_in, height_in });
  }
  if (material_id == null) return bad("missing_or_bad_material_id");
  if (qty == null) return bad("missing_or_bad_qty");

  // Cavities are optional. If provided, ensure string[]
  const cavities =
    Array.isArray(body.cavities) && body.cavities.length
      ? body.cavities.map((s) => String(s))
      : null;

  try {
    // Call your DB function. If your function expects text[] for cavities,
    // this signature will work. If cavities are null, we pass NULL.
    const row = await one<any>(
      `
      SELECT * FROM calc_foam_quote(
        $1::numeric,   -- length_in
        $2::numeric,   -- width_in
        $3::numeric,   -- height_in
        $4::integer,   -- material_id
        $5::integer,   -- qty
        $6::text[],    -- cavities (nullable)
        $7::boolean    -- round_to_bf
      );
      `,
      [length_in, width_in, height_in, material_id, qty, cavities, round_to_bf]
    );

    if (!row) return bad("no_result_from_function");

    return ok({
      input: { length_in, width_in, height_in, material_id, qty, cavities, round_to_bf },
      result: row, // includes your function's computed fields (bf, ci, waste, price, etc.)
    });
  } catch (e: any) {
    // Surface PG error text without leaking internals
    const msg = String(e?.message || e);
    return bad("db_error", { message: msg }, 500);
  }
}
