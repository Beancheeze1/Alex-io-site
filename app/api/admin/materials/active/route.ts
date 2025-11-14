// app/api/admin/materials/active/route.ts
import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const rows = await q<{
    id: number;
    name: string;
    category: string | null;
    subcategory: string | null;
    density_lb_ft3: number | null;
    kerf_pct: number | null;
    min_charge: number | null;
    active: boolean;
  }>(`
    SELECT id, name, category, subcategory, density_lb_ft3, kerf_pct, min_charge, active
    FROM materials
    WHERE active = true
    ORDER BY name ASC
    LIMIT 50
  `);
  return NextResponse.json({ ok: true, materials: rows }, { status: 200 });
}
