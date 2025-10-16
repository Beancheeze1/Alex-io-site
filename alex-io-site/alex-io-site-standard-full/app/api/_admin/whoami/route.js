export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { whoAmI } from "../../../../../lib/hubspot.js"; // 4x .. up to /lib

export async function GET() {
  try {
    const me = await whoAmI(); // uses HUBSPOT_ACCESS_TOKEN from env
    // hubId = your portal id
    return NextResponse.json({ ok: true, me });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
