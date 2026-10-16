// app/api/portal/signout/route.ts
//
// Step 34A: signs the buyer out of the portal on this browser.
//   POST -> { ok } and clears the alexio_buyer cookie.

import { NextResponse } from "next/server";
import { clearBuyerSession } from "@/lib/buyer-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return clearBuyerSession(NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }));
}
