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



function chooseCustomerEmail(cands: string[], mailboxFrom?: string): string | null {
  const mbox = (mailboxFrom || process.env.MS_MAILBOX_FROM || "").toLowerCase();
  const mboxDomain = mbox.split("@")[1] || "";
  const cleaned = Array.from(new Set(cands.map((e) => e.toLowerCase())));

  // Rank: not-equal mailbox, not same domain, not no-reply, looks normal
  const score = (e: string) => {
    let s = 0;
    if (mbox && e !== mbox) s += 3;
    if (mboxDomain && !e.endsWith("@" + mboxDomain)) s += 2;
    if (!e.includes("no-reply") && !e.includes("noreply")) s += 1;
    return s;
  };

  const best = cleaned
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .sort((a, b) => score(b) - score(a))[0];

  return best || null;
}







/** Walk any object tree and return the first value that matches `pick` */
function deepFind<T = any>(
  obj: any,
  pick: (k: string, v: any, path: string[]) => T | undefined,
  path: string[] = []
): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const got = deepFind(obj[i], pick, path.concat(String(i)));
      if (got !== undefined) return got;
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(obj)) {
    const gotHere = pick(k, v, path.concat(k));
    if (gotHere !== undefined) return gotHere;
    if (v && typeof v === "object") {
      const got = deepFind(v, pick, path.concat(k));
      if (got !== undefined) return got;
    }
  }
  return undefined;
}

function findAnyEmail(obj: any): { value: string; from: string } | null {
  const hit = deepFind(obj, (k, v, p) => (isEmail(v) ? { value: v as string, from: p.join(".") } : undefined));
  return hit ?? null;
}

function findAnySubject(obj: any): { value: string; from: string } | null {
  const hit = deepFind(obj, (k, v, p) => {
    if (typeof v === "string" && v.trim() && k.toLowerCase().includes("subject")) {
      return { value: v.trim(), from: p.join(".") };
    }
    return undefined;
  });
  return hit ?? null;
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

function chooseLatestInbound(messages: any[]): { email: string | null; text: string } {
  const pick =
    [...messages].reverse().find((m) => {
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

    // Fetch 3 sources: thread, messages, participants
    const headers = { Authorization: `Bearer ${tok.token}` };

    const [tRes, mRes, pRes] = await Promise.all([
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, { headers, cache: "no-store" }),
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=50`, {
        headers,
        cache: "no-store",
      }),
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/participants`, {
        headers,
        cache: "no-store",
      }),
    ]);

    const [tRaw, mRaw, pRaw] = await Promise.all([tRes.text(), mRes.text(), pRes.text()]);

    if (!tRes.ok) {
      return NextResponse.json(
        { ok: false, status: tRes.status, error: "hubspot_thread_fetch_failed", body: tRaw.slice(0, 1200) },
        { status: 200 }
      );
    }

    let thread: any = {};
    let messages: any[] = [];
    let participants: any[] = [];

    try {
      thread = JSON.parse(tRaw);
    } catch { /* ignore */ }
    try {
      const mj = JSON.parse(mRaw);
      messages = Array.isArray(mj?.results) ? mj.results : Array.isArray(mj) ? mj : [];
    } catch { /* ignore */ }
    try {
      const pj = JSON.parse(pRaw);
      participants = Array.isArray(pj?.results) ? pj.results : Array.isArray(pj) ? pj : [];
    } catch { /* ignore */ }

    // Subject: first try obvious fields, then deep scan everywhere
    let subject =
      (thread?.subject ??
        thread?.threadSubject ??
        thread?.title ??
        thread?.summary ??
        "")?.toString() ?? "";
    if (!subject) {
      const sHit = findAnySubject({ thread, messages, participants });
      subject = sHit?.value ?? "";
    }

    // Text + email from messages if present
    let text = "";
    let email: string | null = null;
    if (messages.length) {
      const pick = chooseLatestInbound(messages);
      text = pick.text || text;
      email = pick.email || email;
    }

    // If still missing email, try thread -> participants -> deep scan
    if (!email) {
      // thread-level hints
      const th = thread?.lastMessage ?? thread?.last_message ?? {};
      const e1 = th?.from?.email ?? th?.from?.emailAddress ?? null;
      if (isEmail(e1)) email = e1;

      // participants
      if (!email && participants.length) {
        const ph = findAnyEmail(participants);
        if (ph?.value) email = ph.value;
      }

      // deep scan across all JSON for an email-like string
      if (!email) {
        const dh = findAnyEmail({ thread, messages, participants });
        if (dh?.value) email = dh.value;
      }
    }


// build a candidate set from everything we saw
const candEmails = new Set<string>();
// from messages
for (const m of messages) {
  const e = m?.from?.email ?? m?.from?.emailAddress ?? null;
  if (e && typeof e === "string") candEmails.add(e);
}
// from participants deep scan + thread deep scan
const dh1 = findAnyEmail({ thread });
if (dh1?.value) candEmails.add(dh1.value);
const dh2 = findAnyEmail({ participants });
if (dh2?.value) candEmails.add(dh2.value);

if (email) candEmails.add(email);

// choose best that isn't your mailbox/self
const picked = chooseCustomerEmail(Array.from(candEmails));
if (picked) email = picked;







    return NextResponse.json(
      {
        ok: true,
        email: email ?? "",
        subject,
        text,
        threadId: objectId,
        // helpful breadcrumbs (short)
        src: {
          sub: subject ? "subject:direct/deep" : "none",
          email: email ? "messages/participants/deep" : "none",
          text: text ? "messages" : "none",
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "lookup_route_exception" }, { status: 200 });
  }
}
