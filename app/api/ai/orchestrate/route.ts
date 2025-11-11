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

/* ===================== Normalization ===================== */
function normalizeInput(s = "") {
  return String(s)
    .replace(/[\u201C\u201D\u2033]/g, '"')   // “ ” ″ -> "
    .replace(/\u00D7/g, "x")                // × -> x
    .replace(/\s+/g, " ")
    .trim();
}

/* ===================== Parsing helpers (expanded) ===================== */

/** Normalize dims token like 5 x 5 x 1" → 5x5x1 */
function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/[×]/g, "x").replace(/"+$/,"").toLowerCase();
}

/** Parse LxWxH style dims anywhere in text */
function grabDims(t: string) {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*[x]\s*(\d+(?:\.\d+)?)\s*[x]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/i);
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}

/** Parse qty variants */
function grabQty(t: string) {
  const m =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/i) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/i) ||
    t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/i);
  return m ? Number(m[1]) : undefined;
}

/** Parse material synonyms (return canonical) */
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b/i.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/i.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b/i.test(t)) return "PU";
  return undefined;
}

/** Parse density: 1.7#, 1.7 lb, 1.7lbs, or bare 1.7 (we’ll append lb if plausible) */
function grabDensity(t: string, material?: string) {
  let m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/i);
  if (m) return `${m[1]}lb`;

  // bare number near the word density, or followed by "pound"
  m = t.match(/\bdensity[^.\d]{0,10}(\d+(?:\.\d+)?)/i) || t.match(/\b(\d+(?:\.\d+)?)\s*pound\b/i);
  if (m) return `${m[1]}lb`;

  // very common shorthand: “… be 1.7 black PE”
  if (!m) {
    const bare = t.match(/\b(\d+(?:\.\d+)?)\b/);
    if (bare && (material === "PE" || material === "EPE")) {
      const val = parseFloat(bare[1]);
      if (!Number.isNaN(val) && val > 0 && val <= 5) return `${bare[1]}lb`;
    }
  }
  return undefined;
}

/** Round cavity patterns */
function grabRoundCavity(t: string): string[] {
  const out: string[] = [];

  // Ø6 x 1, 6 dia x 1, 6" dia x 1"
  const p1 = [...t.matchAll(/\b(?:ø|dia|diameter)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:in|")?\s*(?:dia|diameter)?\s*(?:x|by)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:in|")?\b/gi)];
  for (const m of p1) out.push(`Ø${m[1]}x${m[2]}`);

  // “6" diameter and 1" deep” | “6 in diameter, 1 in deep”
  const p2 = [...t.matchAll(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:in|")\s*diameter[^0-9]+([0-9]+(?:\.[0-9]+)?)\s*(?:in|")\s*(?:deep|depth)\b/gi)];
  for (const m of p2) out.push(`Ø${m[1]}x${m[2]}`);

  return out;
}

/** Pull labeled lines including cavities */
function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(normDims(val));
    out.cavityDims = list;
  };

  for (const raw of lines) {
    const line = normalizeInput(raw).replace(/^•\s*/,"");
    const t = line.toLowerCase();

    // Dimensions
    let m = t.match(/^dimensions?\s*[:\-]\s*(.+)$/i);
    if (m) {
      const dims = grabDims(m[1]);
      if (dims) out.dims = normDims(dims);
      continue;
    }
    // Quantity
    m = t.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/i);
    if (m) { out.qty = Number(m[1]); continue; }

    // Material
    if (/^material\s*[:\-]/i.test(t)) {
      const mat = grabMaterial(t);
      if (mat) out.material = mat;
      continue;
    }

    // Density
    m = t.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)(?:\s*(?:lb|lbs|#))?\b/i);
    if (m) { out.density = `${m[1]}lb`; continue; }

    // Cavities count
    m = t.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?)\s*[:\-]\s*(\d{1,4})\b/i);
    if (m) { out.cavityCount = Number(m[1]); continue; }

    // Cavity sizes
    m = t.match(/^(?:cavity|pocket|cut[- ]?out)\s*(?:size|sizes)\s*[:\-]\s*(.+)$/i);
    if (m) {
      const part = m[1].replace(/\beach\b/gi, "");
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const tokT = normalizeInput(tok);
        const rds = grabRoundCavity(tokT);
        if (rds.length) { rds.forEach(addCavity); continue; }
        const dd = grabDims(tokT);
        if (dd) { addCavity(dd); continue; }
      }
      continue;
    }

    // single inline cavity dim
    const inlineCav = t.match(/(?:cavities?|pockets?|cut[- ]?outs?)[:\s]+(?:size|sizes)?[:\s]*((?:\d+(?:\.\d+)?\s*x\s*){2}\d+(?:\.\d+)?)/i);
    if (inlineCav) addCavity(inlineCav[1]);
  }
  return out;
}

/** Free-text sweep (dims/qty/material/density + round cavities + “single cavity”) */
function extractFreeText(s = ""): Mem {
  const t = normalizeInput(s);
  const out: Mem = {};

  const dims = grabDims(t);
  if (dims) out.dims = normDims(dims);

  // qty
  const qty = grabQty(t);
  if (qty !== undefined) out.qty = qty;

  // material first so density fallback can use it
  const material = grabMaterial(t);
  if (material) out.material = material;

  // density
  const density = grabDensity(t, material);
  if (density) out.density = density;

  // “single cavity”
  if (/\bsingle\s+(?:cavity|pocket|cut[- ]?out)\b/i.test(t)) out.cavityCount = out.cavityCount ?? 1;

  // N cavities
  const count = t.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/i);
  if (count) out.cavityCount = Number(count[1]);

  // round cavities
  const rounds = grabRoundCavity(t);
  if (rounds.length) {
    out.cavityDims = [...(out.cavityDims || []), ...rounds.map(normDims)];
  }

  // “each 1x2x3” / comma separated
  const afterEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*x\s*){2}\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?\s*x\s*){2}\d+(?:\.\d+)?)+)/i);
  if (afterEach) {
    const list = afterEach[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = [...(out.cavityDims || []), ...list];
  } else {
    const singleEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*x\s*){2}\d+(?:\.\d+)?)/i);
    if (singleEach) out.cavityDims = [...(out.cavityDims || []), normDims(singleEach[1])];
  }

  return compact(out);
}

/** Parse subject too */
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
  let h = 2166136261 >>> 0;
  const s = seed || String(Date.now());
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return HUMAN_OPENERS[h % HUMAN_OPENERS.length];
}

function questionsNeeded(f: Mem): string[] {
  const qs: string[] = [];
  if (!f.dims)         qs.push("• Could you confirm the finished part dimensions (L×W×H, inches)?");
  if (f.qty == null)   qs.push("• What quantity should I price?");
  if (!f.material)     qs.push("• Do you prefer PE, EPE, or PU for this job?");
  if (!f.density)      qs.push("• If PE/EPE, what density would you like (e.g., 1.7 lb)?");
  if (f.cavityCount==null) qs.push("• How many cavities/pockets are needed, if any?");
  if (!f.cavityDims || f.cavityDims.length === 0) qs.push("• What are the cavity sizes? For round, a diameter × depth like Ø6×1 works.");
  return qs;
}

function capabilityTeaser() {
  return [
    "Quick things I can do",
    "• Quote PE / EPE / PU foam from your dimensions",
    "• Handle cavities: rectangular L×W×Depth or round Ø×depth",
    "• Suggest foam types & densities if you’re unsure",
    "• Accept sketches/photos and extract specs",
    "• Support quantity tiers and quick-turn options",
    "",
  ].join("\n");
}

/* ===================== Optional tiny AI opener ===================== */
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
    return one || null;
  } catch { return null; }
}

/* ===================== Subject/Body Parsing ===================== */
function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const fromTextFree   = extractFreeText(body);
  const fromTextLabels = extractLabeledLines(body);
  const fromSubject    = extractFromSubject(subject);
  return mergeFacts(mergeFacts(fromTextFree, fromTextLabels), fromSubject);
}

/* ===================== DB enrichment hook (placeholder) ===================== */
// When you're ready, point this to a read-only endpoint that returns defaults
// (e.g., default PE density, color options, min thickness) based on material.
/*
async function enrichFromDB(facts: Mem): Promise<Mem> {
  try {
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
    const lastText = normalizeInput(String(p.text || ""));
    const subject  = normalizeInput(String(p.subject || ""));
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

    // merged = await enrichFromDB(merged); // (future)

    // Debug visibility
    const primaryKeys = Object.keys(loaded || {});
    const aliasKeys = ["dims","qty","material","density","cavityCount","cavityDims","__lastGraphMessageId","__lastInternetMessageId"].filter(k=>k in loaded);
    console.log("[facts] keys { primary:", threadId || "(none)", ", alias:", (p.toEmail ? `hsu:${String(p.toEmail).toLowerCase()}::${subject.toLowerCase()}` : "(none)"), "}");
    console.log("[facts] loaded_primary_keys:", primaryKeys.join(",") || "(none)");
    console.log("[facts] loaded_alias_keys:", aliasKeys.join(",") || "(none)");
    console.log("[facts] newly:", newly);
    console.log("[facts] merged:", merged);

    if (threadId) await saveFacts(threadId, merged);

    // Compose body: opener + (first-turn teaser) + only the questions that are still missing
    const context = pickThreadContext(threadMsgs);
    const openerAI = await aiOpener(lastText, context);
    const opener = openerAI || chooseOpener(threadId || subject);

    const qs = questionsNeeded(merged);
    let body = opener + "\n\n";
    const isFirstTurn = primaryKeys.length === 0 && !loaded.__lastInternetMessageId;

    if (isFirstTurn) body += capabilityTeaser();
    if (qs.length) {
      body += qs.join("\n") + "\n\n";
      body += "If you have a quick sketch or drawing, feel free to attach it—I'll make sure I captured everything.";
    } else {
      body += "Perfect — I’ve got what I need and will prepare your quote now.";
    }

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
