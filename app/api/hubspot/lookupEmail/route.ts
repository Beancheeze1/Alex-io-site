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

function isPlaceholderEmail(e: string) {
  const s = e.toLowerCase();
  if (s.endsWith("@example.com")) return true;
  if (s.includes("@mx.example")) return true;
  if (s === "youremail@gmail.com" || s === "yourgmail@gmail.com" || s === "customer@example.com") return true;
  const local = s.split("@")[0] || "";
  return /^(your(email)?|test|sample|foo|bar|customer)$/i.test(local);
}

function firstEmailFrom(value: any): string | null {
  const set = new Set<string>();
  collectEmailsDeep(value, set);
  const arr = Array.from(set).filter(isEmail);
  return arr.length ? arr[0] : null;
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

// Light “find field” utility (case-insensitive, dotted keys allowed)
function findFieldDeep(obj: any, re: RegExp): string {
  if (!obj || typeof obj !== "object") return "";
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === "string" && re.test(k)) return v.trim();
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

/* ------------------------------ core work ------------------------------ */

// NEW: Detect bounce/NDR/system messages so we never pick them as “inbound”
function isBounceMessage(msg: any): boolean {
  try {
    const subj = String(msg?.subject || msg?.title || "").trim();
    if (/^(undeliverable|delivery status notification|mail delivery|returned mail)/i.test(subj)) return true;

    const sender =
      firstEmailFrom(msg?.from) ||
      firstEmailFrom(msg?.sender) ||
      firstEmailFrom(msg?.initiatingActor) ||
      firstEmailFrom(msg?.actor) ||
      "";

    if (sender) {
      const s = sender.toLowerCase();
      if (/^(postmaster|mailer-daemon|no-reply|noreply)@/.test(s)) return true;
      // Exchange internal “addr@*.prod.outlook.com” style bounce artifacts
      if (/\.prod\.outlook\.com$/i.test(s.split("@")[1] || "")) return true;
    }

    // Some bounces identify themselves in body text; cheap heuristic:
    const body = String(msg?.text || msg?.body || msg?.content || "").slice(0, 400).toLowerCase();
    if (body.includes("couldn't be delivered") || body.includes("delivery has failed")) return true;

    return false;
  } catch {
    return false;
  }
}

async function handleLookup(objectId: number, messageIdIn?: string) {
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

  // NEW: pick most recent INBOUND that is not SYSTEM/NOTE and not a bounce/NDR
  const pickInboundSmart = (arr: any[]): any | undefined => {
    const reversed = [...arr].reverse();
    for (const m of reversed) {
      const dir = String(m?.direction ?? "").toUpperCase();
      const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
      if (dir !== "INBOUND") continue;
      if (type === "SYSTEM" || type === "NOTE") continue;
      if (isBounceMessage(m)) continue;
      return m;
    }
    // fallback to the last item if nothing matched
    return reversed.find(m => String(m?.direction ?? "").toUpperCase() === "INBOUND") ?? arr[arr.length - 1];
  };

  const picked = pickInboundSmart(messages) ?? {};
  const text = String(picked?.text ?? picked?.body ?? picked?.content ?? "").trim();

  // Prefer the actual inbound sender
  let senderEmail =
    firstEmailFrom(picked?.from) ||
    firstEmailFrom(picked?.sender) ||
    firstEmailFrom(picked?.initiatingActor) ||
    firstEmailFrom(picked?.actor) ||
    firstEmailFrom(picked);

  // Email candidates (deep scan)
  const emailSet = new Set<string>();
  // NEW: Avoid poisoning the pool with obvious bounces
  const nonBounceMessages = messages.filter(m => !isBounceMessage(m));
  collectEmailsDeep(nonBounceMessages, emailSet);
  collectEmailsDeep(participants, emailSet);
  collectEmailsDeep(thread, emailSet);

  // Bias by message id if provided
  const messageId = String(
    messageIdIn ??
    messages.find(m => String(m?.id ?? m?.messageId ?? "") === messageIdIn)?.messageId ??
    picked?.messageId ??
    picked?.id ??
    ""
  ).trim();
  if (messageId) {
    const byId = messages.find(m => String(m?.id ?? m?.messageId ?? "") === messageId) || picked;
    if (byId && !isBounceMessage(byId)) collectEmailsDeep(byId, emailSet);
  }

  // inReplyTo if available
  const inReplyTo =
    findFieldDeep(picked, /in[_-]?reply[_-]?to/i) ||
    findFieldDeep(thread, /in[_-]?reply[_-]?to/i) ||
    "";

  // mailbox/own-domain guard + placeholder filter + sender-first selection
  const mailbox = (process.env.MS_MAILBOX_FROM ?? "").toLowerCase();
  const ownDomain = mailbox.split("@")[1] || "";
  const isOwn = (e: string) => e.toLowerCase() === mailbox || (ownDomain && e.toLowerCase().endsWith("@" + ownDomain));

  let email: string | null = null;
  if (senderEmail && isEmail(senderEmail) && !isOwn(senderEmail) && !isPlaceholderEmail(senderEmail)) {
    email = senderEmail.toLowerCase();
  }
  if (!email) {
    const filtered = Array.from(emailSet).filter(e =>
      isEmail(e) && !isOwn(e) && !isPlaceholderEmail(e)
    );
    email = chooseCustomerEmail(filtered, mailbox);
  }

  return NextResponse.json(
    {
      ok: true,
      email: email ?? "",
      subject,
      text,
      threadId: String(objectId),
      inReplyTo: inReplyTo || "",
      messageId: messageId || "",
      src: {
        emailDeepChooser: email ? "hit" : "miss",
        keys_thread: Object.keys(thread ?? {}),
        keys_messages: Object.keys(mJ ?? {}),
        keys_participants: Object.keys(pJ ?? {}),
      },
    },
    { status: 200 }
  );
}

/* ------------------------------- routes ------------------------------- */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const objectIdStr = url.searchParams.get("objectId") || url.searchParams.get("threadId") || "";
    const messageId = url.searchParams.get("messageId") || "";
    const objectId = Number(objectIdStr);
    return await handleLookup(objectId, messageId || undefined);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "lookup_route_exception" },
      { status: 200 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));
    const objectId = Number(payload.objectId ?? payload.threadId);
    const messageId = String(payload.messageId ?? "");
    return await handleLookup(objectId, messageId || undefined);
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "lookup_route_exception" },
      { status: 200 }
    );
  }
}
