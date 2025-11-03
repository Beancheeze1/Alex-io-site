// app/api/hubspot/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";

// Utility: require env
function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Get a HubSpot access token via your existing refresh token
async function getHubSpotAccessToken() {
  const refresh = env("HUBSPOT_REFRESH_TOKEN");
  const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: env("HUBSPOT_CLIENT_ID"),
      client_secret: env("HUBSPOT_CLIENT_SECRET"),
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`hubspot token ${r.status}`);
  const j = await r.json();
  return j.access_token as string;
}

// Fetch helpers (tolerant to small API differences across tenants)
async function hsJson(url: string, token: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`hubspot ${r.status} ${url} ${detail}`);
  }
  return r.json();
}

/**
 * Resolve email data from either:
 * - objectId (thread id) + latest message
 * - messageId only (we lookup the parent thread and the message)
 *
 * Returns: { ok, toEmail, text, subject, inReplyTo }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const messageId = body?.messageId?.toString().trim();
    const objectId = body?.objectId?.toString().trim();

    if (!messageId && !objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or messageId" }, { status: 400 });
    }

    const token = await getHubSpotAccessToken();

    // If we only have a messageId, try to resolve the thread and message
    // Note: endpoints can vary between accounts; these two patterns cover common inboxes.
    let threadId = objectId || "";
    let message: any = null;

    if (messageId && !threadId) {
      // Try a direct message lookup that includes thread info
      // Variant A: conversations messages detail
      try {
        const m = await hsJson(
          `https://api.hubapi.com/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`,
          token
        );
        message = m;
        threadId = m?.threadId?.toString() || m?.thread?.id?.toString() || "";
      } catch {
        // Variant B: some tenants expose messages under threads listing
        // If we can’t get it directly, try searching the recent threads and find the message
        const threads = await hsJson(
          "https://api.hubapi.com/conversations/v3/conversations/threads?limit=50",
          token
        );
        const hit = (threads?.results || []).find((th: any) =>
          (th?.messages || []).some((msg: any) => String(msg?.id) === messageId)
        );
        if (hit) {
          threadId = String(hit.id);
          message = (hit.messages || []).find((msg: any) => String(msg?.id) === messageId) || null;
        }
      }
    }

    // If we have a thread id but not the message body, fetch thread details and pick the message
    if (threadId && !message) {
      const th = await hsJson(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`,
        token
      );
      // Choose the specific messageId if provided, else latest user message
      const msgs = th?.messages || th?.results || [];
      message = messageId
        ? msgs.find((m: any) => String(m?.id) === messageId)
        : msgs.find((m: any) => (m?.from?.email || "").length > 0 && (m?.text || "").length > 0) || msgs.at(-1);
    }

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "missing objectId (thread) after resolve" }, { status: 400 });
    }
    if (!message) {
      return NextResponse.json({ ok: false, error: "missing message after resolve", objectId: threadId }, { status: 404 });
    }

    // Normalize fields
    const toEmail = message?.from?.email || message?.sender?.email || "";
    const text =
      message?.text ||
      message?.html?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
      "";
    const subject =
      message?.subject ||
      message?.title ||
      `Re: your message to Alex-IO`;
    const inReplyTo = messageId || message?.id?.toString() || "";

    if (!toEmail || !text) {
      return NextResponse.json(
        { ok: false, error: "missing toEmail or text", objectId: threadId, messageId: inReplyTo },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      toEmail,
      text,
      subject,
      inReplyTo,
      objectId: threadId,
      messageId: inReplyTo,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
