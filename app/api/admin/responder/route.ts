// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST body: { threadId: string, text?: string, event?: unknown }
 * Requires env: HS_TOKEN=<hubspot private app or OAuth token with Conversations write>
 */
export async function POST(req: Request) {
  const { threadId, text } = await req.json().catch(() => ({} as any));

  if (!threadId) {
    return NextResponse.json({ ok: false, error: "missing-threadId" }, { status: 400 });
  }

  const token = process.env.HS_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing-HS_TOKEN" }, { status: 400 });
  }

  // Minimal Conversations message create endpoint (adjust if your portal uses a variant)
  const endpoint = `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(
    threadId
  )}/messages`;

  const payload = {
    type: "MESSAGE",
    // timestamp in the text to avoid duplicate body dedupe during tests
    text: text ?? `Alex-IO test responder ✅ ${new Date().toISOString()}`,
  };

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Unique per request to defeat idempotency/dedupe
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await r.text();
    let body: unknown = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {}

    return NextResponse.json({ ok: r.ok, status: r.status, body });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "hubspot-post-failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    note: "POST { threadId, text? } to send a reply via HubSpot Conversations.",
  });
}
