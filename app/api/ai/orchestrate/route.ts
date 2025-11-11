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

// Previously encoded footer; now intentionally disabled.
function renderFooter(_: Mem): string {
  return "";
}

// === CHANGED: produce a clean, non-prefilled reply ===
async function aiReply(lastInbound: string, _facts: Mem, context: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    try {
      // Strong guardrails so the model never echoes parsed facts or adds a footer.
      const prompt = [
        "You are Alex-IO, a quoting assistant for protective foam packaging.",
        "Write a short, friendly, businesslike reply.",
        "Do NOT restate or guess customer specs. Do NOT include any metadata or footers.",
        "ALWAYS return the following template with BLANK bullets (em dashes).",
        "",
        "Template to output exactly (customize tone minimally, but keep blanks):",
        "Thanks for the details so far.",
        "",
        "• Dimensions: —",
        "• Quantity: —",
        "• Material: —",
        "• Density: —",
        "",
        "To proceed, please confirm the blanks above (or paste specs).",
        "If you have a drawing or sketch, you can attach it in your reply.",
        "",
        context ? `Thread context (do not quote back specs):\n${context}` : "",
        "",
        `Customer message (do not mirror specs):\n${lastInbound || "(none)"}`
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

  // Deterministic fallback (no facts).
  return [
    "Thanks for the details so far.",
    "",
    "• Dimensions: —",
    "• Quantity: —",
    "• Material: —",
    "• Density: —",
    "",
    "To proceed, please confirm the blanks above (or paste specs).",
    "If you have a drawing or sketch, you can attach it in your reply."
  ].join("\n");
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

    // === memory load/update ===
    const newly  = extractFactsFromText(lastText);
    const loaded = await loadFacts(threadId);
    // Preserve special keys
    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
    };
    const merged = mergeFacts({ ...loaded, ...carry }, newly);
    await saveFacts(threadId, merged);

    const context = pickThreadContext(threadMsgs);
    const reply   = await aiReply(lastText, merged, context);

    // IMPORTANT: no `-- alexio:facts --` footer appended
    const body    = reply;

    // Recipient resolution (STRICT: no fallback to our mailbox)
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();

    if (!toEmail) {
      return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    }
    // Block self-replies to our mailbox/domain
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, ", threadId:", threadId, ", inReplyTo:", inReplyTo ? "<id>" : "none", "}");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 800),
        facts: merged,
        mem: { threadId: String(threadId), loadedKeys: Object.keys(loaded), mergedKeys: Object.keys(merged) },
        inReplyTo: inReplyTo || null,
        store: LAST_STORE,
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
        inReplyTo: inReplyTo || null,
        dryRun: false
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(()=> ({}));

    // Persist outbound IDs
    if ((r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      await saveFacts(threadId, updated);
    }

    return ok({
      sent: r.ok || r.status === 202,
      status: r.status,
      toEmail,
      result: sent?.result || null,
      messageId: sent?.messageId || null,
      internetMessageId: sent?.internetMessageId || null,
      facts: merged,
      store: LAST_STORE,
    });
  } catch (e:any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
