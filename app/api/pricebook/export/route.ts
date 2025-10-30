// app/api/pricebook/export/route.ts
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { PriceBook } from "@/lib/pricebook/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getPool();
    const [materials, cavities, rules, products] = await Promise.all([
      pool.query(`SELECT id, name, density_lb_ft3, supplier_code FROM materials ORDER BY name`),
      pool.query(`SELECT id, shape, dims, volume_ci, notes FROM cavities ORDER BY id`),
      pool.query(`SELECT id, applies_to, metric, formula FROM price_rules ORDER BY id`),
      pool.query(`SELECT id, sku, description, dims, volume_ci, material_ref, rule_ref FROM products ORDER BY sku`),
    ]);

    const manifest = {
      name: "Alex-IO Default Price Book",
      version: "1.0.0",
      currency: "USD",
      created_at: new Date().toISOString(),
      tables: {
        materials: materials.rows,
        cavities: cavities.rows.map((r) => ({ ...r, dims: r.dims ?? {} })),
        price_rules: rules.rows,
        products: products.rows,
      },
    };

    const parsed = PriceBook.safeParse(manifest);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid manifest", issues: parsed.error.format() }, { status: 500 });
    }

    return new NextResponse(JSON.stringify(parsed.data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="pricebook-${parsed.data.version}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
