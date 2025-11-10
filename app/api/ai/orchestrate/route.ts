// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  mode?: string;
  toEmail?: string;
  subject?: string;
  text?: string;
  threadId?: string | number;
  threadMsgs?: any[];
  dryRun?: boolean;
};
type Mem = Record<string, any>;

function ok(extra: Record<string, any> = {}) { return NextResponse.json({ ok: true, ...extra }, { status: 200 }); }
function err(error: string, detail?: any) { return NextResponse.json({ ok: false, error, detail }, { status: 200 }); }

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}
function mergeFacts(a: Mem, b: Mem): Mem { return { ...(a || {}), ...compact(b || {}) }; }

function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

function extractFactsFromText(input = ""): Mem {
  const t = input.toLowerCase();
  const dimsMatch = t.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  const densMatch = t.match(/\b(\d+(?:\.\d+)?)\s*lb\b/);
  const qtyMatch  = t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) || t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(t)) material = "PE";
  else if (/\bpolyurethane\b|\bpu\b/.test(t)) material = "PU";
  else if (/\bepe\b/.test(t)) material = "EPE";

  return compact({
    dims:    dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined,
    density: densMatch ? `${densMatch[1]}lb` : undefined,
    qty:     qtyMatch ? Number(qtyMatch[1]) : undefined,
    material,
  });
}

function renderFooter(facts: Mem): string {
  if (!facts || !Object.keys(facts).length) return "";
  const b64 = Buffer.from(JSON.stringify(facts)).toString("base64url");
  return `\n\n-- alexio:facts -- ${b64}`;
}

async function aiReply(lastInbound: string, facts: Mem, context: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    try {
      const prompt = [
        "You are Alex-IO, a quoting assistant for protective foam packaging.",
        "Write a short, friendly, businesslike reply.",
        "Only ask for info that is missing. If dims, qty, material, and density are all present, acknowledge and say you’ll prepare the quote.",
        `Facts: ${Object.entries(facts).map(([k,v])=>`${k}=${v}`).join(", ") || "(none)"}`,
        context ? `Thread context:\n${context}` : "",
        "",
        `Customer message:\n${lastInbound || "(none)"}`,
      ].join("\n");
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 350 }),
        cache: "no-store",
      });
      const j = await r.json().catch(()=> ({}));
      const text =
        j?.output_text ||
        j?.choices?.[0]?.message?.content?.[0]?.text ||
        j?.choices?.[0]?.message?.content ||
        j?.choices?.[0]?.text || "";
      if (text) return String(text).trim();
    } catch {}
  }
  // fallback template
  const need: string[] = [];
  if (!facts.dims)     need.push("dimensions (LxWxH)");
  if (!facts.qty)      need.push("quantity");
  if (!facts.material) need.push("material (PE/EPE/PU)");
  if (!facts.density)  need.push("desired density (e.g., 1.7 lb)");
  const lines: string[] = [];
  if (Object.keys(facts).length) {
    lines.push("Thanks for the details so far:");
    lines.push(`• Dimensions: ${facts.dims ?? "—"}`);
    lines.push(`• Quantity: ${facts.qty ?? "—"}`);
    lines.push(`• Material: ${facts.material ?? "—"}`);
    lines.push(`• Density: ${facts.density ?? "—"}`);
  }
  if (need.length) {
    lines.push("");
    lines.push("To proceed, please confirm:");
    need.forEach(n => lines.push(`• ${n}`));
  } else {
    lines.push("");
    lines.push("Perfect — I’ll prepare your quote now and follow up shortly.");
  }
  return lines.join("\n");
}

async function parse(req: NextRequest): Promise<In> {
  try { const j = await req.json(); if (j && typeof j === "object") return j; } catch {}
  try {
    const t = await req.text();
    let s = t?.trim() ?? "";
    if (!s) return {};
    if (s.startsWith('"') && s.endsWith('"')) s = JSON.parse(s);
    if (s.startsWith("{") && s.endsWith("}")) return JSON.parse(s);
  } catch {}
  return {};
}

export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun   = !!p.dryRun;
    const lastText = String(p.text || "");
    const threadId = String(p.threadId ?? "").trim();

    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    const newly  = extractFactsFromText(lastText);
    const loaded = await loadFacts(threadId);
    const merged = mergeFacts(loaded, newly);
    await saveFacts(threadId, merged);

    const context = pickThreadContext(threadMsgs);
    const reply   = await aiReply(lastText, merged, context);
    const body    = `${reply}${renderFooter(merged)}`;

    // Recipient resolution (STRICT: no fallback to our mailbox)
const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
const toEmail = String(p.toEmail || "").trim().toLowerCase();

if (!toEmail) {
  // Do not send without a real customer address
  return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
}

// Block self-replies to our mailbox/domain
const ownDomain = mailbox.split("@")[1] || "";
if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
  return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
}

// optional: clearer log
console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, "}");

    if (!toEmail) return err("missing_toEmail");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 800),
        facts: merged,
        mem: { threadId: String(threadId), loadedKeys: Object.keys(loaded), mergedKeys: Object.keys(merged) },
        store: LAST_STORE,  // <— report where we stored facts
      });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const sendUrl = `${base}/api/msgraph/send`;
    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: p.subject || "Re: your foam quote request",
        text: body,
        dryRun: false
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(()=> ({}));
    return ok({
      sent: r.ok || r.status === 202,
      status: r.status,
      toEmail,
      result: sent?.result || null,
      facts: merged,
      store: LAST_STORE,
    });
  } catch (e:any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
