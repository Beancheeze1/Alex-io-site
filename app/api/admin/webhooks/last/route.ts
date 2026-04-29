// app/api/admin/webhooks/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminOnly } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Placeholder for "last webhook" admin view.
 * Keeps build clean; you can wire this to KV/DB later.
 */
export const GET = adminOnly(async (req: NextRequest) => {
  return NextResponse.json({
    ok: true,
    route: "/api/admin/webhooks/last",
    last: null, // replace with real fetch later
    note: "Stubbed endpoint; no storage dependency.",
  });
});
