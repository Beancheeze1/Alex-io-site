// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { objectId, messageId } = await req.json();
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId" }, { status: 400 });
    }

    const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!HUBSPOT_ACCESS_TOKEN) {
      return NextResponse.json({ ok: false, error: "missing HubSpot token" }, { status: 500 });
    }

    // HubSpot Conversations API endpoint
    const baseUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`;
    const headers = {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    };

    // Fetch thread details
    const threadRes = await fetch(baseUrl, { headers });
    if (!threadRes.ok) {
      const body = await threadRes.text();
      return NextResponse.json({
        ok: false,
        status: threadRes.status,
        error: "hubspot_thread_fetch_failed",
        body,
      });
    }

    const data = await threadRes.json();
    let email = "";
    let subject = "";
    let text = "";
    let internetMessageId = "";
    const pickedKeys: string[] = [];

    // --- Deep Chooser Logic ---
    // 1. Try direct thread fields
    if (data.subject) {
      subject = data.subject;
      pickedKeys.push("subject=direct/deep");
    }

    // 2. Messages (conversation items)
    const messages = data.messages || [];
    for (const msg of messages) {
      if (!email && msg?.participants?.length) {
        const p = msg.participants.find((x: any) => x?.role === "CUSTOMER" && x?.email);
        if (p?.email) {
          email = p.email;
          pickedKeys.push("email=deep/chooser");
        }
      }

      if (!text && msg.text) {
        text = msg.text;
        pickedKeys.push("text=messages");
      }

      // Try to capture Message-ID if present
      if (!internetMessageId && msg.metadata?.["internetMessageId"]) {
        internetMessageId = msg.metadata["internetMessageId"];
        pickedKeys.push("internetMessageId=metadata");
      }
    }

    return NextResponse.json({
      ok: true,
      threadId: objectId,
      email,
      subject,
      text,
      internetMessageId,
      src: { pickedKeys },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
