// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin responder stub.
 * GET -> quick sanity
 * POST -> echoes a minimal payload you send (safe, no external deps).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/admin/responder",
    mode: "stub",
  });
}

type EchoIn = {
  toEmail?: string;
  subject?: string;
  text?: string;
};

export async function POST(req: Request) {
  let body: EchoIn | null = null;
  try {
    body = (await req.json()) as EchoIn;
  } catch {
    // ignore parse error
  }

  return NextResponse.json({
    ok: true,
    route: "/api/admin/responder",
    received: body ?? {},
    note: "This is a stub admin responder (no external calls).",
  });
}
