// app/api/products/price/route.ts
import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/products/price?sku=FOAM-BLK-VALVE
 */
export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const { searchParams } = new URL(req.url);
  const sku = searchParams.get("sku");
  if (!sku) return NextResponse.json({ ok: false, error: "Missing ?sku" }, { status: 400 });

  const row = await one(`
    SELECT *
    FROM public.v_product_pricing
    WHERE sku = $1
  `, [sku]);

  if (!row) return NextResponse.json({ ok: false, error: "SKU not found" }, { status: 404 });

  return NextResponse.json({ ok: true, price: row });
}
