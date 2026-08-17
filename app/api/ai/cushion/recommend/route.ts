// app/api/ai/cushion/recommend/route.ts
//
// Real cushion recommender. Previously returned a hardcoded, fabricated
// candidates array (ids 59/60/71, invented prices) baked directly into
// source -- that has been removed. This now delegates to the same
// cushion_curves-backed engine as /api/foam-advisor/recommend and returns
// real catalog materials with real prices.

import { NextRequest, NextResponse } from "next/server";
import { recommendMaterials, suggestDropHeightIn } from "@/app/lib/cushion/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * INPUT (examples):
 *  {
 *    "dims": { "L":12, "W":9, "H":2, "units":"in" },
 *    "weight_lb": 8,               // optional, default 5
 *    "drop_height_in": 24,         // optional, defaults to the standard weight-based table
 *    "fragility_g_max": 60         // optional numeric G target, default 60 ("Fragile" tier ceiling)
 *  }
 */
type Units = "in" | "mm";
const MM_PER_IN = 25.4;
function toInches(n: number, u: Units) {
  return u === "mm" ? n / MM_PER_IN : n;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<{
      dims: { L: number; W: number; H: number; units?: Units };
      weight_lb?: number;
      drop_height_in?: number;
      fragility_g_max?: number;
    }>;

    const dims = body?.dims;
    if (!dims) {
      return NextResponse.json({ ok: false, error: "dims required" }, { status: 400 });
    }
    const u = (dims.units ?? "in") as Units;
    const L = toInches(Number(dims.L || 0), u);
    const W = toInches(Number(dims.W || 0), u);
    const H = toInches(Number(dims.H || 0), u);
    if (!(L > 0 && W > 0 && H > 0)) {
      return NextResponse.json({ ok: false, error: "invalid dims" }, { status: 400 });
    }

    const weightLb = Number(body.weight_lb ?? 5);
    const contactAreaIn2 = L * W;
    const fragilityGMax =
      Number.isFinite(Number(body.fragility_g_max)) && Number(body.fragility_g_max) > 0
        ? Number(body.fragility_g_max)
        : 60;
    const dropHeightIn =
      Number.isFinite(Number(body.drop_height_in)) && Number(body.drop_height_in) > 0
        ? Number(body.drop_height_in)
        : suggestDropHeightIn(weightLb);

    const { staticPsi, candidates } = await recommendMaterials({
      weightLb,
      contactAreaIn2,
      fragilityGMax,
      dropHeightIn,
    });

    const top = candidates.slice(0, 5).map((c) => ({
      id: c.material_id,
      name: c.name,
      density_pcf: c.density_lb_ft3,
      price_per_bf: c.price_per_bf,
      min_charge: c.min_charge_usd,
      g_at_operating_psi: c.g_at_operating_psi,
      meets_fragility_target: c.meets_fragility_target,
      provenance: c.curve.provenance,
    }));

    const resp = {
      ok: true,
      status: 200,
      hasHints: top.length > 0,
      recommended_density_pcf: top[0]?.density_pcf ?? null,
      candidates: top,
      diag: {
        dims_in: { L, W, H },
        weight_lb: weightLb,
        contact_area_in2: contactAreaIn2,
        static_psi: staticPsi,
        drop_height_in: dropHeightIn,
        fragility_g_max: fragilityGMax,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
