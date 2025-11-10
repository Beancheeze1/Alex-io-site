// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

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

function ok(extra: Record<string, any> = {}): Ok {
  return { ok: true, ...extra };
}
function err(error: string, status = 200, detail?: any): Err {
  return { ok: false, error, status, detail };
}

/* ------------------------------ AI helpers ------------------------------ */

function extractFactsFromText(input: string = ""): Record<string, any> {
  const txt = input.toLowerCase();
  const qtyMatch = txt.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) || txt.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);
  const qty = qtyMatch ? Number(qtyMatch[1]) : undefined;
  const dimsMatch =
    txt.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  const dims = dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined;
  const densMatch = txt.match(/\b(\d+(?:\.\d+)?)\s*lb\b/);
  const density = densMatch ? `${densMatch[1]}lb` : undefined;

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(txt)) material = "PE";
  else if (/\bpolyurethane\b|\bpu\b/.test(txt)) material = "PU";
  else if (/\bepe\b/.test(txt)) material = "EPE";

  return compact({ dims, qty, material, density });
}

function buildPrompt(lastInbound: string, facts: Record<string, any>, context: string): string {
  const have = Object.entries(facts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return [
    "You are Alex-IO, a quoting assistant for protective foam packaging.",
    "Write a short, friendly, businesslike reply.",
    "Only ask for info that is missing. If all required info is present (dims, qty, material, density), say you'll prepare the quote.",
    "Confirm any extracted details as bullet points.",
    have ? `Facts: ${have}` : "Facts: (none)",
    context ? `Thread context: ${context}` : "",
    "",
    `Customer message:\n${lastInbound || "(none)"}`
  ].join("\n");
}

async function renderReply(lastInbound: string, mergedFacts: Record<string, any>, context: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    try {
      const prompt = buildPrompt(lastInbound, mergedFacts, context);
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 350 })
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

  const need: string[] = [];
  if (!mergedFacts.dims) need.push("dimensions (L x W x H)");
  if (!mergedFacts.qty) need.push("quantity");
  if (!mergedFacts.material) need.push("material (PE/EPE/PU)");
  if (!mergedFacts.density) need.push("desired density (e.g., 1.7 lb)");

  const lines: string[] = [];
  lines.push("Thanks for reaching out — here’s what I have so far:");
  if (Object.keys(mergedFacts).length) {
    lines.push("");
    lines.push("• Dimensions: " + (mergedFacts.dims || "—"));
    lines.push("• Quantity: " + (mergedFacts.qty ?? "—"));
    lines.push("• Material: " + (mergedFacts.material || "—"));
    lines.push("• Density: " + (mergedFacts.density || "—"));
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

function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

function renderMemoryTag(facts: Record<string, any>): string {
  const payload = JSON.stringify(compact(facts));
  return payload && payload !== "{}" ? `\n\n<!--ALEXIO:MEMORY ${payload} -->` : "";
}

function readMemoryTagFromThread(threadMsgs: any[] = []): Record<string, any> {
  const re = /<!--ALEXIO:MEMORY\s*(\{[\s\S]*?\})\s*-->/i;
  for (const m of threadMsgs.slice().reverse()) {
    const txt = [m?.text, m?.body, m?.content, m?.preview].filter(Boolean).join("\n");
    const match = re.exec(txt || "");
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }
  }
  return {};
}

function mergeFacts(oldF: Record<string, any>, newF: Record<string, any>): Record<string, any> {
  const cleaned = compact(newF || {});
  return { ...(oldF || {}), ...cleaned };
}

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}

/* ------------------------------ Body parsing ----------------------------- */

async function parseBody(req: NextRequest): Promise<OrchestrateInput> {
  // first try JSON
  try {
    const j = (await req.json()) as any;
    if (j && typeof j === "object") return j;
  } catch {}
  // then raw text (maybe JSON string)
  try {
    const t = await req.text();
    if (!t) return {};
    // handle cases like body = "\"{...}\"" or urlencoded
    let s = t.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      s = JSON.parse(s); // unwrap quotes
    }
    if (s.startsWith("{") && s.endsWith("}")) {
      const j = JSON.parse(s);
      if (j && typeof j === "object") return j;
    }
    // very defensive: try to extract JSON braces if extra text around
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      const j = JSON.parse(s.slice(first, last + 1));
      if (j && typeof j === "object") return j;
    }
  } catch {}
  return {};
}

/* --------------------------------- Route -------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const payload = (await parseBody(req)) as OrchestrateInput;

    // Accept anything; default to AI
    const mode = String(payload.mode ?? "ai").toLowerCase();
    const isAI = mode === "ai" || mode === "" || mode === "orchestrate";
    if (!isAI) {
      // still proceed as AI, but let caller know what we saw
      // (we do NOT bail anymore)
    }

    const dryRun = !!payload.dryRun;
    const explicitTo = String(payload.toEmail || "").trim();
    const lastInboundText = String(payload.text || "");
    const threadMsgs = Array.isArray(payload.threadMsgs) ? payload.threadMsgs : [];

    const freshFacts = extractFactsFromText(lastInboundText);
    const persistedFacts = readMemoryTagFromThread(threadMsgs);
    const mergedFacts = mergeFacts(persistedFacts, freshFacts);
    const context = pickThreadContext(threadMsgs);

    const aiText = await renderReply(lastInboundText, mergedFacts, context);
    const replyBody = `${aiText}${renderMemoryTag(mergedFacts)}`;

    const toEmail = explicitTo || process.env.MS_MAILBOX_FROM || "";
    if (!toEmail) {
      return NextResponse.json(err("missing_toEmail"), { status: 200 });
    }

    if (dryRun) {
      return NextResponse.json(
        ok({
          mode: "dryrun",
          sawMode: mode,
          toEmail,
          subject: payload.subject || "Quote",
          preview: replyBody.slice(0, 800),
          facts: mergedFacts
        }),
        { status: 200 }
      );
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: payload.subject || "Re: your foam quote request",
        text: replyBody,
        dryRun: false
      })
    });

    const sent = await r.json().catch(() => ({}));
    const okHttp = r.ok || r.status === 202;

    return NextResponse.json(
      ok({
        sent: okHttp,
        status: r.status,
        toEmail,
        sawMode: mode,
        result: sent?.result || (okHttp ? "sent" : "error"),
        facts: mergedFacts
      }),
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(err("orchestrate_exception", 200, String(e?.message || e)), { status: 200 });
  }
}
