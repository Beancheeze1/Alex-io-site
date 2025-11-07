import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Input:
 * {
 *   dims: { L: number|string, W: number|string, H: number|string },
 *   qty: number|string,
 *   materialId?: number|string,
 *   round_to_bf?: boolean|string,
 *   units?: "in" | "mm"
 * }
 *
 * Output:
 * {
 *   ok: boolean,
 *   status: number,
 *   pricingUsedDb: boolean,
 *   pricing?: {
 *     materialName?: string,
 *     rateBasis: "BF" | "CI",
 *     ratePerCI?: number,
 *     ratePerBF?: number,
 *     kerf_pct?: number,
 *     min_charge?: number,
 *     qty: number,
 *     dims_in: { L: number, W: number, H: number },
 *     piece_ci: number,
 *     each: number,
 *     extended: number
 *   },
 *   error?: string
 * }
 */

function num(v: any): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number" && isFinite(v)) return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  const n = Number(s);
  return isFinite(n) ? n : undefined;
}

function asBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function mmToIn(v: number) {
  return v / 25.4;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const units = (String(body?.units || "in").toLowerCase() === "mm" ? "mm" : "in") as
      | "in"
      | "mm";

    let L = num(body?.dims?.L);
    let W = num(body?.dims?.W);
    let H = num(body?.dims?.H);
    const qty = num(body?.qty) ?? 1;

    if (units === "mm") {
      if (typeof L === "number") L = mmToIn(L);
      if (typeof W === "number") W = mmToIn(W);
      if (typeof H === "number") H = mmToIn(H);
    }

    if (typeof L !== "number" || typeof W !== "number" || typeof H !== "number") {
      return NextResponse.json(
        { ok: false, status: 400, error: "Missing or invalid dimensions." },
        { status: 400 }
      );
    }

    // Normalize flags (PowerShell often sends "false" as a string)
    const round_to_bf = asBool(body?.round_to_bf);

    // Optional: database material lookup can happen here.
    // For Path A minimal change, we compute from generic per-CI or per-BF if present
    // and otherwise return a safe CI-based fallback.

    const ratePerCI = num(body?.ratePerCI); // optional override
    const ratePerBF = num(body?.ratePerBF); // optional override
    const kerf_pct = num(body?.kerf_pct) ?? 0;
    const min_charge = num(body?.min_charge) ?? 0;

    // Piece volume (in^3)
    const piece_ci_raw = L * W * H;
    const piece_ci = piece_ci_raw * (1 + kerf_pct / 100);

    let each = 0;
    let rateBasis: "BF" | "CI" = "CI";

    if (round_to_bf) {
      // 1 board foot = 144 in^3
      rateBasis = "BF";
      const piece_bf = piece_ci / 144;
      const rbf = ratePerBF ?? 34; // fallback example; DB can override
      each = Math.max(min_charge, piece_bf * rbf);
    } else {
      rateBasis = "CI";
      const rci = ratePerCI ?? 0.06; // fallback example; DB can override
      each = Math.max(min_charge, piece_ci * rci);
    }

    const extended = each * qty;

    const pricing = {
      materialName: body?.materialName ?? undefined,
      rateBasis,
      ratePerCI: rateBasis === "CI" ? (ratePerCI ?? 0.06) : undefined,
      ratePerBF: rateBasis === "BF" ? (ratePerBF ?? 34) : undefined,
      kerf_pct,
      min_charge,
      qty,
      dims_in: { L, W, H },
      piece_ci,
      each,
      extended,
    };

    return NextResponse.json(
      {
        ok: true,
        status: 200,
        pricingUsedDb: false, // set true if/when you wire to DB
        pricing,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        status: 500,
        error: e?.message || "price calculation error",
      },
      { status: 500 }
    );
  }
}
