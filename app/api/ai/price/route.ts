// app/api/ai/price/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Input:
 * {
 *   dims: { L:number|string, W:number|string, H:number|string, units?: "in"|"mm" },
 *   qty: number|string,
 *   // Either (A) pass explicit rates/kerf/minCharge OR (B) your orchestrator feeds DB-derived values later
 *   ratePerCI?: number|string,
 *   ratePerBF?: number|string,
 *   kerf_pct?: number|string,
 *   min_charge?: number|string,
 *   round_to_bf?: boolean|string,
 *
 *   // NEW — subtract cavities from volume
 *   cavities?: Array<{ L:number|string, W:number|string, H:number|string, count?: number|string, units?: "in"|"mm" }>,
 *
 *   // NEW — skiving upcharge when H not a multiple of 1"
 *   skive_upcharge_each?: number|string  // if absent, falls back to admin setting
 * }
 *
 * Output: { ok, status, pricingUsedDb:false, pricing:{ ...normalized... } }
 */

function N(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[, ]+/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
const mm2in = (mm: number) => mm / 25.4;
const r2 = (x: number) => Math.round(x * 100) / 100;

function toInchesDim(d: any) {
  if (!d) return undefined;
  let L = N(d.L), W = N(d.W), H = N(d.H);
  if (d.units === "mm") {
    if (L !== undefined) L = mm2in(L);
    if (W !== undefined) W = mm2in(W);
    if (H !== undefined) H = mm2in(H);
  }
  if (L == null || W == null || H == null) return undefined;
  return { L, W, H };
}

function cavitiesVolumeIn3(cavs?: any[]): number {
  if (!Array.isArray(cavs) || cavs.length === 0) return 0;
  let sum = 0;
  for (const c of cavs) {
    const d = toInchesDim(c);
    if (!d) continue;
    const count = N(c.count) ?? 1;
    sum += (d.L as number) * (d.W as number) * (d.H as number) * count;
  }
  return sum;
}

async function readAdminSettings() {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "https://api.alex-io.com"}/api/admin/settings?t=${Date.now()}`, { cache: "no-store" });
    const j = await r.json();
    return j?.settings || {};
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const dims = toInchesDim(body?.dims);
    const qty = N(body?.qty) ?? 1;
    if (!dims) {
      return NextResponse.json({ ok: false, status: 400, error: "Missing or invalid dims" }, { status: 400 });
    }

    // Base rates & factors (can be overridden by DB/orchestrator)
    const ratePerCI = N(body?.ratePerCI);       // fallback set below
    const ratePerBF = N(body?.ratePerBF);
    const kerf_pct  = N(body?.kerf_pct) ?? 0;
    const min_charge = N(body?.min_charge) ?? 0;
    const round_to_bf = String(body?.round_to_bf ?? "").toLowerCase() === "true" || body?.round_to_bf === true;

    // Cavities
    const cavVol = cavitiesVolumeIn3(body?.cavities);
    // Gross piece volume
    const gross_ci = (dims.L as number) * (dims.W as number) * (dims.H as number);
    // Net volume
    const net_ci = Math.max(0, gross_ci - cavVol);
    const billable_ci = r2(net_ci * (1 + kerf_pct / 100));

    // Skiving upcharge (if H not multiple of 1")
    const settings = await readAdminSettings();
    const skive_upcharge_each =
      N(body?.skive_upcharge_each) ??
      N(settings?.skive_upcharge_each) ??
      3; // $3 default placeholder

    const thicknessIsWhole = Math.abs((dims.H as number) - Math.round(dims.H as number)) < 1e-6;
    const applySkive = !thicknessIsWhole;

    // Calculate each price
    let each_calc: number;
    let basis: "CI" | "BF" = "CI";
    if (round_to_bf) {
      basis = "BF";
      const piece_bf = billable_ci / 144;
      const rbf = ratePerBF ?? N(settings?.ratePerBF) ?? 34; // fallback example
      each_calc = piece_bf * rbf;
    } else {
      basis = "CI";
      const rci = ratePerCI ?? N(settings?.ratePerCI) ?? 0.06; // fallback example
      each_calc = billable_ci * rci;
    }

    // Min charge then skive upcharge
    let each = Math.max(each_calc, min_charge);
    if (applySkive && skive_upcharge_each) each += skive_upcharge_each;

    const extended = r2(each * qty);

    const pricing = {
      basis: { type: basis, ratePerCI: basis === "CI" ? (ratePerCI ?? N(settings?.ratePerCI) ?? 0.06) : undefined,
                        ratePerBF: basis === "BF" ? (ratePerBF ?? N(settings?.ratePerBF) ?? 34) : undefined },
      qty,
      dims_in: { L: dims.L, W: dims.W, H: dims.H },
      volume: {
        gross_ci: r2(gross_ci),
        cavities_ci: r2(cavVol),
        net_ci: r2(net_ci),
        kerf_pct,
        billable_ci,
        board_feet: r2(billable_ci / 144),
      },
      unitPrice: {
        calc_before_min: r2(each_calc),
        min_charge,
        skive_upcharge_each: applySkive ? skive_upcharge_each : 0,
        each: r2(each),
      },
      totals: { extended },
      notes: applySkive ? "Includes skiving upcharge (thickness not 1\" increment)" : undefined,
    };

    return NextResponse.json({ ok: true, status: 200, pricingUsedDb: false, pricing }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, status: 500, error: e?.message || "price calculation error" }, { status: 500 });
  }
}
