// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type LookupRequest = {
  objectId?: string | number;
  messageId?: string | number;
  threadId?: string | number;
};

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * Automatically get or refresh a HubSpot access token.
 * Falls back to /api/hubspot/refresh if HUBSPOT_ACCESS_TOKEN is missing or expired.
 */
async function getHubspotAccessToken(): Promise<string> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN;
  if (direct && !direct.toLowerCase().includes("missing")) {
    return direct;
  }

  const base = requireEnv("NEXT_PUBLIC_BASE_URL");
  const refreshUrl = `${base}/api/hubspot/refresh?t=${Date.now()}`;
  try {
    const res = await fetch(refreshUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = await res.json();
    if (!data.access_token) throw new Error("No access_token in refresh response");
    console.log("[lookup] refreshed HubSpot token");
    return data.access_token;
  } catch (err) {
    console.error("[lookup] token refresh error", err);
    throw new Error("HubSpot token unavailable");
  }
}

/**
 * Fetch thread info from HubSpot Conversations API.
 */
async function fetchThread(objectId: string | number, token: string) {
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`hubspot_thread_fetch_failed ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Safely extract sender, subject, and message text from a thread payload.
 */
function extractThreadInfo(threadData: any) {
  if (!threadData || !threadData.threadId) return null;

  const messages = threadData.messages || [];
  const participants = threadData.participants || [];
  const lastMsg = messages[messages.length - 1] || {};
  const senderEmail = lastMsg.from?.email ?? participants.find((p: any) => p.email)?.email ?? "";
  const subject =
    threadData.subject ??
    lastMsg.subject ??
    threadData.metadata?.subject ??
    "";
  const text =
    lastMsg.text ||
    lastMsg.message ||
    (lastMsg.richText && lastMsg.richText.replace(/<[^>]*>/g, "")) ||
    "";

  return { senderEmail, subject, text };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LookupRequest;
    const objectId = body.objectId || body.threadId || body.messageId;
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" });
    }

    // Acquire a valid token (auto-refresh if needed)
    const token = await getHubspotAccessToken();

    // Fetch the thread payload
    const data = await fetchThread(objectId, token);

    // Extract sender, subject, text
    const info = extractThreadInfo(data);
    if (!info) {
      return NextResponse.json({
        ok: true,
        email: "",
        subject: "",
        text: "",
        threadId: objectId,
        src: "@{pickedKeys=System.Object[]}",
      });
    }

    return NextResponse.json({
      ok: true,
      email: info.senderEmail,
      subject: info.subject,
      text: info.text,
      threadId: objectId,
      src: "@{email=deep/chooser; subject=direct/deep; text=messages}",
    });
  } catch (err: any) {
    console.error("[lookup] error", err);
    return NextResponse.json({
      ok: false,
      error: err.message ?? "unexpected error",
    });
  }
}
