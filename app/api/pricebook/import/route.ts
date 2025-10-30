// app/api/pricebook/import/route.ts
import { NextResponse } from "next/server";
import { withTxn } from "@/lib/db";
import { PriceBook } from "@/lib/pricebook/schema";
import {
  UPSERT_MATERIAL,
  UPSERT_CAVITY,
  UPSERT_RULE,
  UPSERT_PRODUCT,
} from "@/lib/pricebook/sql";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PriceBook.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, issues: parsed.error.format() }, { status: 422 });
  }
  const pb = parsed.data;

  try {
    await withTxn(async (client) => {
      // materials
for (const m of pb.tables.materials) {
  await client.query(UPSERT_MATERIAL, [
    m.id,                               // material_uid
    m.name,
    m.density_lb_ft3 ?? null,
    m.supplier_code ?? null,
  ]);
}
      // price_rules
for (const r of pb.tables.price_rules) {
  await client.query(UPSERT_RULE, [
    r.id,                               // rule_uid
    r.applies_to ?? null,
    r.metric ?? null,
    r.formula ?? null,
  ]);
}
      // upsert cavities
      for (const c of pb.tables.cavities) {
        await client.query(UPSERT_CAVITY, [c.id, c.shape, JSON.stringify(c.dims ?? {}), c.volume_ci, c.notes ?? null]);
      }
      // upsert products
      for (const p of pb.tables.products) {
        await client.query(UPSERT_PRODUCT, [
          p.id,
          p.sku,
          p.description ?? null,
          JSON.stringify(p.dims),
          p.volume_ci,
          p.material_ref ?? null,
          p.rule_ref ?? null,
        ]);
      }
    });

    const counts = {
      materials: pb.tables.materials.length,
      cavities: pb.tables.cavities.length,
      price_rules: pb.tables.price_rules.length,
      products: pb.tables.products.length,
    };
    return NextResponse.json({ ok: true, version: pb.version, currency: pb.currency, counts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
