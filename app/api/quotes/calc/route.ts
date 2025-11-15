// app/api/quotes/calc/route.ts
import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
  material_id: number | string;
  qty: number | string;
  cavities?: string[] | null;   // e.g., ["3x2x1", "Ø6x1"]
  round_to_bf?: boolean;        // optional
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

/**
 * GET:
 *  - plain help (no params)
 *  - ?inspect=1  -> list calc_foam_quote() function signatures in DB
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("inspect")) {
    const funcs = await q<{ schema: string; name: string; args: string }>(
      `
      SELECT n.nspname AS schema,
             p.proname AS name,
             pg_get_function_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'calc_foam_quote'
      ORDER BY 1,2;
      `,
    );
    return ok({ functions: funcs });
  }

  return ok({
    usage: "POST JSON to run calc_foam_quote()",
    expects: {
      length_in: "number",
      width_in: "number",
      height_in: "number",
      material_id: "integer",
      qty: "integer",
      cavities: "string[] (optional) e.g. ['2x3x0.5','Ø6x1']",
      round_to_bf: "boolean (optional, billable board-foot step, default false)",
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

  const cavitiesArr =
    Array.isArray(body.cavities) && body.cavities.length
      ? body.cavities.map((s) => String(s))
      : null;

  // SINGLE, KNOWN-GOOD SIGNATURE:
  // calc_foam_quote(
  //   length_in numeric, width_in numeric, height_in numeric,
  //   material_id integer, qty integer,
  //   cavities text[], round_to_bf boolean
  // ) RETURNS TABLE(...)
  const sql = `
    SELECT *
    FROM calc_foam_quote(
      $1::numeric, $2::numeric, $3::numeric,
      $4::integer, $5::integer,
      $6::text[], $7::boolean
    );
  `;

  try {
    const rows = await q<any>(sql, [
      length_in,
      width_in,
      height_in,
      material_id,
      qty,
      cavitiesArr,
      round_to_bf,
    ]);

    const row = rows && rows.length > 0 ? rows[0] : null;

    return ok({
      input: {
        length_in,
        width_in,
        height_in,
        material_id,
        qty,
        cavities: cavitiesArr,
        round_to_bf,
      },
      variant_used: "text[] + boolean (7 args)",
      rowsCount: rows ? rows.length : 0,
      rows,
      result: row,
    });
  } catch (e: any) {
    return bad(
      "db_error",
      {
        message: String(e?.message || e),
        attempted_signature:
          "calc_foam_quote(numeric,numeric,numeric,integer,integer,text[],boolean)",
      },
      500,
    );
  }
}
