// app/api/ai/price/route.ts
// Simple pricing stub — returns a consistent estimate.
// Swap internals later to call your DB if desired.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Slots = {
  internal_length_in?: number;
  internal_width_in?: number;
  internal_height_in?: number;
  thickness_under_in?: number;
  cavities?: number;
  qty?: number;
  density_lbft3?: number;
  foam_material_id?: number;
};

export async function POST(req: NextRequest) {
  try {
    const { slots } = await req.json() as { slots: Slots };
    const L = slots.internal_length_in!;
    const W = slots.internal_width_in!;
    const H = slots.internal_height_in!;
    const U = slots.thickness_under_in!;
    const C = slots.cavities ?? 1;
    const Q = slots.qty ?? 1;

    if (![L,W,H,U].every(n => Number.isFinite(n))) {
      return NextResponse.json({ ok:false, error:"missing dims" }, { status:400 });
    }

    // Board-foot-ish / cubic-inch estimate with simple coefficients.
    // (Replace later with your real function.)
    const ciCore = (L * W * H) * C;         // cavity volume
    const ciUnder = (L * W * U);            // under-pad
    const ciTotal = ciCore + ciUnder;

    const kerfPct = Number(process.env.PRICE_KERF_PCT ?? "10"); // percent
    const minCharge = Number(process.env.PRICE_MIN_CHARGE ?? "0");
    const perCI = Number(process.env.PRICE_PER_CI ?? "0.0025"); // $/ci baseline

    const ciWithKerf = ciTotal * (1 + kerfPct/100);
    const unitPrice = Math.max(minCharge, ciWithKerf * perCI);
    const total = unitPrice * Q;

    return NextResponse.json({
      ok: true,
      unitPrice,
      total,
      kerfPct,
      minCharge,
      materialName: `Material ${slots.foam_material_id ?? "PE"}`,
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message ?? "unknown" }, { status:500 });
  }
}
