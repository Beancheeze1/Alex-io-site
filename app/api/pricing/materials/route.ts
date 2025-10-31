// app/api/pricing/materials/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export async function GET() {
  try {
    const rows = await q(`
      SELECT id, name,
             per_cu_in, per_bf, per_cu_ft,
             kerf_waste_pct, min_charge_usd
      FROM public.v_material_prices
      ORDER BY name
    `);
    return NextResponse.json({ ok: true, count: rows.length, materials: rows });
  } catch (err: any) {
    // Surface the error so your curl shows it (instead of a blank 500)
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
