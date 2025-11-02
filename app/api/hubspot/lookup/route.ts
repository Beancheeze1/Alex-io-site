// app/api/hubspot/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function looksExternal(email: string) {
  const e = email.toLowerCase();
  return e && !e.endsWith("@alex-io.com");
}
function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function parseEmailFromHeader(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/<\s*([^>]+@[^>]+)\s*>/);
  if (m?.[1] && isEmail(m[1])) return m[1].trim();
  if (isEmail(v.trim())) return v.trim();
  return null;
}

async function getAccessToken(selfBase: string) {
  const refreshUrl = `${selfBase}/api/hubspot/refresh`;
  const res = await fetch(refreshUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const json = await res.json();
  const token = json?.accessToken || json?.access_token || json?.token;
  if (!token) throw new Error("no access token from /api/hubspot/refresh");
  return token;
}

export async function POST(req: NextRequest) {
  try {
    const selfBase = process.env.INTERNAL_SELF_URL || `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const { objectId, messageId } = await req.json() as { objectId?: string | number, messageId?: string };
    if (!objectId) return NextResponse.json({ ok: false, error: "missing objectId" }, { status: 400 });

    const token = await getAccessToken(selfBase);

    // Messages for the thread (v3)
    const hsUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages`;
    const res = await fetch(hsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "hubspot messages fetch failed", status: res.status, details: t.slice(0, 1000), context: { id: [String(objectId)] }, category: "OBJECT_NOT_FOUND", subCategory: "ConversationsResourceNotFoundError.THREAD_NOT_FOUND" }, { status: 404 });
    }

    const data = await res.json().catch(() => null);
    const items: any[] = Array.isArray(data) ? data : (Array.isArray((data as any)?.results) ? (data as any).results : []);
    let chosen: any = null;

    if (messageId) {
      chosen = items.find(m => String(m?.id) === String(messageId) || String(m?.messageId) === String(messageId)) || null;
    }
    if (!chosen && items.length) {
      chosen = items.find(m => String(m?.direction || "").toLowerCase() === "inbound") || items[items.length - 1];
    }

    // Try to grab inbox/channel hints from any message in the thread (chosen or first)
    const hintSrc = chosen || items[0] || {};
    const inboxId = hintSrc?.inboxId ?? hintSrc?.inbox?.id ?? null;
    const channelId = hintSrc?.channelId ?? hintSrc?.channel?.id ?? null;
    const inboxEmail =
      hintSrc?.to?.[0]?.email ||
      hintSrc?.inbox?.email ||
      hintSrc?.channel?.email ||
      null;

    const candidates: (string | undefined)[] = [
      chosen?.from?.email,
      chosen?.sender?.email,
      chosen?.originator?.email,
      parseEmailFromHeader(chosen?.headers?.["Reply-To"]),
      parseEmailFromHeader(chosen?.headers?.["From"]),
    ];
    for (const c of candidates) {
      if (c && isEmail(c) && looksExternal(c)) {
        return NextResponse.json({ ok: true, email: c, via: "direct", inboxId, channelId, inboxEmail });
      }
    }

    const blob = JSON.stringify(chosen ?? {});
    const deep = [...blob.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(m => m[0].toLowerCase());
    const pick = deep.find(looksExternal);
    if (pick) return NextResponse.json({ ok: true, email: pick, via: "deep", inboxId, channelId, inboxEmail });

    return NextResponse.json({ ok: false, error: "no_email_found", sample: { keys: Object.keys(chosen || {}) } }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
