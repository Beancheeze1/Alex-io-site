// app/api/cushion/curves/export/route.ts
//
// Cushion curve export API
// - GET /api/cushion/curves/export?material_id=123
// - Returns CSV of public.cushion_curves
//
// Shares the same JSON-agg pattern as /api/cushion/curves so we only need `one`.

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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const materialIdParam = url.searchParams.get("material_id");

    let materialId: number | null = null;
    if (materialIdParam != null && materialIdParam.trim() !== "") {
      const n = Number(materialIdParam);
      if (!Number.isFinite(n)) {
        return new NextResponse(
          `invalid material_id: ${materialIdParam}`,
          { status: 400 }
        );
      }
      materialId = n;
    }

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

    const headerCols = [
      "id",
      "material_id",
      "static_psi",
      "deflect_pct",
      "g_level",
      "source",
      "created_at",
      "updated_at",
    ];

    const headerLine = headerCols.join(",");

    const lines = curves.map((c) => {
      const cells = [
        c.id,
        c.material_id,
        c.static_psi,
        c.deflect_pct,
        c.g_level,
        c.source ?? "",
        c.created_at,
        c.updated_at,
      ].map((v) => {
        const s = String(v ?? "");
        // Basic CSV escaping: wrap in quotes if we see comma/quote/newline
        if (/[",\n]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      });

      return cells.join(",");
    });

    const csv = [headerLine, ...lines].join("\r\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // Name includes material_id if provided for easier downloads
        "Content-Disposition": `attachment; filename="cushion_curves${
          materialId != null ? `_material_${materialId}` : ""
        }.csv"`,
      },
    });
  } catch (e: any) {
    console.error("cushion/curves/export GET error:", e);
    return new NextResponse(
      `cushion_curves_export_exception: ${String(e?.message || e)}`,
      { status: 500 }
    );
  }
}
