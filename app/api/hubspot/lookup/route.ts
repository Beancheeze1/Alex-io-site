// app/api/hubspot/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ---- env helpers (kept minimal) ---- */
function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** ---- HubSpot token helpers: use ACCESS if present, else refresh via REFRESH_TOKEN ---- */
async function getAccessToken(): Promise<string> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return direct;

  const refresh = env("HUBSPOT_REFRESH_TOKEN");
  const clientId = env("HUBSPOT_CLIENT_ID");
  const clientSecret = env("HUBSPOT_CLIENT_SECRET");

  const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`hubspot_refresh_failed ${r.status} ${JSON.stringify(j)}`);
  return String(j.access_token);
}

async function hs(path: string, token: string) {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  const text = await r.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json };
}

/** Try to pull Internet Message-ID from a HubSpot message object */
function extractInternetMessageId(msg: any): string | null {
  if (!msg || typeof msg !== "object") return null;

  // Common direct fields across shapes
  const direct = [
    msg.internetMessageId,
    msg.externalMessageId,
    msg.originalMessageId,
    msg.gmailMessageId,
    msg.messageId,
    msg?.metadata?.messageId,
  ].filter(Boolean).map((s: any) => String(s).trim());

  // Header arrays / maps
  const headers =
    msg.headers ||
    msg.emailHeaders ||
    msg?.metadata?.headers ||
    {};

  const fromHeaders: string[] = [];
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const k = String(h?.name ?? h?.key ?? "").toLowerCase();
      const v = String(h?.value ?? h?.val ?? "").trim();
      if (k === "message-id" || k === "internet-message-id") fromHeaders.push(v);
    }
  } else if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers)) {
      const key = String(k).toLowerCase();
      const val = String(v).trim();
      if (key === "message-id" || key === "internet-message-id") fromHeaders.push(val);
    }
  }

  const all = [...fromHeaders, ...direct].filter(Boolean);
  if (!all.length) return null;

  const first = all[0];
  return first.startsWith("<") ? first : `<${first}>`;
}

type Input = {
  objectId?: string | number;
  threadId?: string | number;
  messageId?: string | number; // optional hubspot numeric id from webhook
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Input;
    const threadId = String(body.threadId ?? body.objectId ?? "");
    const numericMessageId = body.messageId ? String(body.messageId) : null;

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "missing objectId/threadId" }, { status: 400 });
    }

    const token = await getAccessToken();

    // Pull thread + messages
    const t = await hs(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`, token);
    if (!t.ok) {
      return NextResponse.json({ ok: false, status: t.status, error: "hubspot_thread_fetch_failed", body: t.json }, { status: 200 });
    }

    const m = await hs(`/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages?limit=50`, token);
    if (!m.ok) {
      return NextResponse.json({ ok: false, status: m.status, error: "hubspot_messages_fetch_failed", body: m.json }, { status: 200 });
    }

    // Normalize messages shape
    const messages: any[] = Array.isArray(m.json?.results) ? m.json.results : (m.json?.messages || []);
    const sorted = [...messages].sort((a, b) => {
      const at = new Date(a?.createdAt ?? a?.created_at ?? 0).valueOf();
      const bt = new Date(b?.createdAt ?? b?.created_at ?? 0).valueOf();
      return bt - at;
    });

    // Prefer the specific hubspot message id; else the latest inbound user message
    const chosen =
      (numericMessageId && sorted.find(x => String(x?.id) === numericMessageId)) ||
      sorted.find(x => String(x?.direction || x?.type || "").toLowerCase().includes("inbound")) ||
      sorted[0] ||
      null;

    // Extract email + subject
    const email =
      chosen?.from?.email ||
      chosen?.originator?.email ||
      chosen?.sender?.email ||
      t.json?.participants?.find?.((p: any) => p?.role === "VISITOR")?.email ||
      "";

    const subject =
      chosen?.subject ||
      t.json?.subject ||
      t.json?.thread?.subject ||
      "";

    const internetMessageId = extractInternetMessageId(chosen);

    return NextResponse.json({
      ok: true,
      threadId,
      email,
      subject,
      internetMessageId,
      // Debug surface so we can widen if needed:
      src: { pickedKeys: Object.keys(chosen || {}) },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "lookup_failed" }, { status: 500 });
  }
}
