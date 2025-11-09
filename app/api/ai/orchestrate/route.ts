// app/api/ai/orchestrate/route.ts
import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------- small utils ----------
const isStr = (v: unknown): v is string => typeof v === "string";
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function ok<T>(data: T, status = 200) {
  return NextResponse.json(data as any, { status });
}
function fail(error: string, detail?: any, status = 200) {
  return NextResponse.json({ ok: false, error, detail }, { status });
}

// ---------- HubSpot auth (kept from your prior flow) ----------
type TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number; detail?: string };

async function getAccessToken(): Promise<TokenResult> {
  const direct = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
  if (direct) return { ok: true, token: direct };

  const refresh = process.env.HUBSPOT_REFRESH_TOKEN2?.trim();
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

// ---------- Conversations fetch ----------
type HSMessage = {
  id?: string | number;
  direction?: "INBOUND" | "OUTBOUND";
  type?: string;
  messageType?: string;
  text?: string;
  body?: string;
  content?: string;
  createdAt?: string | number;
};
type HSThread = any;

async function fetchThreadBundle(objectId: number, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const [tRaw, mRaw] = await Promise.all([
    fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}`, { headers, cache: "no-store" }).then(r => r.text()),
    fetch(`https://api.hubapi.com/conversations/v3/conversations/threads/${objectId}/messages?limit=100`, { headers, cache: "no-store" }).then(r => r.text()),
  ]);

  let thread: HSThread = {};
  let messages: HSMessage[] = [];
  try { thread = JSON.parse(tRaw); } catch {}
  try {
    const mj = JSON.parse(mRaw);
    messages = Array.isArray(mj?.results) ? mj.results : (Array.isArray(mj) ? mj : []);
  } catch {}

  return { thread, messages };
}

// ---------- Memory extraction (regex + our own tag) ----------
type Facts = {
  dims?: string;       // e.g., "2x3x1"
  qty?: number;
  material?: string;   // "PE foam 1.7lb" etc.
  density?: string;    // "1.7lb" etc.
  color?: string;
  shipBy?: string;     // date or "ASAP"
  company?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

const DIM_RE = /\b(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches)?)\b/;
const QTY_RE = /\bqty\W*(\d{1,6})\b|\b(\d{1,6})\s*(?:pcs|pieces|units|qty)\b/i;
const DENS_RE = /\b([0-9](?:\.[0-9])?\s*lb)\b/i;
const MAT_RE = /\b(PE|EPE|PU|polyethylene|polyurethane|foam|st\-.+|xlpe)\b.*?(?:\bfoam\b)?/i;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PO_RE = /\bPO[:\s#-]*([A-Za-z0-9\-]{3,})\b/i;

function parseAlexioMemoryTag(text: string): Partial<Facts> {
  // looks for <!--ALEXIO:MEMORY {...} -->
  if (!isStr(text)) return {};
  const m = text.match(/<!--ALEXIO:MEMORY\s+({[\s\S]*?})\s*-->/i);
  if (!m) return {};
  try {
    const j = JSON.parse(m[1]);
    return j && typeof j === "object" ? (j as Partial<Facts>) : {};
  } catch { return {}; }
}

function mergeFacts(a: Partial<Facts>, b: Partial<Facts>): Facts {
  return {
    dims: b.dims || a.dims,
    qty: b.qty ?? a.qty,
    material: b.material || a.material,
    density: b.density || a.density,
    color: b.color || a.color,
    shipBy: b.shipBy || a.shipBy,
    company: b.company || a.company,
    contact: b.contact || a.contact,
    phone: b.phone || a.phone,
    email: b.email || a.email,
    address: b.address || a.address,
    notes: [a.notes, b.notes].filter(Boolean).join(" ").trim() || undefined,
  };
}

function extractFactsFreeText(text: string): Partial<Facts> {
  if (!isStr(text) || !text.trim()) return {};
  const out: Partial<Facts> = {};
  const d = text.match(DIM_RE);
  if (d) out.dims = `${d[1]}x${d[2]}x${d[3]}`;
  const q = text.match(QTY_RE);
  if (q) out.qty = Number(q[1] || q[2]);
  const den = text.match(DENS_RE);
  if (den) out.density = den[1].replace(/\s+/g, "");
  const mat = text.match(MAT_RE);
  if (mat) out.material = mat[0].replace(/\s+/g, " ").trim();
  const ph = text.match(PHONE_RE);
  if (ph) out.phone = ph[0];
  const em = text.match(EMAIL_RE);
  if (em) out.email = em[0];
  const po = text.match(PO_RE);
  if (po) out.notes = `PO:${po[1]}`;
  return out;
}

function factsFromThread(messages: HSMessage[]): Facts {
  // newest last:
  const sorted = [...messages].sort((a, b) => {
    const at = Number(a?.createdAt ?? 0);
    const bt = Number(b?.createdAt ?? 0);
    return at - bt;
  });

  let f: Facts = {};
  for (const m of sorted) {
    const raw = String(m.text ?? m.body ?? m.content ?? "");
    if (!raw) continue;
    // hidden memory first (strongest)
    f = mergeFacts(f, parseAlexioMemoryTag(raw));
    // then free-text regex (weaker)
    f = mergeFacts(f, extractFactsFreeText(raw));
  }
  return f;
}

function missingList(f: Facts): string[] {
  const miss: string[] = [];
  if (!f.dims) miss.push("length x width x height (inches)");
  if (typeof f.qty !== "number") miss.push("quantity");
  if (!f.material) miss.push("foam type (PE/EPE/PU) and density (lb/ft³)");
  return miss;
}

function renderMemoryTag(f: Facts) {
  return `\n\n<!--ALEXIO:MEMORY ${JSON.stringify(f)} -->`;
}

// ---------- Build thread context (trim to ~3–4k chars) ----------
function pickThreadContext(messages: HSMessage[]): string {
  // Keep alternating customer/bot snippets, newest last; trim long html.
  const pieces: string[] = [];
  const maxChars = 3500;

  const cleaned = messages
    .slice(-15)
    .map(m => {
      const who = m.direction === "OUTBOUND" ? "BOT" : "CUSTOMER";
      const raw = String(m.text ?? m.body ?? m.content ?? "").replace(/<[^>]+>/g, " ");
      const line = `[${who}] ${raw}`.replace(/\s+/g, " ").trim();
      return line.slice(0, 600);
    });

  for (const line of cleaned) {
    pieces.push(line);
    if (pieces.join("\n").length > maxChars) break;
  }
  return pieces.join("\n");
}

// ---------- OpenAI reply ----------
async function renderReply(
  userText: string,
  facts: Facts,
  threadContext: string,
  model = process.env.OPENAI_MODEL || "gpt-4o-mini"
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Fallback "canned but context aware" reply when no key
    const miss = missingList(facts);
    if (miss.length) {
      return `Thanks for the details—we still need: ${miss.join(", ")}. Reply with the missing items and we'll price it right away.`;
    }
    return `Thanks! We'll run the quote now and follow up shortly.`;
  }

  const sys = [
    `You are Alex-IO, a quoting assistant for protective foam packaging (PE/EPE/PU).`,
    `Use the provided facts from earlier in the thread; **do not ask again** for any detail that is already present.`,
    `Only request information that is truly missing. Be concise, professional, and specific to foam quoting.`,
    `If all required details exist (dims, qty, material/density), produce a short confirmation and next step (no price math yet).`,
  ].join("\n");

  const factsLine = `KNOWN_FACTS: ${JSON.stringify(facts)}`;
  const ctx = `THREAD_CONTEXT:\n${threadContext}`;

  const body = {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: `${factsLine}\n${ctx}\n\nLATEST_CUSTOMER_MESSAGE:\n${userText}` },
    ],
    temperature: 0.2,
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });

  const j = await r.json().catch(() => ({}));
  const text =
    j?.choices?.[0]?.message?.content ||
    `Thanks! We'll review and follow up shortly.`;

  return String(text);
}

// ---------- route ----------
type OrchestrateInput = {
  mode: "ai";
  toEmail?: string;         // explicit override (tests)
  subject?: string;
  text?: string;
  threadId?: number;        // HubSpot objectId
  dryRun?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json().catch(() => ({}))) as Partial<OrchestrateInput>;
    const mode = payload.mode || "ai";
    if (mode !== "ai") return fail("unsupported_mode");

    const dryRun = !!payload.dryRun;
    const objectId = Number(payload.threadId || 0);
    const explicitTo = payload.toEmail?.trim();

    // 1) If we have a thread, pull context; else minimal
    let threadMsgs: HSMessage[] = [];
    let lastInboundText = String(payload.text || "").trim();

    if (objectId) {
      const tok = await getAccessToken();
      if (!tok.ok) return fail("hubspot_auth_error", tok, 200);
      const { messages } = await fetchThreadBundle(objectId, tok.token);
      threadMsgs = Array.isArray(messages) ? messages : [];
      // pick the latest inbound text if not provided
      if (!lastInboundText) {
        const pick = [...threadMsgs].reverse().find(m => (m.direction || "").toUpperCase() === "INBOUND");
        lastInboundText = String(pick?.text ?? pick?.body ?? pick?.content ?? "").trim();
      }
    }

    // 2) Build memory/facts from the whole thread
    const facts = factsFromThread(threadMsgs.concat([{ direction: "INBOUND", text: lastInboundText } as HSMessage]));

    // 3) Build a compact thread context
    const context = pickThreadContext(threadMsgs);

    // 4) Generate reply using known facts (no re-asking)
    const aiText = await renderReply(lastInboundText, facts, context);

    // 5) Append hidden memory tag so the next turn still knows what we know
    const replyBody = `${aiText}${renderMemoryTag(facts)}`;

    // 6) Decide destination
    const toEmail = explicitTo || facts.email || process.env.MS_MAILBOX_FROM || "";

    // DRY RUN path (kept): show what we *would* send
    if (dryRun) {
      return ok({
        ok: true,
        mode: "dryrun",
        to: toEmail,
        subject: payload.subject || "(no subject)",
        preview: replyBody.slice(0, 800),
        facts,
      });
    }

    // 7) Real send — reuse your working /msgraph/send route by POSTing
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: payload.subject || "Re: your foam quote request",
        text: replyBody,
        dryRun: false,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({}));

    return ok({
      ok: true,
      sent: sendRes.ok,
      toEmail,
      ms: sendJson?.ms ?? undefined,
      result: sendJson?.result ?? (sendRes.ok ? "sent" : "failed"),
      facts,
    });
  } catch (err: any) {
    return fail("orchestrate_exception", err?.message ?? String(err));
  }
}
