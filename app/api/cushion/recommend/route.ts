// app/api/cushion/recommend/route.ts
//
// Real thickness/material recommendation, used by /api/quote/foam-smart's
// auto-thickness path. This endpoint previously did not exist at all --
// foam-smart called it and always got a 404, so auto-thickness silently
// failed on every request. This implementation is grounded in the same real
// cushion_curves-backed engine as /api/foam-advisor/recommend.
//
// Honesty constraint: most of the catalog still has exactly ONE digitized
// foam thickness per material (see cushion_curves.thickness_in). For those
// materials, "minimum thickness" means "the thickness of the closest real
// curve match that meets your fragility target" -- not a swept minimum,
// because there's no other thickness data to sweep. A handful of materials
// (currently the 2.2 PCF and ~1.7 PCF Polyethylene family) now have real
// 1-5in digitized data and get an actual swept minimum-thickness result;
// see MaterialCandidate.mode in app/lib/cushion/engine.ts. If no material
// meets the target at any thickness on file, min_thickness_in comes back
// null rather than a guessed number.

import { NextResponse } from "next/server";
import { recommendMaterials, suggestDropHeightIn } from "@/app/lib/cushion/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const weightLbf = Number(body.weight_lbf);
  const areaIn2 = Number(body.area_in2);
  const fragilityG = Number(body.fragility_g);
  const dropIn = Number(body.drop_in);

  if (!Number.isFinite(weightLbf) || weightLbf <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_weight_lbf" }, { status: 400 });
  }
  if (!Number.isFinite(areaIn2) || areaIn2 <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_area_in2" }, { status: 400 });
  }

  const fragilityGMax = Number.isFinite(fragilityG) && fragilityG > 0 ? fragilityG : 60;
  const dropHeightIn =
    Number.isFinite(dropIn) && dropIn > 0 ? dropIn : suggestDropHeightIn(weightLbf);

  try {
    const { staticPsi, candidates } = await recommendMaterials({
      weightLb: weightLbf,
      contactAreaIn2: areaIn2,
      fragilityGMax,
      dropHeightIn,
    });

    const best = candidates.find((c) => c.meets_fragility_target) ?? null;

    let thickness_recommendation;
    if (best && best.recommendation) {
      thickness_recommendation = {
        overall_min: {
          min_thickness_in: best.recommendation.recommended_thickness_in,
          basis: "multi_thickness_curve_sweep" as const,
          material_id: best.material_id,
          material_name: best.name,
          safe_static_loading_range_psi: best.recommendation.safe_static_loading_range_psi,
          recommended_bearing_area_in2: best.recommendation.recommended_bearing_area_in2,
          note:
            "min_thickness_in is a real swept minimum -- the thinnest of this material's several digitized thicknesses whose curve dips at/under your fragility target.",
        },
      };
    } else if (best) {
      thickness_recommendation = {
        overall_min: {
          min_thickness_in: best.curve.thickness_in,
          basis: "single_tested_thickness_verify" as const,
          material_id: best.material_id,
          material_name: best.name,
          g_at_operating_psi: best.g_at_operating_psi,
          note:
            "min_thickness_in is the thickness of the closest real cushion-curve match that meets your fragility target at this static load -- not a swept minimum, because only one thickness is digitized for this material.",
        },
      };
    } else {
      thickness_recommendation = {
        overall_min: {
          min_thickness_in: null,
          basis: "no_material_meets_target_at_tested_thickness" as const,
          note:
            "No cataloged material's tested curve meets your fragility target at this static load and the thickness(es) on file. Provide height_in explicitly rather than relying on an unsupported guess.",
        },
      };
    }

    return NextResponse.json({
      ok: true,
      static_psi: staticPsi,
      fragility_g_max: fragilityGMax,
      drop_height_in: dropHeightIn,
      thickness_recommendation,
      candidates: candidates.slice(0, 5),
    });
  } catch (err: any) {
    console.error("cushion/recommend error:", err);
    return NextResponse.json(
      { ok: false, error: "recommend_exception", detail: String(err?.message || err) },
      { status: 500 },
    );
  }
}
