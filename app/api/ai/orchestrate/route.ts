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

function ok(extra: Record<string, any> = {}) {
  return NextResponse.json({ ok: true, ...extra }, { status: 200 });
}
function err(error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail }, { status: 200 });
}

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === ""))
      out[k] = v;
  }
  return out as T;
}
function mergeFacts(a: Mem, b: Mem): Mem {
  return { ...(a || {}), ...compact(b || {}) };
}

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
  const dimsMatch = t.match(
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/
  );
  const densMatch = t.match(/\b(\d+(?:\.\d+)?)\s*lb\b/);
  const qtyMatch =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) || t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);

  let material: string | undefined;
  if (/\bpolyethylene\b|\bpe\b/.test(t)) material = "PE";
  else if (/\bpolyurethane\b|\bpu\b/.test(t)) material = "PU";
  else if (/\bepe\b/.test(t)) material = "EPE";

  return compact({
    dims: dimsMatch ? `${dimsMatch[1]}x${dimsMatch[2]}x${dimsMatch[3]}` : undefined,
    density: densMatch ? `${densMatch[1]}lb` : undefined,
    qty: qtyMatch ? Number(qtyMatch[1]) : undefined,
    material,
  });
}

// Footer intentionally disabled.
function renderFooter(_: Mem): string {
  return "";
}

// --- Improved AI reply logic with robust output parsing ---
async function aiReply(
  lastInbound: string,
  _facts: Mem,
  context: string
): Promise<{ text: string; ai: boolean; reason?: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) {
    try {
      const prompt = [
        "You are Alex-IO, a quoting assistant for protective foam packaging.",
        "Write a short, friendly, businesslike reply in your own words.",
        "Do NOT invent or restate specs; if a field isn't explicitly provided by the customer, leave it blank with an em dash.",
        "Avoid metadata, footers, or internal notes.",
        "",
        "Use this lightweight structure (you may add one short sentence above or below it for context):",
        "• Dimensions: —",
        "• Quantity: —",
        "• Material: —",
        "• Density: —",
        "",
        "Ask the customer to fill in the blanks or attach a sketch if helpful.",
        context
          ? `\nThread context (for tone/continuity only; do not copy specs verbatim):\n${context}`
          : "",
        `\nCustomer message:\n${lastInbound || "(none)"}`,
      ].join("\n");

      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: prompt,
          max_output_tokens: 300,
        }),
        cache: "no-store",
      });

      const j = await r.json().catch(() => ({}));
      let text =
        j?.output_text ||
        j?.output?.[0]?.content?.[0]?.text ||
        j?.choices?.[0]?.message?.content?.[0]?.text ||
        j?.choices?.[0]?.message?.content ||
        j?.choices?.[0]?.text ||
        "";

      if (text && typeof text === "string" && text.trim().length > 0) {
        console.log("[aiReply] ✅ text_from_model", text.slice(0, 120) + "...");
        return { text: String(text).trim(), ai: true };
      }

      console.warn("[aiReply] ⚠️ no_text", { j });
      return { text: "", ai: false, reason: "ai_no_text" };
    } catch (e: any) {
      console.error("[aiReply] exception", e?.message || e);
      return { text: "", ai: false, reason: "ai_exception" };
    }
  }

  // Fallback when no API key configured
  return {
    ai: false,
    reason: "no_api_key",
    text: [
      "Thanks for the details so far.",
      "",
      "• Dimensions: —",
      "• Quantity: —",
      "• Material: —",
      "• Density: —",
      "",
      "Please confirm the blanks above (or paste your specs). If you have a drawing or sketch, you can attach it.",
    ].join("\n"),
  };
}

async function parse(req: NextRequest): Promise<In> {
  try {
    const j = await req.json();
    if (j && typeof j === "object") return j;
  } catch {}
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
    const dryRun = !!p.dryRun;
    const lastText = String(p.text || "");
    const threadId = String(p.threadId ?? "").trim();
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    const newly = extractFactsFromText(lastText);
    let loaded: Mem = {};
    if (threadId) loaded = await loadFacts(threadId);

    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
    };
    const merged = mergeFacts({ ...loaded, ...carry }, newly);
    if (threadId) await saveFacts(threadId, merged);

    const context = pickThreadContext(threadMsgs);
    const { text: replyText, ai, reason: ai_reason } = await aiReply(lastText, merged, context);

    const body = replyText;
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();

    if (!toEmail)
      return err("missing_toEmail", {
        reason: "Lookup did not produce a recipient; refusing to fall back to mailbox.",
      });

    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`)))
      return err("bad_toEmail", {
        toEmail,
        reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies.",
      });

    const inReplyTo =
      String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info(
      "[orchestrate] msgraph/send { to:",
      toEmail,
      ", dryRun:",
      !!p.dryRun,
      ", threadId:",
      threadId || "<none>",
      ", inReplyTo:",
      inReplyTo ? "<id>" : "none",
      ", ai:",
      ai,
      ", ai_reason:",
      ai_reason || "n/a",
      "}"
    );

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 800),
        facts: merged,
        ai,
        ai_reason,
        mem: {
          threadId: String(threadId),
          loadedKeys: Object.keys(loaded),
          mergedKeys: Object.keys(merged),
        },
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
        dryRun: false,
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(() => ({}));

    if (threadId && (r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId:
          sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId:
          sent?.internetMessageId || merged?.__lastInternetMessageId || "",
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
      ai,
      ai_reason,
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
