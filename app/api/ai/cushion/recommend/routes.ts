// app/api/ai/cushion/recommend/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Simple heuristic recommender. We’ll wire this to your cushion-curve
 * DB later; for now it returns a consistent, test-friendly shape.
 *
 * INPUT (examples):
 *  {
 *    "dims": { "L":12, "W":9, "H":2, "units":"in" },
 *    "weight_lb": 8,               // optional
 *    "drop_height_in": 24,         // optional
 *    "fragility": "low|med|high"   // optional
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
      fragility?: "low" | "med" | "high";
    }>;

    const dims = body?.dims;
    if (!dims) {
      return NextResponse.json(
        { ok: false, error: "dims required" },
        { status: 400 }
      );
    }
    const u = (dims.units ?? "in") as Units;
    const L = toInches(Number(dims.L || 0), u);
    const W = toInches(Number(dims.W || 0), u);
    const H = toInches(Number(dims.H || 0), u);
    if (!(L > 0 && W > 0 && H > 0)) {
      return NextResponse.json(
        { ok: false, error: "invalid dims" },
        { status: 400 }
      );
    }

    // Heuristic density choice
    const weight = Number(body.weight_lb ?? 5);
    const drop = Number(body.drop_height_in ?? 24);
    const frag = body.fragility ?? "med";

    // Rough heuristic:
    // - heavier or higher drop or "high" fragility pushes density upward.
    let score = 0;
    score += Math.min(3, Math.max(0, weight / 10)); // 0..3
    score += Math.min(2, Math.max(0, drop / 24 - 1)); // 0..2
    if (frag === "high") score += 2;
    else if (frag === "med") score += 1;

    let density_pcf = 1.7;
    if (score >= 4.5) density_pcf = 4.0;
    else if (score >= 2.5) density_pcf = 2.2;

    // Return a few candidate materials in ascending price order (placeholder ids)
    const candidates = [
      { id: 59, name: "EPE 1.7# White", density_pcf: 1.7, price_per_bf: 28, min_charge: 5 },
      { id: 60, name: "EPE 2.2# Black", density_pcf: 2.2, price_per_bf: 34, min_charge: 5 },
      { id: 71, name: "EPE 4.0#",       density_pcf: 4.0, price_per_bf: 45, min_charge: 10 },
    ].sort((a,b)=>a.price_per_bf-b.price_per_bf);

    const resp = {
      ok: true,
      status: 200,
      hasHints: true,
      recommended_density_pcf: density_pcf,
      candidates,
      diag: {
        dims_in: { L, W, H },
        weight_lb: weight,
        drop_height_in: drop,
        fragility: frag,
      }
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
