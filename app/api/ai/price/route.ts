// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PricingSettings = {
  ratePerCI_default: number;   // $/cubic inch
  ratePerBF_default: number;   // $/board-foot; when >0 we derive CI = BF / 1728
  kerf_pct_default: number;    // +% waste
  min_charge_default: number;  // minimum extended price
  skive_upcharge_each: number; // $ per piece when thickness not on 1" increments
  cushion_family_order?: string[]; // optional, kept in sync with admin route
};

function settings(): PricingSettings {
  const key = "__ALEXIO_PRICING_SETTINGS__";
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = {
      ratePerCI_default: 0.06,
      ratePerBF_default: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      skive_upcharge_each: 4.5,
      cushion_family_order: ["EPE", "PU", "PE", "EVA"],
    } satisfies PricingSettings;
  }
  const s = g[key] as PricingSettings;
  // If BF is defined, derive CI for runtime use
  if (s.ratePerBF_default && s.ratePerBF_default > 0) {
    s.ratePerCI_default = s.ratePerBF_default / 1728;
  }
  return s;
}

type Units = "in" | "mm";
const MM_PER_IN = 25.4;

function toInches(v: number, units: Units): number {
  return units === "mm" ? v / MM_PER_IN : v;
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

function nearlyInteger(n: number, tol = 1e-6) {
  return Math.abs(n - Math.round(n)) <= tol;
}

export async function POST(req: NextRequest) {
  try {
    const s = settings();

    type Dim = { L: number; W: number; H: number; units?: Units };
    type Cavity = { L: number; W: number; H: number; count?: number; units?: Units };

    const body = (await req.json()) as Partial<{
      dims: Dim;      // required
      qty: number;    // required
      units: Units;   // optional (fallback if dims.units not set)
      ratePerCI?: number;
      ratePerBF?: number;
      kerf_pct?: number;
      min_charge?: number;
      cavities?: Cavity[];
      round_to_bf?: boolean;
      materialId?: number | string;
    }>;

    if (!body?.dims || typeof body.qty !== "number") {
      return NextResponse.json({ ok: false, error: "dims and qty are required" }, { status: 400 });
    }

    const topUnits: Units | undefined = body.units;
    const dimsUnits: Units = (body.dims.units ?? topUnits ?? "in") as Units;

    const L_in = toInches(Number(body.dims.L || 0), dimsUnits);
    const W_in = toInches(Number(body.dims.W || 0), dimsUnits);
    const H_in = toInches(Number(body.dims.H || 0), dimsUnits);

    const qty = Math.max(0, Math.floor(Number(body.qty)));
    if (!(L_in > 0 && W_in > 0 && H_in > 0 && qty > 0)) {
      return NextResponse.json({ ok: false, error: "invalid numeric dims or qty <= 0" }, { status: 400 });
    }

    // Cavities
    const cavities = Array.isArray(body.cavities) ? body.cavities : [];
    let cavities_ci_total = 0;
    for (const c of cavities) {
      if (!c) continue;
      const cu: Units = (c.units ?? dimsUnits) as Units;
      const cL = toInches(Number(c.L || 0), cu);
      const cW = toInches(Number(c.W || 0), cu);
      const cH = toInches(Number(c.H || 0), cu);
      const count = Math.max(0, Math.floor(Number(c.count || 1)));
      if (cL > 0 && cW > 0 && cH > 0 && count > 0) {
        cavities_ci_total += cL * cW * cH * count;
      }
    }

    // Base volumes
    const piece_ci = L_in * W_in * H_in;
    const piece_ci_after_cavities = Math.max(0, piece_ci - cavities_ci_total);

    // Kerf/waste
    const kerf_pct = Number(body.kerf_pct ?? s.kerf_pct_default ?? 0);
    const piece_ci_with_waste = piece_ci_after_cavities * (1 + Math.max(0, kerf_pct) / 100);

    // Rate per CI
    let ratePerCI = Number(body.ratePerCI);
    if (!(ratePerCI > 0)) {
      const bf = Number(body.ratePerBF ?? s.ratePerBF_default ?? 0);
      ratePerCI = bf > 0 ? bf / 1728 : (s.ratePerCI_default ?? 0.06);
    }

    // Skive upcharge if thickness not 1" increments
    const needsSkive = !nearlyInteger(H_in);
    const skive_each = needsSkive ? (s.skive_upcharge_each ?? 0) : 0;

    // Price
    const each_material = piece_ci_with_waste * ratePerCI;
    const each = each_material + skive_each;
    let extended = each * qty;

    // Min charge
    const minCharge = Number(body.min_charge ?? s.min_charge_default ?? 0);
    if (extended < minCharge) extended = minCharge;

    const resp = {
      ok: true,
      status: 200,
      dims_ci: roundCurrency(piece_ci),
      cavity_ci_total: roundCurrency(cavities_ci_total),
      piece_ci_with_waste: roundCurrency(piece_ci_with_waste),
      kerf_pct,
      ratePerCI: roundCurrency(ratePerCI),
      each_material: roundCurrency(each_material),
      skive_each: roundCurrency(skive_each),
      each: roundCurrency(each),
      qty,
      extended: roundCurrency(extended),
      applied: {
        needsSkive,
        minChargeApplied: extended === minCharge && extended > 0,
      },
      diag: {
        units_used: dimsUnits,
        round_to_bf: !!body.round_to_bf,
      },
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
