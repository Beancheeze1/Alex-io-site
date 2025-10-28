// app/api/hubspot/peek/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function j(data: any, init?: number | ResponseInit) {
  const opts = typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

async function getHubspotAccessToken(): Promise<string> {
  const base = process.env.NEXT_PUBLIC_BASE_URL!;
  const r = await fetch(`${base}/api/hubspot/refresh`, { cache: "no-store" });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return Promise.reject(new Error(`hs_token_${r.status} ${t}`));
  }
  const data = await r.json().catch(() => ({}));
  const tok = data?.access_token || data?.accessToken || data?.token;
  if (!tok) throw new Error("hs_token_missing");
  return tok;
}

/**
 * GET /api/hubspot/peek?threadId=123
 * Returns HubSpot's raw thread & messages for that thread.
 * (Read-only; safe for diagnostics.)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");
  if (!threadId) return j({ ok: false, error: "missing threadId" }, 400);

  try {
    const token = await getHubspotAccessToken();

    // Thread details (sometimes contains participants/channel info)
    const threadRes = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const threadText = await threadRes.text().catch(() => "");
    let threadJson: any = {};
    try { threadJson = threadText ? JSON.parse(threadText) : {}; } catch { threadJson = { raw: threadText }; }

    // Latest messages (descending)
    const msgRes = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages?limit=20&sort=createdAt&order=DESC`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msgText = await msgRes.text().catch(() => "");
    let msgJson: any = {};
    try { msgJson = msgText ? JSON.parse(msgText) : {}; } catch { msgJson = { raw: msgText }; }

    return j({ ok: true, thread: threadJson, messages: msgJson }, 200);
  } catch (err: any) {
    return j({ ok: false, error: String(err?.message || err) }, 500);
  }
}
