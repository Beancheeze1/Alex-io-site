// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ------------------------------ types ------------------------------ */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  threadId?: number;
  error?: string;
  status?: number;
  detail?: string;
  src?: {
    email: string;
    subject: string;
    text: string;
  };
};

/* ----------------------------- helpers ----------------------------- */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// true email string (not “Name <addr>”); tolerant to whitespace.
function isEmail(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = s.trim().match(EMAIL_RE);
  return !!(m && m.length === 1 && m[0].length === s.trim().length);
}

/** Collect ALL email-looking strings from any JSON shape. */
function collectEmailsDeep(value: any, out: Set<string>): void {
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
      // common key names where emails hide; if nested, still walk
      if (
        /(^|\.)(from|replyTo|sender|actor|initiatingActor|owner|participant|participants|to|cc|bcc|recipients|emails?|addresses?|emailAddress)$/i.test(
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

/** Find any subject-like string anywhere in the JSON. */
function findSubjectDeep(obj: any): string {
  if (!obj || typeof obj !== "object") return "";
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === "string" && v.trim() && /subject/i.test(k)) {
        return v.trim();
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return "";
}

/** Prefer the *customer* address (not your mailbox/domain; avoid noreply/system). */
function chooseCustomerEmail(
  candsIn: Iterable<string>,
  mailboxFromEnv?: string
): string | null {
  const unique = Array.from(new Set(Array.from(candsIn).map((e) => e.toLowerCase()))).filter(
    (e) => EMAIL_RE.test(e)
  );
  if (!unique.length) return null;

  const mailbox = (mailboxFromEnv || process.env.MS_MAILBOX_FROM || "").toLowerCase();
  const mailboxDomain = mailbox.split("@")[1] || "";

  const systemish = (e: string) =>
    e.includes("no-reply") || e.includes("noreply") || e.includes("hubspot");

  const publicBumps = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"];

  const score = (e: string) => {
    let s = 0;
    if (mailbox && e !== mailbox) s += 4; // not your exact mailbox
    if (mailboxDomain && !e.endsWith("@" + mailboxDomain)) s += 3; // not your domain
    if (!systemish(e)) s += 2; // not noreply/system
    if (publicBumps.some((d) => e.endsWith("@" + d))) s += 1; // mild preference to consumer domains
    return s;
  };

  return unique.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Use most recent inbound (non-system) message's text as fallback. */
function chooseLatestInbound(messages: any[]): { email: string | null; text: string } {
  const pick =
    [...messages].reverse().find((m) => {
      const dir = String(m?.direction ?? "").toUpperCase();
      const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
      return dir !== "OUTBOUND" && type !== "SYSTEM" && type !== "NOTE";
    }) ?? messages[messages.length - 1];

  const body = String(pick?.text ?? pick?.body ?? pick?.content ?? "");
  const e = pick?.from?.email ?? pick?.from?.emailAddress ?? null;
  return { email: isEmail(e) ? e : null, text: body };
}

/** Get HubSpot access token: prefer direct bearer, else refresh flow. */
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

/* -------------------------------- route ------------------------------- */

export async function POST(req: Request) {
  try {
    const payload = (await req.json().catch(() => ({}))) as any;
    const objectId = Number(payload.objectId ?? payload.threadId);
    if (!objectId) {
      return NextResponse.json<LookupOut>(
        { ok: false, error: "missing objectId or threadId" },
        { status: 200 }
      );
    }

    const tok = await getAccessToken();
    if (!tok.ok) {
      return NextResponse.json<LookupOut>(
        { ok: false, error: tok.error, status: tok.status, detail: tok.detail },
        { status: 200 }
      );
    }

    // Fetch thread + messages + participants in parallel.
    const headers = { Authorization: `Bearer ${tok.token}` };

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
      return NextResponse.json<LookupOut>(
        {
          ok: false,
          status: tRes.status,
          error: "hubspot_thread_fetch_failed",
          detail: tRaw.slice(0, 800),
        },
        { status: 200 }
      );
    }

    // Parse, but tolerate shape differences.
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

    // SUBJECT: direct fields first, then deep scan anywhere.
    let subject =
      thread?.subject ??
      thread?.threadSubject ??
      thread?.title ??
      (thread?.summary ? String(thread.summary) : "") ??
      "";
    if (!subject) subject = findSubjectDeep({ thread, messages, participants });

    // TEXT fallback (and possibly a candidate from its "from")
    const latest = chooseLatestInbound(messages);
    const text = latest.text || "";

    // EMAIL candidates from everything that smells like an email.
    const emailSet = new Set<string>();
    collectEmailsDeep(messages, emailSet);
    collectEmailsDeep(participants, emailSet);
    collectEmailsDeep(thread, emailSet);
    if (latest.email) emailSet.add(latest.email.toLowerCase());

    const picked = chooseCustomerEmail(emailSet, process.env.MS_MAILBOX_FROM);
    const email = picked ?? "";

    return NextResponse.json<LookupOut>(
      {
        ok: true,
        email,
        subject: subject || "",
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
    return NextResponse.json<LookupOut>(
      { ok: false, error: err?.message ?? "lookup_route_exception" },
      { status: 200 }
    );
  }
}
