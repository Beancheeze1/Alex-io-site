// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ----------------------------- helpers ----------------------------- */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const isEmail = (s: unknown) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Collect every string that “looks like” an email anywhere in any JSON shape. */
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
      // keys that usually hold addresses – scan aggressively
      if (
        /(^|\.)(from|replyTo|sender|actor|initiatingActor|owner|participant|participants|to|cc|bcc|recipients|email|emails|emailAddress|addresses)$/i.test(
          k
        )
      ) {
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

function chooseCustomerEmail(candsIn: Iterable<string>, mailboxFromEnv?: string): string | null {
  const unique = Array.from(new Set([...candsIn].map(s => s.toLowerCase()))).filter(isEmail);
  if (!unique.length) return null;

  const mailbox = (mailboxFromEnv ?? process.env.MS_MAILBOX_FROM ?? "").toLowerCase();
  const domain = mailbox.split("@")[1] || "";
  const isSystem = (e: string) =>
    e.includes("no-reply") || e.includes("noreply") || e.includes("hubspot") || e.endsWith("@noreply.com");

  const publicHints = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"];

  const bannedDomains = [domain].filter(Boolean);
  const score = (e: string) => {
    let s = 0;
    if (mailbox && e !== mailbox) s += 4;
    if (domain && !e.endsWith("@" + domain)) s += 3;
    if (!isSystem(e)) s += 2;
    if (publicHints.some(d => e.endsWith("@" + d))) s += 1;
    return s;
  };

  // remove obvious internal addresses
  const filtered = unique.filter(e => !bannedDomains.some(d => e.endsWith("@" + d)));
  const pool = filtered.length ? filtered : unique;

  return pool.sort((a, b) => score(b) - score(a))[0] ?? null;
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
  if (!r.ok) return { ok: false, error: "refresh_failed", status: r.status, detail: text.slice(0, 500) };

  try {
    const j = JSON.parse(text);
    const token = String(j.access_token ?? "");
    if (!token) return { ok: false, error: "no_access_token_in_response" };
    return { ok: true, token };
  } catch {
    return { ok: false, error: "refresh_parse_error", detail: text.slice(0, 500) };
  }
}

/* ------------------------------- route ------------------------------- */

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const objectId = Number(payload.objectId ?? payload.threadId);
    const messageId = String(payload.messageId ?? "");

    if (!objectId) {
      return NextResponse.json({ ok: false, error: "missing objectId or threadId" }, { status: 200 });
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json({ ok: false, error: tok.error, status: tok.status, detail: tok.detail }, { status: 200 });
    }
    const headers = { Authorization: `Bearer ${tok.token}` };

    // Fetch thread, messages, participants
    const [tRes, mRes, pRes] = await Promise.all([
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, { headers, cache: "no-store" }),
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=200`, { headers, cache: "no-store" }),
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/participants`, { headers, cache: "no-store" }),
    ]);

    const [tText, mText, pText] = await Promise.all([tRes.text(), mRes.text(), pRes.text()]);

    let thread: any = {}; try { thread = JSON.parse(tText); } catch {}
    let mJ: any = {}; let messages: any[] = [];
    try { mJ = JSON.parse(mText); messages = Array.isArray(mJ?.results) ? mJ.results : Array.isArray(mJ) ? mJ : []; } catch {}
    let pJ: any = {}; let participants: any[] = [];
    try { pJ = JSON.parse(pText); participants = Array.isArray(pJ?.results) ? pJ.results : Array.isArray(pJ) ? pJ : []; } catch {}

    // Subject
    let subject =
      thread?.subject ??
      thread?.threadSubject ??
      thread?.title ??
      thread?.summary ??
      findSubjectDeep({ thread, messages, participants }) ??
      "";

    // Text fallback – choose most recent inbound non-system
    const pickInbound = (arr: any[]): any =>
      [...arr].reverse().find(m => {
        const dir = String(m?.direction ?? "").toUpperCase();
        const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
        return dir === "INBOUND" && type !== "SYSTEM" && type !== "NOTE";
      }) ?? arr[arr.length - 1];

    const picked = pickInbound(messages) ?? {};
    const text = String(picked?.text ?? picked?.body ?? picked?.content ?? "").trim();

    // Email candidates
    const emailSet = new Set<string>();
    collectEmailsDeep(messages, emailSet);
    collectEmailsDeep(participants, emailSet);
    collectEmailsDeep(thread, emailSet);

    // EXTRA: if we have a messageId, try to bias toward its sender/actors
    if (messageId) {
      const byId = messages.find(m => String(m?.id ?? m?.messageId ?? "") === messageId);
      if (byId) collectEmailsDeep(byId, emailSet);
    }

    const email = chooseCustomerEmail(emailSet);

    return NextResponse.json(
      {
        ok: true,
        email: email ?? "",
        subject,
        text,
        threadId: objectId,
        src: {
          emailDeepChooser: email ? "hit" : "miss",
          keys_thread: Object.keys(thread ?? {}),
          keys_messages: Object.keys(mJ ?? {}),
          keys_participants: Object.keys(pJ ?? {}),
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
