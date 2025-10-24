// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * HubSpot Webhook endpoint
 * - Handles live HubSpot subscription POSTs
 * - Supports ?dryRun=1 for health / diagnostic checks
 */

export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");

  // Dry-run mode for sanity-chain tests
  if (dryRun === "1") {
    return NextResponse.json(
      { ok: true, dryRun: true, note: "Webhook endpoint alive" },
      { status: 200 }
    );
  }

  // Parse real webhook events (HubSpot POSTs an array)
  let events: any = [];
  try {
    events = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No events in payload" },
      { status: 400 }
    );
  }

  // For now, just acknowledge receipt (HubSpot expects 200 quickly)
  return NextResponse.json(
    {
      ok: true,
      received: events.length,
      sample: events[0],
      note: "Webhook events accepted (no-op mode)",
    },
    { status: 200 }
  );
}

// HubSpot GET check (verification or render health ping)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun");

  if (dryRun === "1") {
    return NextResponse.json(
      { ok: true, dryRun: true, note: "Webhook endpoint reachable" },
      { status: 200 }
    );
  }

  return NextResponse.json(
    { ok: true, note: "GET allowed for health-checks only" },
    { status: 200 }
  );
}
