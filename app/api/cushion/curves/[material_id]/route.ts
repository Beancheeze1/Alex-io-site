// app/api/cushion/curves/[material_id]/route.ts
//
// Read-only cushion curve lookup for a single material_id.
// URL: /api/cushion/curves/[material_id]
// URL: /api/cushion/curves/[material_id]?thickness_in=2  -- optional filter,
//   used by the foam-advisor chart. Some materials now have multiple
//   digitized thicknesses AND multiple vendor curves at the SAME thickness
//   (e.g. this material's own tested 2in curve plus a proxy 2in point from a
//   different vendor's multi-thickness sheet). Without a thickness filter,
//   ALL rows are returned (raw admin view). WITH a thickness filter, only
//   the single best-provenance curve (tested > proxy > unverified) for that
//   thickness is returned, so a chart never blends two unrelated vendor
//   curves into one line.
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

  const thicknessParam = url.searchParams.get("thickness_in");
  const thicknessFilter =
    thicknessParam != null && thicknessParam.trim() !== "" ? Number(thicknessParam) : null;
  if (thicknessParam != null && (thicknessFilter == null || !Number.isFinite(thicknessFilter))) {
    return bad("invalid_thickness_in", { thickness_in: thicknessParam });
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
      deflect_pct: string | number | null;
      g_level: string | number;
      thickness_in: string | number | null;
      drop_in: string | number | null;
      provenance: string | null;
      source: string | null;
    }>(
      `
      SELECT static_psi, deflect_pct, g_level, thickness_in, drop_in, provenance, "source"
      FROM cushion_curves
      WHERE material_id = $1
      ORDER BY g_level ASC, static_psi ASC
      `,
      [materialId],
    );

    let points = (rows || [])
      .map((r) => ({
        static_psi: Number(r.static_psi),
        // deflect_pct is not present in the source charts for most rows --
        // stays null rather than being coerced to 0 by Number(null).
        deflect_pct: r.deflect_pct == null ? null : Number(r.deflect_pct),
        g_level: Number(r.g_level),
        thickness_in: r.thickness_in == null ? null : Number(r.thickness_in),
        drop_in: r.drop_in == null ? null : Number(r.drop_in),
        provenance: (r.provenance ?? null) as "tested" | "proxy" | "unverified" | "modeled" | null,
        source: r.source ?? null,
      }))
      .filter(
        (p) =>
          Number.isFinite(p.static_psi) &&
          Number.isFinite(p.g_level),
      );

    if (thicknessFilter != null) {
      points = points.filter((p) => p.thickness_in === thicknessFilter);

      // Same thickness, multiple vendor curves -- keep only the best
      // provenance so the chart shows one clean curve, not a blended mess.
      const PROVENANCE_RANK: Record<string, number> = { tested: 0, proxy: 1, unverified: 2, modeled: 3 };
      let bestProvenance: string | null = null;
      for (const p of points) {
        const rank = PROVENANCE_RANK[p.provenance ?? "unverified"] ?? 3;
        const bestRank = bestProvenance == null ? Infinity : PROVENANCE_RANK[bestProvenance] ?? 3;
        if (rank < bestRank) bestProvenance = p.provenance ?? "unverified";
      }
      if (bestProvenance != null) {
        points = points.filter((p) => (p.provenance ?? "unverified") === bestProvenance);
      }
    }

    return ok({
      material,
      points,
      point_count: points.length,
      thickness_filter_applied: thicknessFilter,
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
