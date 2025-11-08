// app/api/hubspot/lookupEmail/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot lookupEmail endpoint
 * Used by webhook/orchestrate to identify sender email from inbound message
 * Returns: { ok: true, email, status: 200 }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Try to extract the sender email from different possible shapes
    const email =
      body?.message?.from?.email ||
      body?.object?.message?.from?.email ||
      body?.email ||
      null;

    if (!email) {
      console.log("[lookupEmail] missing email in body", body);
      return NextResponse.json({ ok: false, status: 400, error: "missing_email" });
    }

    console.log("[lookupEmail] returning sender email", email);
    return NextResponse.json({ ok: true, status: 200, email });
  } catch (err: any) {
    console.error("[lookupEmail] error", err);
    return NextResponse.json({
      ok: false,
      status: 500,
      error: err.message ?? "unknown_error",
    });
  }
}
