// app/api/hubspot/lookup/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------------ utils ------------------------------------ */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Deep walk any object and return the first match from `pick` */
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
  const hit = deepFind(obj, (k, v, p) => (isEmail(v) ? { value: String(v), from: p.join(".") } : undefined));
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

function uniqLower(emails: string[]) {
  return Array.from(new Set(emails.map((e) => e.toLowerCase())));
}

/**
 * Prefer the *customer* email:
 * - not exactly your mailbox (MS_MAILBOX_FROM)
 * - not the same domain as your mailbox (e.g., alex-io.com)
 * - avoid noreply/no-reply and obvious system senders
 * - reward public/email-like domains (gmail/outlook/yahoo) a bit
 */
function chooseCustomerEmail(candsIn: string[], mailboxFromEnv?: string): string | null {
  const cleaned = uniqLower(candsIn).filter(isEmail);
  if (!cleaned.length) return null;

  const mailbox = (mailboxFromEnv || process.env.MS_MAILBOX_FROM || "").toLowerCase();
  const mailboxDomain = mailbox.split("@")[1] || "";
  const isSystemish = (e: string) =>
    e.includes("no-reply") ||
    e.includes("noreply") ||
    e.includes("hubspot") ||
    e.endsWith("@noreply.com");

  const publicBumps = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"];

  const score = (e: string) => {
    let s = 0;
    if (mailbox && e !== mailbox) s += 4;                     // not exactly mailbox
    if (mailboxDomain && !e.endsWith("@" + mailboxDomain)) s += 3; // not same domain
    if (!isSystemish(e)) s += 2;                               // not noreply/hubspot
    if (publicBumps.some((d) => e.endsWith("@" + d))) s += 1;  // slightly prefer consumer emails
    return s;
  };

  const best = cleaned.sort((a, b) => score(b) - score(a))[0];
  return best || null;
}

async function getAccessToken(): Promise<TokenResult> {
  // Direct bearer first
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  // Refresh flow
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
  if (!r.ok) {
    return { ok: false, error: "refresh_failed", status: r.status, detail: text.slice(0, 800) };
  }

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
      const dir = String(m?.direction ?? "").toUpperCase(); // INBOUND/OUTBOUND
      const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
      return dir !== "OUTBOUND" && type !== "SYSTEM" && type !== "NOTE";
    }) ?? messages[messages.length - 1];

  const body = String(pick?.text ?? pick?.body ?? pick?.content ?? "");
  const e = pick?.from?.email ?? pick?.from?.emailAddress ?? null;
  return { email: isEmail(e) ? e : null, text: body };
}

/* ------------------------------------ route ------------------------------------ */

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 200 });
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json(
        { ok: false, error: tok.error, status: tok.status, detail: tok.detail },
        { status: 200 }
      );
    }

    const headers = { Authorization: `Bearer ${tok.token}` };

    // Fetch thread, messages, participants in parallel
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

    try { thread = JSON.parse(tRaw); } catch {}
    try {
      const mj = JSON.parse(mRaw);
      messages = Array.isArray(mj?.results) ? mj.results : Array.isArray(mj) ? mj : [];
    } catch {}
    try {
      const pj = JSON.parse(pRaw);
      participants = Array.isArray(pj?.results) ? pj.results : Array.isArray(pj) ? pj : [];
    } catch {}

    // Subject
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

    // Text + initial email from messages
    let text = "";
    let email: string | null = null;
    if (messages.length) {
      const pick = chooseLatestInbound(messages);
      text = pick.text || text;
      email = pick.email || email;
    }

    // Build candidate email list from many sources
    const candEmails: string[] = [];

    // From messages (from / replyTo / recipients)
    for (const m of messages) {
      const from = m?.from?.email ?? m?.from?.emailAddress ?? null;
      if (isEmail(from)) candEmails.push(from);

      const rt = m?.replyTo?.email ?? m?.replyTo?.emailAddress ?? null;
      if (isEmail(rt)) candEmails.push(rt);

      // recipients arrays (if present)
      const recips: any[] = Array.isArray(m?.to) ? m.to : [];
      recips.forEach((r) => {
        const e = r?.email ?? r?.emailAddress ?? null;
        if (isEmail(e)) candEmails.push(e);
      });
    }

    // From participants
    const pHit = findAnyEmail(participants);
    if (pHit?.value) candEmails.push(pHit.value);

    // From thread (any deep email)
    const tHit = findAnyEmail(thread);
    if (tHit?.value) candEmails.push(tHit.value);

    // Include whatever we already found
    if (email) candEmails.push(email);

    // Choose customer email (not our mailbox, not same domain, not noreply)
    const picked = chooseCustomerEmail(candEmails);
    if (picked) email = picked;

    return NextResponse.json(
      {
        ok: true,
        email: email ?? "",
        subject,
        text,
        threadId: objectId,
        src: {
          subject: subject ? "direct/deep" : "none",
          email: email ? "chooser(messages/participants/thread)" : "none",
          text: text ? "messages" : "none",
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "lookup_route_exception" }, { status: 200 });
  }
}
