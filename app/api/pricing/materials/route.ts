// app/api/pricing/materials/route.ts
import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await q(`
    SELECT id, name,
           per_cu_in, per_bf, per_cu_ft,
           kerf_waste_pct, min_charge_usd
    FROM public.v_material_prices
    ORDER BY name
  `);
  return NextResponse.json({ ok: true, count: rows.length, materials: rows });
}
