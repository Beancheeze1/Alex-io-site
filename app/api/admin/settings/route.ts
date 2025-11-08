// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";

/**
 * GET returns current effective pricing config.
 * PATCH allows updating any of the exposed fields.
 *
 * We keep this file storage-backed (in memory / env / KV / DB).
 * If you already have a DB table for settings, swap the simple store with your DB read/write.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Very small in-process cache (restart-safe logic should live in your DB/KV)
// Replace with your existing storage to keep prior behavior.
let SETTINGS: any | null = null;

const DEFAULTS = {
  ratePerCI: 0.06,
  ratePerBF: 34,
  kerf_pct_default: 0,
  min_charge_default: 0,
  skive_upcharge_each: 4.5, // NEW surfaced (defaults to 4.50 unless you PATCH it)
  // Used by cushion logic/UI sorting — stays here for compatibility:
  cushion_family_order: [] as string[],
};

function loadDefaultsFromEnv() {
  const p = (n: string, d: number) => (Number.isFinite(Number(process.env[n])) ? Number(process.env[n]) : d);
  return {
    ...DEFAULTS,
    ratePerCI: p("ALEX_RATE_PER_CI", DEFAULTS.ratePerCI),
    ratePerBF: p("ALEX_RATE_PER_BF", DEFAULTS.ratePerBF),
    kerf_pct_default: p("ALEX_KERF_PCT", DEFAULTS.kerf_pct_default),
    min_charge_default: p("ALEX_MIN_CHARGE", DEFAULTS.min_charge_default),
    skive_upcharge_each: p("ALEX_SKIVE_UPCHARGE", DEFAULTS.skive_upcharge_each),
  };
}

export async function GET() {
  try {
    if (!SETTINGS) SETTINGS = loadDefaultsFromEnv();
    return NextResponse.json({ ok: true, settings: SETTINGS });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!SETTINGS) SETTINGS = loadDefaultsFromEnv();

    const updatable = [
      "ratePerCI",
      "ratePerBF",
      "kerf_pct_default",
      "min_charge_default",
      "skive_upcharge_each",
      "cushion_family_order",
    ] as const;

    for (const k of updatable) {
      if (k in body) {
        // shallow sanitize
        (SETTINGS as any)[k] =
          typeof (DEFAULTS as any)[k] === "number"
            ? Number(body[k])
            : Array.isArray((DEFAULTS as any)[k])
            ? Array.isArray(body[k]) ? body[k] : (SETTINGS as any)[k]
            : body[k];
      }
    }

    return NextResponse.json({ ok: true, settings: SETTINGS });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
