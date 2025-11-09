// app/api/hubspot/lookupEmail/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ----------------------------- types ----------------------------- */

type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

type LookupOut = {
  ok: boolean;
  email?: string;
  subject?: string;
  text?: string;
  threadId?: number;
  src?: {
    email: string;
    subject: string;
    text: string;
  };
  error?: string;
  status?: number;
  detail?: string;
};

/* ---------------------------- helpers ---------------------------- */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SUBJECT_RE = /(subject|threadsubject|title|summary)$/i;

const SYS_HINTS = ["no-reply", "noreply", "hubspot"];

const HARD_BANNED_DOMAINS = new Set<string>([
  // belt + suspenders: ban whole brand domain explicitly
  "alex-io.com",
]);

function toLowerTrim(s: string) {
  return s.toLowerCase().trim();
}

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Walk any JSON looking for anything that *looks* like an email string. */
function collectEmailsDeep(value: any, out: Set<string>) {
  if (value == null) return;
  const t = typeof value;

  if (t === "string") {
    const hits = value.match(EMAIL_RE);
    if (hits) for (const h of hits) out.add(toLowerTrim(h));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectEmailsDeep(v, out);
    return;
  }
  if (t === "object") {
    for (const [k, v] of Object.entries(value)) {
      // common keys that hold addresses or nested address arrays/objects
      if (
        /^(from|replyto|sender|actor|initiatingactor|owner|participant|participants|to|cc|bcc|recipients|addresses|email|emailaddress)$/i.test(
          k
        )
      ) {
        collectEmailsDeep(v, out);
      } else if (typeof v === "object") {
        collectEmailsDeep(v, out);
      } else if (typeof v === "string") {
        const hits = v.match(EMAIL_RE);
        if (hits) for (const h of hits) out.add(toLowerTrim(h));
      }
    }
  }
}

/** Find any plausible subject text anywhere in the JSON. */
function findSubjectDeep(obj: any): string {
  if (!obj || typeof obj !== "object") return "";
  const stack: any[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (typeof v === "string" && v.trim() && SUBJECT_RE.test(k)) {
        return v.trim();
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return "";
}

/** Choose most recent inbound message for text/email fallback. */
function chooseLatestInbound(messages: any[]): { email: string | null; text: string } {
  if (!Array.isArray(messages) || !messages.length) return { email: null, text: "" };
  const pick =
    [...messages]
      .reverse()
      .find((m) => {
        const dir = String(m?.direction ?? "").toUpperCase(); // INBOUND/OUTBOUND
        const type = String(m?.type ?? m?.messageType ?? "").toUpperCase();
        return dir !== "OUTBOUND" && type !== "SYSTEM" && type !== "NOTE";
      }) ?? messages[messages.length - 1];

  const body = String(pick?.text ?? pick?.body ?? pick?.content ?? "");
  const e =
    (pick?.from?.email as string) ??
    (pick?.from?.emailAddress as string) ??
    null;

  return { email: isEmail(e) ? e : null, text: body };
}

/** Strong chooser: ban exact mailbox, its domain, and any hard-banned domains. */
function chooseCustomerEmail(
  candsIn: Iterable<string>,
  mailboxFromEnv?: string
): { email: string | null; why: string } {
  const uniq = Array.from(new Set(Array.from(candsIn).map(toLowerTrim))).filter((e) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  );
  if (!uniq.length) return { email: null, why: "no_candidates" };

  const mailbox = toLowerTrim(mailboxFromEnv || process.env.MS_MAILBOX_FROM || "");
  const mailboxDomain = mailbox.includes("@") ? mailbox.split("@")[1] : "";

  // Dynamic+hard domain bans
  const bannedDomains = new Set<string>([
    ...Array.from(HARD_BANNED_DOMAINS),
    ...(mailboxDomain ? [mailboxDomain] : []),
  ]);

  const isSystemish = (e: string) => SYS_HINTS.some((h) => e.includes(h));
  const isBannedDomain = (e: string) =>
    Array.from(bannedDomains).some((d) => d && e.endsWith("@" + d));
  const isMailbox = (e: string) => (!!mailbox && e === mailbox) || false;

  const strong = uniq.filter((e) => !isMailbox(e) && !isBannedDomain(e) && !isSystemish(e));
  const weak = uniq.filter((e) => !isMailbox(e) && !isSystemish(e));

  const pool = strong.length ? strong : weak.length ? weak : uniq;

  // light preference for public mailbox providers
  const publicBumps = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);
  const score = (e: string) => {
    const d = e.split("@")[1] || "";
    let s = 0;
    if (mailbox && e !== mailbox) s += 4;
    if (mailboxDomain && d !== mailboxDomain) s += 3;
    if (!isSystemish(e)) s += 2;
    if (publicBumps.has(d)) s += 1;
    return s;
  };

  const chosen = pool.sort((a, b) => score(b) - score(a))[0] ?? null;

  const why =
    (strong.length ? "strong" : weak.length ? "weak" : "fallback") +
    `; bannedDomains=[${Array.from(bannedDomains).join(",")}] mailbox=${mailbox || "-"}`;

  // If after all that we still hit alex-io.com, null it so caller can fallback to participants
  if (chosen && chosen.endsWith("@alex-io.com")) {
    return { email: null, why: `${why}; null_due_to_hard_ban_alex-io.com` };
  }

  return { email: chosen, why };
}

/* ------------------------ HubSpot token helpers ------------------------ */

async function getAccessToken(): Promise<TokenResult> {
  // Direct bearer (developer token) if present
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  // Refresh flow (OAuth app)
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

/* ------------------------------- route ------------------------------- */

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

    const headers = { Authorization: `Bearer ${tok.token}` };

    // Fetch thread + messages + participants in parallel
    const [tRes, mRes, pRes] = await Promise.all([
      fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, {
        headers,
        cache: "no-store",
      }),
      fetch(
        `https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=200`,
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
        { ok: false, status: tRes.status, error: "hubspot_thread_fetch_failed", detail: tRaw.slice(0, 800) },
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

    // Subject: direct fields first, then deep scan anywhere
    let subject =
      (thread?.subject ??
        thread?.threadSubject ??
        thread?.title ??
        thread?.summary ??
        "")?.toString() ?? "";
    if (!subject) subject = findSubjectDeep({ thread, messages, participants });

    // Text + initial email from messages (recent inbound)
    const msgPick = chooseLatestInbound(messages);
    let text = msgPick.text || "";
    let emailFromMessages = msgPick.email;

    // Collect every email-looking string we can find
    const emailSet = new Set<string>();
    if (emailFromMessages) emailSet.add(toLowerTrim(emailFromMessages));
    collectEmailsDeep(messages, emailSet);
    collectEmailsDeep(participants, emailSet);
    collectEmailsDeep(thread, emailSet);

    // Strong chooser (bans mailbox, mailbox domain, and alex-io.com)
    const { email: chosen1, why } = chooseCustomerEmail(emailSet);

    // If chooser still null, try participants explicitly as a last resort
    let chosenEmail = chosen1;
    let emailSrc = `deep/chooser(${why})`;

    if (!chosenEmail) {
      const pSet = new Set<string>();
      collectEmailsDeep(participants, pSet);
      const fallback = chooseCustomerEmail(pSet);
      chosenEmail = fallback.email;
      emailSrc = `participants/chooser(${fallback.why})`;
    }

    // Absolute final guard: never return alex-io.com
    if (chosenEmail && chosenEmail.endsWith("@alex-io.com")) {
      chosenEmail = "";
      emailSrc += "; stripped_alex-io.com";
    }

    return NextResponse.json<LookupOut>(
      {
        ok: true,
        email: chosenEmail || "",
        subject,
        text,
        threadId: objectId,
        src: {
          email: emailSrc,
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
