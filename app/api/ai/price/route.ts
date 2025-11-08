// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Units = "in" | "mm";
type Dims = { L: number; W: number; H: number; units?: Units };
type Cavity = { L: number; W: number; H: number; count?: number; units?: Units };

type PriceInput = {
  dims: Dims;            // outside size (one unit)
  qty: number;           // # of parts
  ratePerCI?: number;    // $/cubic inch
  ratePerBF?: number;    // $/board foot (144 CI)
  min_charge?: number;   // $ each, minimum
  kerf_pct?: number;     // +% waste
  round_to_bf?: boolean; // if true, price by board foot; else by CI
  skive_upcharge_each?: number; // $ each if thickness not integer
  cavities?: Cavity[];   // subtract volume of cavities (count accounted)
};

function toInches(n: number, units?: Units) {
  if (!Number.isFinite(n)) return 0;
  return units === "mm" ? n / 25.4 : n;
}
function round2(n: number) { return Math.round(n * 100) / 100; }
function isIntegerish(n: number, tol = 1e-6) { return Math.abs(n - Math.round(n)) <= tol; }

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PriceInput;

    // --- Extract settings with safe defaults (will be overridden by admin settings on caller, if present)
    const ratePerCI = Number.isFinite(Number(body.ratePerCI)) ? Number(body.ratePerCI) : 0.06;
    const ratePerBF = Number.isFinite(Number(body.ratePerBF)) ? Number(body.ratePerBF) : 34;
    const min_charge = Number.isFinite(Number(body.min_charge)) ? Number(body.min_charge) : 0;
    const kerf_pct = Number.isFinite(Number(body.kerf_pct)) ? Number(body.kerf_pct) : 0;
    const round_to_bf = !!body.round_to_bf;
    const skive_upcharge_each = Number.isFinite(Number(body.skive_upcharge_each))
      ? Number(body.skive_upcharge_each)
      : 0; // caller may inject admin value

    if (!body?.dims || !Number.isFinite(Number(body.qty))) {
      return NextResponse.json({ ok: false, error: "dims_and_qty_required" }, { status: 400 });
    }

    const qty = Math.max(1, Number(body.qty));
    const L_in = toInches(Number(body.dims.L ?? 0), body.dims.units);
    const W_in = toInches(Number(body.dims.W ?? 0), body.dims.units);
    const H_in = toInches(Number(body.dims.H ?? 0), body.dims.units);

    if (!(L_in > 0 && W_in > 0 && H_in > 0)) {
      return NextResponse.json({ ok: false, error: "dims_invalid" }, { status: 400 });
    }

    // --- Volume for one part (CI)
    const partCI = L_in * W_in * H_in;

    // --- Subtract cavities
    let cavitiesCI = 0;
    if (Array.isArray(body.cavities)) {
      for (const c of body.cavities) {
        const cL = toInches(Number(c.L ?? 0), c.units);
        const cW = toInches(Number(c.W ?? 0), c.units);
        const cH = toInches(Number(c.H ?? 0), c.units);
        const count = Math.max(1, Number(c.count ?? 1));
        if (cL > 0 && cW > 0 && cH > 0) {
          cavitiesCI += cL * cW * cH * count;
        }
      }
      // Ensure we don't subtract more than the part
      cavitiesCI = Math.min(cavitiesCI, partCI);
    }

    // --- Net CI per part, apply kerf
    const netCI = Math.max(0, partCI - cavitiesCI);
    const netCIWithKerf = netCI * (1 + Math.max(0, kerf_pct) / 100);

    // --- Price basis
    let each = 0;
    let rateBasis: "CI" | "BF" = "CI";
    let price_per_ci = 0;
    let price_per_bf = 0;

    if (round_to_bf) {
      rateBasis = "BF";
      const boardFeet = netCIWithKerf / 144; // 144 CI per BF
      // typical rounding increment can be customized—keeping standard 2 decimals for now
      const roundedBF = Math.ceil(boardFeet * 100) / 100;
      each = roundedBF * ratePerBF;
      price_per_bf = ratePerBF;
    } else {
      rateBasis = "CI";
      each = netCIWithKerf * ratePerCI;
      price_per_ci = ratePerCI;
    }

    // --- Skive upcharge (non-integer thickness)
    if (!isIntegerish(H_in) && skive_upcharge_each > 0) {
      each += skive_upcharge_each;
    }

    // --- Min charge
    if (each < min_charge) each = min_charge;

    const extended = each * qty;

    return NextResponse.json({
      ok: true,
      basis: rateBasis,
      input: {
        dims: body.dims,
        qty,
        kerf_pct,
        round_to_bf,
        skive_upcharge_each,
        cavities: body.cavities ?? [],
        ratePerCI,
        ratePerBF,
        min_charge,
      },
      calc: {
        partCI: round2(partCI),
        cavitiesCI: round2(cavitiesCI),
        netCI: round2(netCI),
        netCIWithKerf: round2(netCIWithKerf),
        boardFeet: round2(netCIWithKerf / 144),
      },
      pricing: {
        rateBasis,
        price_per_ci,
        price_per_bf,
        each: round2(each),
        extended: round2(extended),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
