// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------ helpers ------------------------------ */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Single-line key regex (no x-flag, no multiline) to avoid TS parse issues.
const KEY_RE =
  /(^|\.)(from|replyTo|sender|actor|initiatingActor|owner|participant|participants|to|cc|bcc|recipients|emails|addresses|email|emailAddress)(\.|$)/i;

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /[^@\s]+@[^@\s]+\.[^@\s]+/.test(s);
}

/** Collect *all* email-looking strings from any JSON shape. */
function collectEmailsDeep(value: any, out: Set<string>) {
  if (value == null) return;
  const t = typeof value;

  if (t === "string") {
    const hits = value.match(EMAIL_RE);
    if (hits) for (const h of hits) out.add(h.toLowerCase());
    return;
  }

  if (Array.isArray(value)) {
    for (const v of value) collectEmailsDeep(v, out);
    return;
  }

  if (t === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (KEY_RE.test(k)) {
        collectEmailsDeep(v, out);
      } else if (typeof v === "object") {
        collectEmailsDeep(v, out);
      } else if (typeof v === "string") {
        const hits = v.match(EMAIL_RE);
        if (hits) for (const h of hits) out.add(h.toLowerCase());
      }
    }
  }
}

/** Find any subject-like string anywhere in the JSON. */
function findSubjectDeep(obj: any): string {
  if (!obj || typeof obj !== "object") return "";
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === "string" && /subject/i.test(k)) return v.trim();
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return "";
}

/** Prefer the *customer* address (not your mailbox/domain; avoid noreply/hubspot). */
function chooseCustomerEmail(
  candsIn: Iterable<string>,
  mailboxFromEnv?: string
): string | null {
  const unique = Array.from(new Set(Array.from(candsIn).map((e) => e.toLowerCase()))).filter(
    isEmail
  );
  if (!unique.length) return null;

  const mailbox = (mailboxFromEnv || process.env.MS_MAILBOX_FROM || "").toLowerCase();
  const mailboxDomain = mailbox.split("@")[1] || "";

  const systemish = (e: string) =>
    e.includes("no-reply") || e.includes("noreply") || e.includes("hubspot");

  const publicBumps = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"];

  const score = (e: string) => {
    let s = 0;
    if (mailbox && e !== mailbox) s += 4; // not exactly your mailbox
    if (mailboxDomain && !e.endsWith("@" + mailboxDomain)) s += 3; // not your domain
    if (!systemish(e)) s += 2; // avoid noreply/systemish
    if (publicBumps.some((d) => e.endsWith("@" + d))) s += 1; // small bump for consumer mail
    return s;
    // Highest score wins
  };

  return unique.sort((a, b) => score(b) - score(a))[0] ?? null;
}

async function getAccessToken(): Promise<TokenResult> {
  // Direct bearer first (for dev)
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
  if (!r.ok) return { ok: false, error: "refresh_failed", status: r.status, detail: text.slice(0, 800) };

  try {
    const j = JSON.parse(text);
    const token = String(j.access_token || "");
    if (!token) return { ok: false, error: "no_access_token_in_response" };
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: "refresh_parse_error", detail: text.slice(0, 800) };
  }
}

/** Choose most recent inbound-ish message for a text fallback. */
function chooseLatestInbound(messages: any[]): { email: string | null; text: string } {
  if (!Array.isArray(messages) || !messages.length) return { email: null, text: "" };
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

/* -------------------------------- route -------------------------------- */

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json(
        { ok: false, error: "missing objectId or threadId" },
        { status: 200 }
      );
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json(
        { ok: false, error: tok.error, status: tok.status, detail: tok.detail },
        { status: 200 }
      );
    }

    // Fetch thread + messages + participants in parallel
    const headers = { Authorization: `Bearer ${tok.token}` } as const;

    const [tRes, mRes, pRes] = await Promise.all([
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, {
        headers,
        cache: "no-store",
      }),
      fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=100`,
        { headers, cache: "no-store" }
      ),
      fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/participants`,
        { headers, cache: "no-store" }
      ),
    ]);

    const [tRaw, mRaw, pRaw] = await Promise.all([tRes.text(), mRes.text(), pRes.text()]);
    if (!tRes.ok) {
      return NextResponse.json(
        { ok: false, status: tRes.status, error: "hubspot_thread_fetch_failed", body: tRaw.slice(0, 800) },
        { status: 200 }
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

    // Subject: try direct fields; then deep scan anywhere.
    let subject =
      thread?.subject ??
      thread?.threadSubject ??
      thread?.title ??
      thread?.summary ??
      "";
    if (!subject) subject = findSubjectDeep({ thread, messages, participants });

    // Text fallback from messages
    const textPick = chooseLatestInbound(messages);
    const text = textPick.text || "";

    // Build an email candidate set from anything that smells like an email
    const emailSet = new Set<string>();
    collectEmailsDeep(messages, emailSet);
    collectEmailsDeep(participants, emailSet);
    collectEmailsDeep(thread, emailSet);

    // Prefer customer (not our mailbox/domain and not noreply/system)
    const picked = chooseCustomerEmail(emailSet, process.env.MS_MAILBOX_FROM);
    const email = picked ?? "";

    return NextResponse.json(
      {
        ok: true,
        email,
        subject,
        text,
        threadId: objectId,
        src: {
          email: email ? "deep/chooser" : "none",
          subject: subject ? "direct/deep" : "none",
          text: text ? "messages" : "none",
        },
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "lookup_route_exception" },
      { status: 200 }
    );
  }
}
