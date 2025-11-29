// app/api/cushion/curves/[material_id]/route.ts
//
// Read-only cushion curve lookup for a single material_id.
// URL: /api/cushion/curves/[material_id]
// NOTE: We *do not* rely on Next.js params here; instead we parse
// the material_id from the URL path to avoid any [material-id] vs
// [material_id] / array / typing issues.

import { NextRequest, NextResponse } from "next/server";
import { one, q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}

function bad(msg: string, detail?: any, status = 400) {
  return NextResponse.json({ ok: false, error: msg, detail }, { status });
}

export async function GET(req: NextRequest) {
  // Example path: /api/cushion/curves/223
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // ... ["api", "cushion", "curves", "223"]
  const rawId = segments[segments.length - 1] ?? "";
  const materialId = Number(rawId);

  if (!Number.isFinite(materialId) || materialId <= 0) {
    return bad("invalid_material_id", { material_id: rawId });
  }

  try {
    const material = await one<{
      id: number;
      name: string;
      material_family: string | null;
    }>(
      `
      SELECT id, name, material_family
      FROM materials
      WHERE id = $1
      `,
      [materialId],
    );

    if (!material) {
      return bad("material_not_found", { material_id: materialId }, 404);
    }

    const rows = await q<{
      static_psi: string | number;
      deflect_pct: string | number;
      g_level: string | number;
      source: string | null;
    }>(
      `
      SELECT static_psi, deflect_pct, g_level, "source"
      FROM cushion_curves
      WHERE material_id = $1
      ORDER BY g_level ASC, static_psi ASC
      `,
      [materialId],
    );

    const points = (rows || [])
      .map((r) => ({
        static_psi: Number(r.static_psi),
        deflect_pct: Number(r.deflect_pct),
        g_level: Number(r.g_level),
        source: r.source ?? null,
      }))
      .filter(
        (p) =>
          Number.isFinite(p.static_psi) &&
          Number.isFinite(p.deflect_pct) &&
          Number.isFinite(p.g_level),
      );

    return ok({
      material,
      points,
      point_count: points.length,
    });
  } catch (err: any) {
    console.error("cushion-curves GET error:", err);
    return bad(
      "cushion_curves_exception",
      { message: String(err?.message || err) },
      500,
    );
  }
}
