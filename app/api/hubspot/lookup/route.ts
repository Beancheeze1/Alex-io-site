// app/api/hubspot/lookup/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

// Pick the first non-company email
function looksExternal(email: string) {
  const e = email.toLowerCase();
  return e && !e.endsWith("@alex-io.com");
}

// Robust email validation
function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function getAccessToken(base: string) {
  // uses your already-working refresh endpoint
  const res = await fetch(new URL("/api/hubspot/refresh", base), { cache: "no-store" });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  const json = await res.json();
  const token = json?.accessToken || json?.access_token || json?.token;
  if (!token) throw new Error("no access token from /api/hubspot/refresh");
  return token;
}

export async function POST(req: NextRequest) {
  try {
    const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const { objectId, messageId } = await req.json() as { objectId?: string | number, messageId?: string };

    if (!objectId) return NextResponse.json({ ok: false, error: "missing objectId (threadId)" }, { status: 400 });

    const token = await getAccessToken(base);

    // Fetch messages for the thread (v3)
    const hsUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages`;
    const res = await fetch(hsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "hubspot messages fetch failed", status: res.status, details: t.slice(0, 1000) }, { status: 502 });
    }

    const data = await res.json().catch(() => null);
    const items: any[] =
      Array.isArray(data) ? data :
      Array.isArray((data as any)?.results) ? (data as any).results :
      [];

    // Try to find the matching message first
    let chosen: any = null;
    if (messageId) {
      chosen = items.find(m =>
        String(m?.id) === String(messageId) ||
        String(m?.messageId) === String(messageId)
      ) || null;
    }
    // Fallback: last inbound-looking message
    if (!chosen && items.length) {
      chosen = items.find(m => String(m?.direction || "").toLowerCase() === "inbound") || items[items.length - 1];
    }

    // Try multiple paths for an email
    const candidates: (string | undefined)[] = [
      chosen?.from?.email,
      chosen?.sender?.email,
      chosen?.originator?.email,
      (chosen?.headers && (chosen.headers["Reply-To"] || chosen.headers["From"])) as string | undefined,
    ];

    for (const c of candidates) {
      if (!c) continue;
      if (isEmail(c) && looksExternal(c)) {
        return NextResponse.json({ ok: true, email: c, via: "direct" });
      }
      // parse From/Reply-To style “Name <x@y.com>”
      const m = typeof c === "string" ? c.match(/<\s*([^>]+@[^>]+)\s*>/) : null;
      const parsed = m?.[1];
      if (isEmail(parsed) && looksExternal(parsed)) {
        return NextResponse.json({ ok: true, email: parsed, via: "header" });
      }
    }

    // Deep scan fallback through the chosen message and its headers/body
    const blob = JSON.stringify(chosen ?? {});
    const deep = [...blob.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map(m => m[0].toLowerCase());
    const pick = deep.find(looksExternal);
    if (pick) return NextResponse.json({ ok: true, email: pick, via: "deep" });

    return NextResponse.json({ ok: false, error: "no_email_found", sample: { keys: Object.keys(chosen || {}) } }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
