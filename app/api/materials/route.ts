// app/api/materials/route.ts
import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await q(`
    SELECT id, name, density_lb_ft3, price_per_bf, price_per_cuin,
           kerf_waste_pct, min_charge_usd, active
    FROM public.materials
    ORDER BY name
  `);
  return NextResponse.json({ ok: true, materials: rows });
}
