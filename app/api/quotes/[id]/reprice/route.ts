// app/api/quotes/[id]/reprice/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
  ctx: { params: { id?: string } }
) {
  try {
    const raw = ctx.params?.id ?? "";
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return json(400, { ok: false, error: "Bad id" });
    }

    const pool = getPool();

    // Fetch quote + tenant_id together so reprice uses correct tenant settings
    const q = await pool.query(
      `select id, tenant_id from quotes where id = $1`,
      [id]
    );
    if (q.rowCount === 0) {
      return json(404, { ok: false, error: "Quote not found" });
    }
    const tenantId: number | string = q.rows[0]?.tenant_id ?? "default";

    // Fetch all non-packaging, non-layout-layer items to reprice
    const items = await pool.query(
      `select id, length_in, width_in, height_in, material_id, qty, notes
         from quote_items
        where quote_id = $1`,
      [id]
    );

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const calcUrl = `${base}/api/quotes/calc`;

    let updated = [] as any[];
    let skipped = [] as any[];

    for (const r of items.rows) {
      // Skip packaging and layout-layer reference rows — they are not priced via calc
      const notes = String(r.notes || "").toUpperCase();
      if (notes.includes("[LAYOUT-LAYER]") || notes.includes("[PACKAGING]")) {
        skipped.push(r.id);
        continue;
      }

      const L = Number(r.length_in);
      const W = Number(r.width_in);
      const H = Number(r.height_in);
      const qty = Number(r.qty);
      const material_id = Number(r.material_id);

      if (!(L > 0 && W > 0 && H > 0 && qty > 0 && material_id > 0)) {
        skipped.push(r.id);
        continue;
      }

      // Non-whole-inch height triggers skiving via calc route
      const resp = await fetch(calcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          length_in: L,
          width_in: W,
          height_in: H,
          material_id,
          qty,
          cavities: [],
          round_to_bf: false,
          tenant_id: tenantId,
        }),
      }).catch(() => null);

      if (!resp?.ok) {
        skipped.push(r.id);
        continue;
      }

      const j = await resp.json().catch(() => null);
      const price_total = Number(j?.result?.total ?? 0);
      const price_unit = qty > 0 ? price_total / qty : 0;

      if (!(price_total >= 0)) {
        skipped.push(r.id);
        continue;
      }

      await pool.query(
        `update quote_items
            set price_unit_usd  = $1,
                price_total_usd = $2,
                calc_snapshot   = $3,
                updated_at      = now()
          where id = $4`,
        [price_unit, price_total, j?.result ?? {}, r.id]
      );

      updated.push({ id: r.id, price_unit_usd: price_unit, price_total_usd: price_total });
    }

    return json(200, { ok: true, updated, skipped });
  } catch (err: any) {
    console.error("reprice POST error:", err);
    return json(500, { ok: false, error: "Server error" });
  }
}