// app/api/cushion/curves/route.ts
//
// Cushion curve lookup API
// - GET /api/cushion/curves?material_id=123
// - Returns rows from public.cushion_curves as JSON
//
// Uses only `one` from "@/lib/db" and wraps the rows in a JSON aggregate
// so we don't depend on a separate `many` helper.

import { NextRequest, NextResponse } from "next/server";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CushionCurveRow = {
  id: number;
  material_id: number;
  static_psi: string;
  deflect_pct: string;
  g_level: string;
  source: string | null;
  created_at: string;
  updated_at: string;
};

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function err(error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail }, { status: 200 });
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const materialIdParam = url.searchParams.get("material_id");

    let materialId: number | null = null;
    if (materialIdParam != null && materialIdParam.trim() !== "") {
      const n = Number(materialIdParam);
      if (!Number.isFinite(n)) {
        return err("invalid_material_id", { material_id: materialIdParam });
      }
      materialId = n;
    }

    // Use JSON aggregation so we can still call through `one`.
    const row = await one<{ items: CushionCurveRow[] }>(
      `
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', id,
            'material_id', material_id,
            'static_psi', static_psi,
            'deflect_pct', deflect_pct,
            'g_level', g_level,
            'source', "source",
            'created_at', created_at,
            'updated_at', updated_at
          )
          ORDER BY material_id, static_psi, deflect_pct
        ),
        '[]'::json
      ) AS items
      FROM cushion_curves
      WHERE ($1::int IS NULL OR material_id = $1::int);
      `,
      [materialId]
    );

    const curves: CushionCurveRow[] = (row?.items as any) ?? [];
    return ok({ curves });
  } catch (e: any) {
    console.error("cushion/curves GET error:", e);
    return err("cushion_curves_exception", String(e?.message || e));
  }
}
