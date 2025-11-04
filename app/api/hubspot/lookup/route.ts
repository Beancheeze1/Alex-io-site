// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

async function getAccessToken(): Promise<TokenResult> {
  // 1) If direct ACCESS token is provided, use it
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  // 2) Else use refresh-token flow
  const refresh = process.env.HUBSPOT_REFRESH_TOKEN?.trim();
  const cid = process.env.HUBSPOT_CLIENT_ID?.trim();
  const secret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!refresh || !cid || !secret) {
    return { ok: false, error: "missing_refresh_flow_envs" };
  }

  // HubSpot OAuth refresh
  // Docs: POST https://api.hubapi.com/oauth/v1/token
  // content-type: application/x-www-form-urlencoded
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
  if (!r.ok) {
    return {
      ok: false,
      error: "refresh_failed",
      status: r.status,
      detail: text.slice(0, 800),
    };
  }

  try {
    const j = JSON.parse(text);
    const token = String(j.access_token || "");
    if (!token) return { ok: false, error: "no_access_token_in_response" };
    return { ok: true, token };
  } catch (e: any) {
    return { ok: false, error: "refresh_parse_error", detail: text.slice(0, 800) };
  }
}

function pickEmailFromThread(threadJson: any): string | null {
  // Try a few likely paths; HubSpot shapes can vary by inbox
  const msgs = threadJson?.messages || threadJson?.threadMessages || [];
  for (const m of Array.isArray(msgs) ? msgs : []) {
    const from = m?.from || m?.sender || m?.actor || {};
    const e = from?.email || from?.emailAddress || null;
    if (e && typeof e === "string") return e;
  }
  // fallback: look for top-level participants
  const parts = threadJson?.participants || [];
  for (const p of Array.isArray(parts) ? parts : []) {
    const e = p?.email || p?.emailAddress || null;
    if (e && typeof e === "string") return e;
  }
  return null;
}

function pickSubject(threadJson: any): string {
  return (
    threadJson?.subject ||
    threadJson?.threadSubject ||
    threadJson?.summary ||
    ""
  ).toString();
}

function pickText(threadJson: any): string {
  // pull most recent inbound text-ish field we can find
  const msgs = threadJson?.messages || threadJson?.threadMessages || [];
  if (Array.isArray(msgs) && msgs.length > 0) {
    // find last human/non-bot message with text/plain fallback
    const last = [...msgs].reverse().find((m) => {
      const type = String(m?.type ?? m?.messageType ?? "");
      return type !== "NOTE" && type !== "SYSTEM";
    });
    const body = last?.text || last?.body || last?.content || "";
    return String(body ?? "");
  }
  return "";
}

export async function POST(req: Request) {
  try {
    let payload: any = {};
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json(
        { ok: false, error: "missing objectId or threadId" },
        { status: 400 }
      );
    }

    // Access token via either ACCESS or REFRESH flow
    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json(
        { ok: false, error: tok.error, status: tok.status, detail: tok.detail },
        { status: 200 }
      );
    }

    const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${tok.token}` },
      cache: "no-store",
    });

    const raw = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, status: r.status, error: "hubspot_thread_fetch_failed", body: raw.slice(0, 1000) },
        { status: 200 }
      );
    }

    let thread: any = {};
    try {
      thread = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, error: "hubspot_json_parse_error", body: raw.slice(0, 1000) },
        { status: 200 }
      );
    }

    const email = pickEmailFromThread(thread);
    const subject = pickSubject(thread);
    const text = pickText(thread);

    return NextResponse.json(
      { ok: true, email, subject, text, threadId: objectId },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "lookup_route_exception" },
      { status: 200 }
    );
  }
}
