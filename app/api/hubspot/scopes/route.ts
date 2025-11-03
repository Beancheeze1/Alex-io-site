// app/api/hubspot/scopes/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight sanity route — returns a static list for now.
 * Replace later with the real HubSpot OAuth scopes if needed.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/hubspot/scopes",
    scopes: [
      "crm.objects.contacts.read",
      "crm.objects.contacts.write",
      "crm.objects.deals.read",
      "crm.objects.deals.write",
    ],
  });
}
