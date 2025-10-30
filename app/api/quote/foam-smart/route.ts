// app/api/quote/foam-smart/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Accepts the same body as /api/quote/foam plus optional:
 *  - weight_lbf, area_in2, fragility_g, drop_in
 * If height_in (thickness) is missing, we auto-call /api/cushion/recommend
 * to get a suggested thickness and forward the full body to /api/quote/foam.
 *
 * Requires NEXT_PUBLIC_BASE_URL to be set (already in your project).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const hasThickness = body?.height_in != null;

    if (!hasThickness && (body?.weight_lbf && body?.area_in2)) {
      // ask cushion recommend for min thickness
      const recRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/cushion/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight_lbf: Number(body.weight_lbf),
          area_in2: Number(body.area_in2),
          thickness_in: Number(body.thickness_in) || undefined,
          fragility_g: Number(body.fragility_g) || 50,
          drop_in: Number(body.drop_in) || 24,
          overlay_count: 1,
        }),
      });
      const rec = await recRes.json();
      if (!recRes.ok) throw new Error(rec?.error || "recommend failed");

      const t = rec?.thickness_recommendation?.overall_min?.min_thickness_in;
      if (t) body.height_in = t; // treat height as foam thickness
    }

    // forward to your existing /api/quote/foam
    const quoteRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/quote/foam`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await quoteRes.json();
    if (!quoteRes.ok) throw new Error(j?.error || "quote failed");

    return NextResponse.json({ ok: true, ...j, used_auto_thickness: !hasThickness }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "foam-smart failed" }, { status: 400 });
  }
}
