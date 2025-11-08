// app/api/admin/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ephemeral but easy: swap to DB later without changing the API.
const FILE = path.join(os.tmpdir(), "alexio_admin_settings.json");

type Settings = {
  skive_upcharge_each?: number; // $ per piece when thickness not in 1" increments
  ratePerCI?: number;           // fallback CI rate (if DB not used)
  ratePerBF?: number;           // fallback BF rate (if DB not used)
  kerf_pct_default?: number;    // default kerf if not provided
  min_charge_default?: number;  // default min per piece
  cushion_family_order?: string[]; // optional preference order e.g., ["PE","EPE","PU"]
};

async function readSettings(): Promise<Settings> {
  try {
    const txt = await fs.readFile(FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return {
      skive_upcharge_each: 3,
      ratePerCI: 0.06,
      ratePerBF: 34,
      kerf_pct_default: 0,
      min_charge_default: 0,
      cushion_family_order: ["PE","EPE","PU","EVA"],
    };
  }
}
async function writeSettings(s: Settings) {
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), "utf8");
}

export async function GET() {
  const settings = await readSettings();
  return NextResponse.json({ ok: true, settings }, { status: 200 });
}

export async function PUT(req: NextRequest) {
  try {
    const incoming = (await req.json()) as Partial<Settings>;
    const current = await readSettings();
    const next = { ...current, ...incoming };
    await writeSettings(next);
    return NextResponse.json({ ok: true, settings: next }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "bad settings" }, { status: 400 });
  }
}
