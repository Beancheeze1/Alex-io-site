// app/api/quotes/[id]/reprice/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: Request,
  ctx: { params: { id?: string } }
) {
  try {
    const raw = ctx.params?.id ?? "";
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return json(400, { ok: false, error: "Bad id" });
    }

    const pool = getPool();

    // Ensure quote exists
    const q = await pool.query(`select id from quotes where id = $1`, [id]);
    if (q.rowCount === 0) {
      return json(404, { ok: false, error: "Quote not found" });
    }

    // Reprice each item using your calc_foam_quote() function
    const items = await pool.query(
      `select id, length_in, width_in, height_in, material_id, qty
         from quote_items
        where quote_id = $1`,
      [id]
    );

    let updated = [] as any[];

    for (const r of items.rows) {
      const calc = await pool.query(
        `select calc_foam_quote($1,$2,$3,$4,$5,'[]'::jsonb,0.10) as j`,
        [r.length_in, r.width_in, r.height_in, r.material_id, r.qty]
      );
      const j = calc.rows[0]?.j ?? {};
      const price_unit = Number(j?.price_unit_usd ?? 0);
      const price_total = Number(j?.price_total_usd ?? 0);

      await pool.query(
        `update quote_items
            set price_unit_usd = $1,
                price_total_usd = $2,
                calc_snapshot = $3,
                updated_at = now()
          where id = $4`,
        [price_unit, price_total, j, r.id]
      );

      updated.push({ id: r.id, price_unit_usd: price_unit, price_total_usd: price_total });
    }

    return json(200, { ok: true, updated });
  } catch (err: any) {
    console.error("reprice POST error:", err);
    return json(500, { ok: false, error: "Server error" });
  }
}
