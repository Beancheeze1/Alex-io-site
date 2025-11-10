// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  mode?: string;
  toEmail?: string;
  subject?: string;
  text?: string;
  threadId?: string | number;
  threadMsgs?: any[];
  dryRun?: boolean;
};

type Ok = { ok: true } & Record<string, any>;
type Err = { ok: false; error: string; detail?: any; status?: number };

function ok(extra: Record<string, any> = {}): Ok { return { ok: true, ...extra }; }
function err(error: string, status = 200, detail?: any): Err { return { ok: false, error, status, detail }; }

/* ---------------- utils ---------------- */
function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}
function mergeFacts(oldF: Record<string, any>, newF: Record<string, any>): Record<string, any> {
  return { ...(oldF || {}), ...compact(newF || {}) };
}
function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

function extractFactsFromText(input: string = ""): Record<string, any> {
  const txt = input.toLowerCase();
  const qtyMatch = txt.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) || txt.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);
  const qty = qtyMatch ? Number(qtyMatch[1]) : undefined;
  const dimsMatch = txt.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  const dims = dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined;
  const densMatch = txt.match(/\b(\d+(?:\.\d+)?)\s*lb\b/);
  const density = densMatch ? `${densMatch[1]}lb` : undefined;

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(txt)) material = "PE";
  else if (/\bpolyurethane\b|\bpu\b/.test(txt)) material = "PU";
  else if (/\bepe\b/.test(txt)) material = "EPE";

  return compact({ dims, qty, material, density });
}

function renderMemoryFooter(facts: Record<string, any>): string {
  // A small visible footer (survives sanitizers). Also useful for debugging.
  if (!facts || !Object.keys(facts).length) return "";
  const b64 = Buffer.from(JSON.stringify(facts)).toString("base64url");
  return `\n\n-- alexio:facts -- ${b64}`;
}

function buildPrompt(lastInbound: string, facts: Record<string, any>, context: string): string {
  const have = Object.entries(facts).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    "You are Alex-IO, a quoting assistant for protective foam packaging.",
    "Write a short, friendly, businesslike reply.",
    "Only ask for info that is missing. If dims, qty, material, and density are present, say you'll prepare the quote.",
    have ? `Facts: ${have}` : "Facts: (none)",
    context ? `Thread context: ${context}` : "",
    "",
    `Customer message:\n${lastInbound || "(none)"}`
  ].join("\n");
}

async function aiReply(lastInbound: string, facts: Record<string, any>, context: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    try {
      const prompt = buildPrompt(lastInbound, facts, context);
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 350 }),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      const text =
        j?.output_text ||
        j?.choices?.[0]?.message?.content?.[0]?.text ||
        j?.choices?.[0]?.message?.content ||
        j?.choices?.[0]?.text ||
        "";
      if (text) return String(text).trim();
    } catch {}
  }
  // fallback template
  const need: string[] = [];
  if (!facts.dims) need.push("dimensions (L x W x H)");
  if (!facts.qty) need.push("quantity");
  if (!facts.material) need.push("material (PE/EPE/PU)");
  if (!facts.density) need.push("desired density (e.g., 1.7 lb)");
  const lines: string[] = [];
  lines.push("Thanks for the details so far.");
  if (Object.keys(facts).length) {
    lines.push("");
    lines.push("• Dimensions: " + (facts.dims || "—"));
    lines.push("• Quantity: " + (facts.qty ?? "—"));
    lines.push("• Material: " + (facts.material || "—"));
    lines.push("• Density: " + (facts.density || "—"));
  }
  if (need.length) {
    lines.push("");
    lines.push("To proceed, please confirm:");
    for (const n of need) lines.push(`• ${n}`);
  } else {
    lines.push("");
    lines.push("Perfect — I’ll prepare your quote now and follow up shortly.");
  }
  return lines.join("\n");
}

async function parseBody(req: NextRequest): Promise<OrchestrateInput> {
  try { const j = await req.json(); if (j && typeof j === "object") return j; } catch {}
  try {
    const t = await req.text();
    if (!t) return {};
    let s = t.trim();
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
    const i = s.indexOf("{"), j = s.lastIndexOf("}");
    if (i >= 0 && j > i) return JSON.parse(s.slice(i, j + 1));
  } catch {}
  return {};
}

export async function POST(req: NextRequest) {
  try {
    const payload = await parseBody(req);
    const dryRun  = !!payload.dryRun;
    const mode    = String(payload.mode ?? "ai").toLowerCase();
    const lastMsg = String(payload.text || "");
    const threadMsgs = Array.isArray(payload.threadMsgs) ? payload.threadMsgs : [];
    const threadId   = payload.threadId ?? ""; // HubSpot objectId

    // 1) Extract new facts
    const newFacts   = extractFactsFromText(lastMsg);

    // 2) Load persisted facts by threadId (primary)
    const persisted  = await loadFacts(threadId);

    // 3) Merge and save back
    const merged     = mergeFacts(persisted, newFacts);
    await saveFacts(threadId, merged);

    // 4) Build AI reply
    const context    = pickThreadContext(threadMsgs);
    const aiText     = await aiReply(lastMsg, merged, context);

    // Optional visible footer (survives sanitizers)
    const replyBody  = `${aiText}${renderMemoryFooter(merged)}`;

    // 5) Determine recipient
    const toEmail = String(payload.toEmail || process.env.MS_MAILBOX_FROM || "").trim();
    if (!toEmail) return NextResponse.json(err("missing_toEmail"), { status: 200 });

    if (dryRun) {
      return NextResponse.json(
        ok({ mode: "dryrun", sawMode: mode, toEmail, subject: payload.subject || "Quote", preview: replyBody.slice(0, 800), facts: merged }),
        { status: 200 }
      );
    }

    const base   = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: payload.subject || "Re: your foam quote request",
        text: replyBody,
        dryRun: false
      }),
      cache: "no-store",
    });
    const sent   = await r.json().catch(() => ({}));
    const okHttp = r.ok || r.status === 202;

    return NextResponse.json(
      ok({ sent: okHttp, status: r.status, toEmail, sawMode: mode, result: sent?.result || (okHttp ? "sent" : "error"), facts: merged }),
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(err("orchestrate_exception", 200, String(e?.message || e)), { status: 200 });
  }
}
