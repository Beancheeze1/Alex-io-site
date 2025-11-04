// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ----------
// Helpers
// ----------
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

type LookupRequest = {
  objectId?: string | number;
  messageId?: string | number;
  threadId?: string | number;
};

// ----------
// Main handler
// ----------
export async function POST(req: Request) {
  const start = Date.now();

  try {
    const HUBSPOT_REFRESH_TOKEN = process.env.HUBSPOT_REFRESH_TOKEN;
    const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
    const HUBSPOT_SKIP_LOOKUP = process.env.HUBSPOT_SKIP_LOOKUP;

    if (!HUBSPOT_REFRESH_TOKEN && !HUBSPOT_ACCESS_TOKEN) {
      console.error("[lookup] missing HubSpot token");
      return NextResponse.json({ ok: false, error: "missing HubSpot token" }, { status: 500 });
    }

    const body = await req.json();
    const { objectId, messageId, threadId } = body as LookupRequest;

    // Determine which ID to use
    const targetId =
      threadId || objectId || messageId;
    if (!targetId) {
      return NextResponse.json(
        { ok: false, error: "missing objectId/threadId" },
        { status: 400 }
      );
    }

    console.log("[lookup] start", { targetId, body });

    // Skip actual API fetch for dry runs or local testing
    if (HUBSPOT_SKIP_LOOKUP === "1" || HUBSPOT_SKIP_LOOKUP === "true") {
      console.log("[lookup] skip flag active");
      return NextResponse.json({
        ok: true,
        threadId: targetId,
        email: "25thhourdesign@gmail.com",
        subject: "test",
        text: "test",
        src: "@{email=deep/chooser; subject=direct/deep; text=messages}",
        ms: Date.now() - start,
      });
    }

    const token = HUBSPOT_ACCESS_TOKEN || HUBSPOT_REFRESH_TOKEN;
    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${targetId}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[lookup] hubspot 404", text);
      return NextResponse.json(
        {
          ok: false,
          error: "hubspot_thread_fetch_failed",
          status: res.status,
          body: text,
        },
        { status: 404 }
      );
    }

    const data = await res.json();

    // Deep extraction logic
    const participants =
      data?.messages?.flatMap((m: any) => m.participants || []) || [];
    const fromEmail =
      participants.find((p: any) => p.role === "HUBSPOT_VISITOR")?.email ||
      participants[0]?.email ||
      null;

    const messages = data?.messages || [];
    const lastMsg = messages[messages.length - 1] || {};
    const subject =
      lastMsg.subject ||
      data?.thread?.subject ||
      "No subject found";
    const text =
      lastMsg.text ||
      lastMsg.body ||
      "No message body";

    console.log("[lookup] extracted", { fromEmail, subject, text });

    return NextResponse.json(
      {
        ok: true,
        email: fromEmail,
        subject,
        text,
        threadId: targetId,
        src: "@{email=deep/chooser; subject=direct/deep; text=messages}",
        ms: Date.now() - start,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[lookup] exception", err);
    return NextResponse.json(
      { ok: false, error: err.message || "unknown" },
      { status: 500 }
    );
  }
}
