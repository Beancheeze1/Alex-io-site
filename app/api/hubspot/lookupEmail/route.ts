// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------ helpers ------------------------------ */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function uniqLower(a: Iterable<string>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of a) {
    const v = e.toLowerCase();
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// simple, liberal matcher for “something@host.tld”
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Push any email-looking strings from any JSON shape into `out` */
function addEmailsFrom(value: unknown, out: string[]) {
  if (value == null) return;

  if (typeof value === "string") {
    const hits = value.match(EMAIL_RE);
    if (hits) out.push(...hits);
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) addEmailsFrom(v, out);
    return;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // descend aggressively on likely header/actor keys
      if (
        /^(from|replyTo|sender|actor|initiatingActor|owner|participant|participants|to|cc|bcc|recipients|address|email|headers)$/i.test(
          k,
        )
      ) {
        addEmailsFrom(v, out);
      } else if (typeof v === "object") {
        addEmailsFrom(v, out);
      } else if (typeof v === "string") {
        const hits = v.match(EMAIL_RE);
        if (hits) out.push(...hits);
      }
    }
  }
}

/** Prefer a *customer* address (not our mailbox/domain; not noreply/hubspot). */
function chooseCustomerEmail(candsIn: Iterable<string>, mailboxFromEnv?: string): string | null {
  const cleaned = uniqLower(candsIn).filter(isEmail);
  if (!cleaned.length) return null;

  const mailbox = (mailboxFromEnv || process.env.MS_MAILBOX_FROM || "").toLowerCase();
  const mailboxDomain = mailbox.split("@")[1] || "";

  const bannedDomains = new Set(
    ["alex-io.com", "hubspot.com", "hubspotemail.net", mailboxDomain].filter(Boolean).map((d) => d.toLowerCase()),
  );

  const isSystemish = (e: string) =>
    e.includes("no-reply") || e.includes("noreply") || e.includes("hubspot") || e.endsWith("@hubspotemail.net");

  const publicBumps = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

  const score = (e: string) => {
    let s = 0;
    if (mailbox && e !== mailbox) s += 4; // not exactly our mailbox
    const d = e.split("@")[1] || "";
    if (d && !bannedDomains.has(d)) s += 3; // not our domain nor banned
    if (!isSystemish(e)) s += 2; // not noreply/system
    if (publicBumps.has(d)) s += 1; // small bump for consumer domains
    return s;
  };

  let best = "";
  let bestScore = -1;
  for (const e of cleaned) {
    if (mailbox && e === mailbox) continue;
    const d = e.split("@")[1] || "";
    if (bannedDomains.has(d)) continue;
    if (isSystemish(e)) continue;

    const sc = score(e);
    if (sc > bestScore) {
      bestScore = sc;
      best = e;
    }
  }
  return best || null;
}

async function getAccessToken(): Promise<TokenResult> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  const refresh = process.env.HUBSPOT_REFRESH_TOKEN?.trim();
  const cid = process.env.HUBSPOT_CLIENT_ID?.trim();
  const secret = process.env.HUBSPOT_CLIENT_SECRET?.trim();
  if (!refresh || !cid || !secret) return { ok: false, error: "missing_refresh_flow_envs" };

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
  if (!r.ok) return { ok: false, error: "refresh_failed", status: r.status, detail: text.slice(0, 800) };

  try {
    const j = JSON.parse(text);
    const token = String(j.access_token || "");
    if (!token) return { ok: false, error: "no_access_token_in_response" };
    return { ok: true, token };
  } catch {
    return { ok: false, error: "refresh_parse_error", detail: text.slice(0, 800) };
  }
}

/** Latest inbound message text for fallback. */
function chooseLatestInbound(messages: any[]): string {
  if (!Array.isArray(messages) || !messages.length) return "";
  const pick =
    [...messages].reverse().find((m) => {
      const dir = String(m?.direction ?? "").toUpperCase();
      const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
      return dir !== "OUTBOUND" && type !== "SYSTEM" && type !== "NOTE";
    }) ?? messages[messages.length - 1];
  return String(pick?.text ?? pick?.body ?? pick?.content ?? "");
}

/* -------------------------------- route ------------------------------- */

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as { objectId?: number | string; threadId?: number | string };
    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 200 });
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json({ ok: false, error: tok.error, status: tok.status, detail: tok.detail }, { status: 200 });
    }

    const headers = { Authorization: `Bearer ${tok.token}` };

    // fetch thread, messages, participants (same endpoints as before)
    const [tRes, mRes, pRes] = await Promise.all([
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, { headers, cache: "no-store" }),
      fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=100`,
        { headers, cache: "no-store" },
      ),
      fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/participants`,
        { headers, cache: "no-store" },
      ),
    ]);

    const [tRaw, mRaw, pRaw] = await Promise.all([tRes.text(), mRes.text(), pRes.text()]);

    if (!tRes.ok) {
      return NextResponse.json(
        { ok: false, status: tRes.status, error: "hubspot_thread_fetch_failed", body: tRaw.slice(0, 400) },
        { status: 200 },
      );
    }

    let thread: any = {};
    let messages: any[] = [];
    let participants: any[] = [];
    try {
      thread = JSON.parse(tRaw);
    } catch {}
    try {
      const mj = JSON.parse(mRaw);
      messages = Array.isArray(mj?.results) ? mj.results : Array.isArray(mj) ? mj : [];
    } catch {}
    try {
      const pj = JSON.parse(pRaw);
      participants = Array.isArray(pj?.results) ? pj.results : Array.isArray(pj) ? pj : [];
    } catch {}

    // Subject (direct → tiny deep)
    let subject =
      (thread?.subject ??
        thread?.threadSubject ??
        thread?.title ??
        thread?.summary ??
        "")?.toString() ?? "";
    if (!subject) {
      const deep = JSON.stringify({ thread, messages, participants });
      const hit = deep.match(/"subject"\s*:\s*"([^"]+)"/i);
      subject = hit?.[1] ?? "";
    }

    const text = chooseLatestInbound(messages);

    // candidate collection (original paths + deep header/actor scan)
    const candEmails: string[] = [];

    // from / replyTo / recipients / to[]
    for (const m of messages) {
      const from = m?.from?.email ?? m?.from?.emailAddress ?? null;
      if (isEmail(from)) candEmails.push(from);
      const rt = m?.replyTo?.email ?? m?.replyTo?.emailAddress ?? null;
      if (isEmail(rt)) candEmails.push(rt);

      const recips: any[] = Array.isArray(m?.to) ? m?.to : [];
      for (const r of recips) {
        const e = r?.email ?? r?.emailAddress ?? null;
        if (isEmail(e)) candEmails.push(e);
      }

      // deep header/actor scrape
      addEmailsFrom(m?.sender, candEmails);
      addEmailsFrom(m?.actor, candEmails);
      addEmailsFrom(m?.initiatingActor, candEmails);
      addEmailsFrom(m?.recipients, candEmails);
      addEmailsFrom(m?.headers, candEmails);
    }

    // participants
    for (const p of participants) {
      const e =
        (p as any)?.email ??
        (p as any)?.emailAddress ??
        (p as any)?.participant?.email ??
        (p as any)?.participant?.emailAddress ??
        null;
      if (isEmail(e)) candEmails.push(e);
      addEmailsFrom(p, candEmails);
    }

    // thread-level hints
    const tFrom = thread?.from?.email ?? thread?.from?.emailAddress ?? null;
    if (isEmail(tFrom)) candEmails.push(tFrom);
    const tRt = thread?.replyTo?.email ?? thread?.replyTo?.emailAddress ?? null;
    if (isEmail(tRt)) candEmails.push(tRt);
    addEmailsFrom(thread, candEmails);

    const email = chooseCustomerEmail(candEmails, process.env.MS_MAILBOX_FROM) ?? "";

    return NextResponse.json(
      {
        ok: true,
        email,
        subject,
        text,
        threadId: objectId,
        src: {
          email: email ? "deep/chooser(stronger)" : "none",
          subject: subject ? "direct/deep" : "none",
          text: text ? "messages" : "none",
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "lookupEmail_exception" }, { status: 200 });
  }
}
