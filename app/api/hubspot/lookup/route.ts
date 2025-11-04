// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function getAccessToken(): Promise<TokenResult> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  const refresh = process.env.HUBSPOT_REFRESH_TOKEN?.trim();
  const cid = process.env.HUBSPOT_CLIENT_ID?.trim();
  const secret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!refresh || !cid || !secret) {
    return { ok: false, error: "missing_refresh_flow_envs" };
  }

  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", cid);
  form.set("client_secret", secret);
  form.set("refresh_token", refresh);

  const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await r.text();
  if (!r.ok) return { ok: false, error: `refresh_failed`, status: r.status, detail: text.slice(0, 800) };

  try {
    const j = JSON.parse(text);
    const token = String(j.access_token || "");
    if (!token) return { ok: false, error: "no_access_token_in_response" };
    return { ok: true, token };
  } catch {
    return { ok: false, error: "refresh_parse_error", detail: text.slice(0, 800) };
  }
}

// --- Flexible pickers for many HS shapes ---
function deepFindEmail(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (isEmail(v)) return v;
    if (v && typeof v === "object") {
      const hit = deepFindEmail(v);
      if (hit) return hit;
    }
  }
  return null;
}

function pickSubject(threadJson: any): string {
  return (
    threadJson?.subject ??
    threadJson?.threadSubject ??
    threadJson?.title ??
    threadJson?.summary ??
    ""
  ).toString();
}

function pickFromThread(threadJson: any) {
  // Try participants, lastMessage, messages, etc.
  let email: string | null = null;
  let text = "";
  // participants
  const parts = Array.isArray(threadJson?.participants) ? threadJson.participants : [];
  for (const p of parts) {
    const e = p?.email ?? p?.emailAddress ?? null;
    if (isEmail(e)) { email = e; break; }
  }
  // lastMessage
  const lm = threadJson?.lastMessage ?? threadJson?.last_message ?? null;
  if (!text && lm) {
    text = String(lm.text ?? lm.body ?? lm.content ?? "");
    if (!email) {
      const e = lm?.from?.email ?? lm?.from?.emailAddress ?? null;
      if (isEmail(e)) email = e;
    }
  }
  // direct messages array (some shapes embed a few)
  const msgs = Array.isArray(threadJson?.messages) ? threadJson.messages : [];
  if (!text && msgs.length) {
    const last = [...msgs].reverse().find(m => (m?.direction ?? m?.type ?? "").toString().toUpperCase() !== "SYSTEM");
    if (last) {
      text = String(last.text ?? last.body ?? last.content ?? "");
      if (!email) {
        const e = last?.from?.email ?? last?.from?.emailAddress ?? null;
        if (isEmail(e)) email = e;
      }
    }
  }
  // as a last resort, deep scan the object for *any* email-like field
  if (!email) email = deepFindEmail(threadJson);
  return { email, text };
}

function chooseLatestInbound(messages: any[]): { email: string | null; text: string } {
  // Prefer human inbound (direction INBOUND / external actor)
  const pick = [...messages].reverse().find(m => {
    const dir = String(m?.direction ?? "").toUpperCase(); // INBOUND / OUTBOUND
    const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
    return dir !== "OUTBOUND" && type !== "SYSTEM" && type !== "NOTE";
  }) ?? messages[messages.length - 1];

  const body = String(pick?.text ?? pick?.body ?? pick?.content ?? "");
  const e = pick?.from?.email ?? pick?.from?.emailAddress ?? null;
  return { email: isEmail(e) ? e : null, text: body };
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 200 });
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json({ ok: false, error: tok.error, status: tok.status, detail: tok.detail }, { status: 200 });
    }

    // 1) Fetch thread
    const tUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`;
    const tRes = await fetch(tUrl, { headers: { Authorization: `Bearer ${tok.token}` }, cache: "no-store" });
    const tRaw = await tRes.text();
    if (!tRes.ok) {
      return NextResponse.json({ ok: false, status: tRes.status, error: "hubspot_thread_fetch_failed", body: tRaw.slice(0, 1200) }, { status: 200 });
    }

    let thread: any = {};
    try { thread = JSON.parse(tRaw); } catch {
      return NextResponse.json({ ok: false, error: "hubspot_json_parse_error", body: tRaw.slice(0, 1200) }, { status: 200 });
    }

    let subject = pickSubject(thread);
    let { email, text } = pickFromThread(thread);

    // 2) If still missing, fetch messages page and extract latest inbound
    if (!email || !text) {
      const mUrl = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=50`;
      const mRes = await fetch(mUrl, { headers: { Authorization: `Bearer ${tok.token}` }, cache: "no-store" });
      const mRaw = await mRes.text();
      if (mRes.ok) {
        try {
          const j = JSON.parse(mRaw);
          const items: any[] = Array.isArray(j?.results) ? j.results : (Array.isArray(j) ? j : []);
          if (items.length) {
            const pick = chooseLatestInbound(items);
            if (!email && pick.email) email = pick.email;
            if (!text && pick.text) text = pick.text;
          }
        } catch { /* ignore parse; keep best-effort */ }
      }
    }

    return NextResponse.json({ ok: true, email: email ?? "", subject, text, threadId: objectId }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "lookup_route_exception" }, { status: 200 });
  }
}
