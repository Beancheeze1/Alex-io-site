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

/* ===================== Parsing helpers (expanded) ===================== */

/** Normalize a dim token like 5 x 5 x 1" → 5x5x1 */
function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/,"").toLowerCase();
}

/** Parse LxWxH style dims anywhere in text */
function grabDims(t: string) {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}

/** Parse qty variants */
function grabQty(t: string) {
  const m = t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) || t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/) || t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);
  return m ? Number(m[1]) : undefined;
}

/** Parse density variants like 1.7#, 1.7 lb, 1.7lbs */
function grabDensity(t: string) {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/);
  return m ? `${m[1]}lb` : undefined;
}

/** Parse material synonyms */
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b/.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b/.test(t)) return "PU";
  return undefined;
}

/** Pull labeled lines like “Dimensions: 5x5x1”, “Cavities: 2”, “Cavity size: 1x2x3 each, 0.5x0.5x0.25” */
function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(normDims(val));
    out.cavityDims = list;
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim().replace(/^•\s*/, "");
    const t = line.toLowerCase();

    // Dimensions
    let m = t.match(/^dimensions?\s*[:\-]\s*(.+)$/);
    if (m) {
      const dims = grabDims(m[1]);
      if (dims) out.dims = normDims(dims);
      continue;
    }

    // Quantity
    m = t.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/);
    if (m) { out.qty = Number(m[1]); continue; }

    // Material
    if (/^material\s*[:\-]/.test(t)) {
      const mat = grabMaterial(t);
      if (mat) out.material = mat;
      continue;
    }

    // Density
    m = t.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)(?:\s*(?:lb|lbs|#))?\b/);
    if (m) { out.density = `${m[1]}lb`; continue; }

    // Cavities / pockets / cutouts
    // Count
    m = t.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?)\s*[:\-]\s*(\d{1,4})\b/);
    if (m) { out.cavityCount = Number(m[1]); continue; }

    // Sizes (allow comma separated, “each”, mix of Ø and LxW(H))
    // e.g., "cavity size: 1x2x3 each, Ø3 x 0.75", "pocket sizes: 1.5x0.5x0.25, 0.75x0.25x0.25"
    m = t.match(/^(?:cavity|pocket|cut[- ]?out)\s*(?:size|sizes)\s*[:\-]\s*(.+)$/);
    if (m) {
      const part = m[1].replace(/\beach\b/gi, "");
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const tokT = tok.trim();
        // Ødia x depth
        const md = tokT.match(/[øØo0]?\s*dia?\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i) ||
                   tokT.match(/[øØ]\s*(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i);
        if (md) { addCavity(`Ø${md[1]}x${md[2]}`); continue; }
        const dd = grabDims(tokT);
        if (dd) { addCavity(dd); continue; }
      }
      continue;
    }

    // Single inline cavity dim on one line
    const inlineCav = t.match(/(?:cavities?|pockets?|cut[- ]?outs?)[:\s]+(?:size|sizes)?[:\s]*((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/);
    if (inlineCav) addCavity(inlineCav[1]);
  }
  return out;
}

/** Free-text sweep for dims/qty/density/material + simple cavity cues */
function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase();
  const out: Mem = {};
  const dims = grabDims(t);
  if (dims) out.dims = normDims(dims);
  const qty = grabQty(t);
  if (qty !== undefined) out.qty = qty;
  const density = grabDensity(t);
  if (density) out.density = density;
  const material = grabMaterial(t);
  if (material) out.material = material;

  // “2 cavities each 1x2x3” / “two cutouts 0.5x0.5x0.25”
  const count = t.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/);
  if (count) out.cavityCount = Number(count[1]);

  // “each 1x2x3” / comma-separated
  const afterEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)+)/);
  if (afterEach) {
    const list = afterEach[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = list;
  } else {
    const singleEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/);
    if (singleEach) out.cavityDims = [normDims(singleEach[1])];
  }

  // Ødia x depth
  const roundCav = t.match(/[øØo0]?\s*dia?\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i);
  if (roundCav) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${roundCav[1]}x${roundCav[2]}`);
    out.cavityDims = list;
  }

  return compact(out);
}

/** Parse subject too (customers often put dims/qty up there) */
function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  return extractFreeText(s);
}

/* ===================== Rendering (human Q&A) ===================== */

const HUMAN_OPENERS = [
  "Appreciate the details—once we lock a few specs I’ll price this out.",
  "Thanks for sending this—happy to quote it as soon as I confirm a couple items.",
  "Got it—let me confirm a few specs and I’ll run pricing.",
  "Thanks for the info—if I can fill a couple gaps I’ll send numbers right away.",
];

function chooseOpener(seed: string) {
  // Simple deterministic hash so a thread gets a consistent opener
  let h = 2166136261 >>> 0;
  const s = seed || String(Date.now());
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return HUMAN_OPENERS[h % HUMAN_OPENERS.length];
}

function qaLine(label: string, value?: any): string {
  if (value === undefined || value === null || String(value).trim() === "") {
    // Ask a natural question for missing fields
    switch (label) {
      case "Dimensions": return "• Could you confirm the finished part dimensions (L×W×H, inches)?";
      case "Quantity": return "• What quantity should I price?";
      case "Material": return "• Do you prefer PE, EPE, or PU for this job?";
      case "Density": return "• If PE/EPE, what density (e.g., 1.7 lb)?";
      case "Cavities": return "• How many cavities/pockets are needed, if any?";
      case "Cavity sizes": return "• What are the cavity sizes? (L×W×Depth) If round, a diameter × depth like Ø3×0.75 works.";
      default: return `• ${label}?`;
    }
  }
  // When present, state as answer
  return `${label}: ${String(value)}`;
}

function renderQA(f: Mem, threadKey: string) {
  const opener = chooseOpener(threadKey);
  const lines: string[] = [opener, ""];

  lines.push(qaLine("Dimensions", f.dims));
  lines.push(qaLine("Quantity", f.qty));
  lines.push(qaLine("Material", f.material));
  lines.push(qaLine("Density", f.density));

  // Cavities
  const cavCount = f.cavityCount;
  const cavDims = Array.isArray(f.cavityDims) ? f.cavityDims : undefined;

  lines.push(qaLine("Cavities", cavCount));
  lines.push(qaLine("Cavity sizes", cavDims && cavDims.length ? cavDims.join(", ") : undefined));

  lines.push("");
  lines.push("If you have a quick sketch or drawing, you can attach it and I’ll make sure I captured everything.");

  return lines.join("\n");
}

/* ===================== Optional: tiny AI opener (kept) ===================== */
async function aiOpener(lastInbound: string, context: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const prompt = [
      "Write ONE natural sentence acknowledging the message and saying you'll price it once specs are confirmed.",
      "No bullets or extra lines. Keep it friendly and concise.",
      context ? `Context:\n${context}` : "",
      `Customer message:\n${lastInbound || "(none)"}`,
    ].filter(Boolean).join("\n\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: prompt, max_output_tokens: 60 }),
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    const text =
      j?.output_text ||
      j?.output?.[0]?.content?.[0]?.text ||
      j?.choices?.[0]?.message?.content?.[0]?.text ||
      j?.choices?.[0]?.message?.content ||
      j?.choices?.[0]?.text || "";
    const one = String(text || "").trim().replace(/\s+/g, " ");
    if (one) {
      console.log("[aiReply] opener_from_model", one.slice(0, 120));
      return one;
    }
    return null;
  } catch (e:any) {
    console.warn("[aiReply] opener_exception", e?.message || e);
    return null;
  }
}

/* ===================== Subject/Body Parsing ===================== */
function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const fromTextFree = extractFreeText(body);
  const fromTextLabels = extractLabeledLines(body);
  const fromSubject = extractFromSubject(subject);
  return mergeFacts(mergeFacts(fromTextFree, fromTextLabels), fromSubject);
}

/* ===================== DB enrichment hook (not active yet) ===================== */
// NOTE: Current orchestrator does not read your DB.
// When you’re ready, wire a read-only endpoint and enrich facts here.
/*
async function enrichFromDB(facts: Mem): Promise<Mem> {
  try {
    // Example: if (!facts.density && facts.material) { fetch default density from your materials table }
    return facts;
  } catch { return facts; }
}
*/

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

/* ===================== route ===================== */

export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun   = !!p.dryRun;
    const lastText = String(p.text || "");
    const subject  = String(p.subject || "");
    const threadId = String(p.threadId ?? "").trim();
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    // Parse current turn
    const newly = extractAllFromTextAndSubject(lastText, subject);

    // Load + merge with prior facts
    let loaded: Mem = {};
    if (threadId) loaded = await loadFacts(threadId);

    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
    };
    let merged = mergeFacts({ ...loaded, ...carry }, newly);

    // Optionally enrich from DB later
    // merged = await enrichFromDB(merged);

    // Debug visibility in logs
    const primaryKeys = Object.keys(loaded || {});
    const aliasKeys = ["dims","qty","material","density","cavityCount","cavityDims","__lastGraphMessageId","__lastInternetMessageId"].filter(k=>k in loaded);
    console.log("[facts] keys { primary:", threadId || "(none)", ", alias:", (p.toEmail ? `hsu:${String(p.toEmail).toLowerCase()}::${subject.toLowerCase()}` : "(none)"), "}");
    console.log("[facts] loaded_primary_keys:", primaryKeys.join(",") || "(none)");
    console.log("[facts] loaded_alias_keys:", aliasKeys.join(",") || "(none)");
    console.log("[facts] newly:", newly);
    console.log("[facts] merged:", merged);

    if (threadId) await saveFacts(threadId, merged);

    // Compose human Q&A body
    const context = pickThreadContext(threadMsgs);
    const openerAI = await aiOpener(lastText, context);
    const body = (openerAI ? openerAI : chooseOpener(threadId || subject)) + "\n\n" + renderQA(merged, threadId || subject);

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, ", threadId:", threadId || "<none>", ", inReplyTo:", inReplyTo ? "<id>" : "none", "}");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: body.slice(0, 900),
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

    // Persist outbound IDs for next turn
    if (threadId && (r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
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
