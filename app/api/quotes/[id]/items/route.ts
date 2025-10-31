// app/api/quotes/[id]/items/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db"; // your existing helper

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

    const body = await req.json();
    // Minimal shape check; keep flexible
    const length_in = Number(body?.length_in);
    const width_in  = Number(body?.width_in);
    const height_in = Number(body?.height_in);
    const material_id = Number(body?.material_id);
    const qty = Number(body?.qty ?? 1);
    const cavities = Array.isArray(body?.cavities) ? body.cavities : [];

    if (
      ![length_in, width_in, height_in, material_id, qty].every(
        (n) => Number.isFinite(n) && n > 0
      )
    ) {
      return json(400, { ok: false, error: "Invalid input: expected number" });
    }

    const pool = getPool();

    // Ensure quote exists
    const q = await pool.query(`select id from quotes where id = $1`, [id]);
    if (q.rowCount === 0) {
      return json(404, { ok: false, error: "Quote not found" });
    }

    // Insert quote_item
    const ins = await pool.query(
      `
      insert into quote_items
        (quote_id, product_id, length_in, width_in, height_in, material_id, qty, created_at, updated_at)
      values
        ($1,        null,       $2,        $3,       $4,        $5,          $6,  now(),     now())
      returning id, quote_id, length_in, width_in, height_in, material_id, qty
      `,
      [id, length_in, width_in, height_in, material_id, qty]
    );
    const item = ins.rows[0];

    // Optional cavities
    if (cavities.length) {
      const text = `
        insert into quote_item_cavities
          (quote_item_id, label, count, cav_length_in, cav_width_in, cav_depth_in)
        values
          ($1, $2, $3, $4, $5, $6)
      `;
      for (const c of cavities) {
        const count = Number(c?.count ?? 1);
        const l = Number(c?.l);
        const w = Number(c?.w);
        const d = Number(c?.d);
        if ([count, l, w, d].every((n) => Number.isFinite(n) && n > 0)) {
          await pool.query(text, [item.id, String(c?.label ?? ""), count, l, w, d]);
        }
      }
    }

    return json(200, { ok: true, item });
  } catch (err: any) {
    console.error("items POST error:", err);
    return json(500, { ok: false, error: "Server error" });
  }
}
