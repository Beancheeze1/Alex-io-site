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

/* ===================== small utils ===================== */

function compact<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (Array.isArray(v)) {
      const vv = v.filter((x) => x !== undefined && x !== null && String(x).trim() !== "");
      if (vv.length) out[k] = vv;
    } else if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) {
      out[k] = v;
    }
  }
  return out as T;
}

/** Merge with special handling:
 * - keep existing when new is empty
 * - arrays => union (preserve order, dedupe)
 */
function mergeFactsDeep(a: Mem, b: Mem): Mem {
  const out: Mem = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) {
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    if (Array.isArray(v)) {
      const prev = Array.isArray(out[k]) ? (out[k] as any[]) : [];
      const seen = new Set<string>(prev.map(String));
      const merged = [...prev];
      for (const item of v) {
        const s = String(item);
        if (!seen.has(s)) { seen.add(s); merged.push(item); }
      }
      out[k] = merged;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? s.slice(0, 200) + "…" : s));
  return snippets.join("\n---\n");
}

/* ===================== Parsing helpers (expanded & context-aware) ===================== */

const CAVITY_TOKENS = /(cavities|cavity|pockets?|cut[- ]?outs?|holes?|slots?|recess(?:es)?)/i;

/** Normalize a dim token like 5 x 5 x 1" → 5x5x1 */
function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/,"").toLowerCase();
}

/** Base LxWxH finder (returns all matches with indices) */
function findDimsAll(t: string) {
  const re = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/gi;
  const out: Array<{ dims: string; index: number }> = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    out.push({ dims: `${m[1]}x${m[2]}x${m[3]}`, index: m.index });
  }
  return out;
}

/** Context-aware dims classifier:
 * if a dims match is within ±40 chars of a cavity token → treat as cavity size
 * else treat as overall part dimensions.
 */
function classifyDimsByContext(t: string): { partDims?: string; cavDims?: string[] } {
  const matches = findDimsAll(t);
  if (!matches.length) return {};
  const cavList: string[] = [];
  let part: string | undefined;

  for (const m of matches) {
    const start = Math.max(0, m.index - 40);
    const end = Math.min(t.length, m.index + 60);
    const window = t.slice(start, end);
    const dims = normDims(m.dims);
    if (CAVITY_TOKENS.test(window)) {
      if (!cavList.includes(dims)) cavList.push(dims);
    } else if (!part) {
      part = dims; // keep first non-cavity dims as “Dimensions”
    } else {
      // If we already have part dims, additional bare dims are more likely cavity-like in a thread → add to cav list
      if (!cavList.includes(dims)) cavList.push(dims);
    }
  }
  const out: any = {};
  if (part) out.partDims = part;
  if (cavList.length) out.cavDims = cavList;
  return out;
}

/** Quantity */
function grabQty(t: string) {
  const m =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/i) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/i) ||
    t.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|sets?|pairs?)\b/i);
  return m ? Number(m[1]) : undefined;
}

/** Density (1.7#, 1.7 lb, 1.7lbs) + typo tolerance (densitty, dens, etc.) */
function grabDensity(t: string) {
  const m =
    t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#)\b/i) ||
    t.match(/\bdens(?:ity|it|ty)?\s*[:=]?\s*(\d+(?:\.\d+)?)(?:\s*(?:lb|lbs|#))?\b/i);
  return m ? `${m[1]}lb` : undefined;
}

/** Material synonyms (expanded) */
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b|\bldpe\b|\bhdpe\b|\bxlpe\b|\bcross[-\s]?linked\b/i.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/i.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b|\bester\b|\beth(?:er)?\b/i.test(t)) return "PU";
  return undefined;
}

/** Labeled lines (“Dimensions: …”, “Cavity sizes: …”, etc.) */
function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    const d = normDims(val);
    if (!list.includes(d)) list.push(d);
    out.cavityDims = list;
  };

  for (const lineRaw of lines) {
    const line = lineRaw.trim().replace(/^•\s*/, "");
    const tl = line.toLowerCase();

    // Dimensions / Size / Measurements
    let m = tl.match(/^(?:dimensions?|size|overall\s*size|measurements?)\s*[:\-]\s*(.+)$/i);
    if (m) {
      const whole = m[1].toLowerCase();
      const cls = classifyDimsByContext(whole);
      if (cls.partDims) out.dims = cls.partDims;
      if (cls.cavDims?.length) out.cavityDims = (out.cavityDims || []).concat(cls.cavDims);
      continue;
    }

    // Quantity
    m = tl.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/i);
    if (m) { out.qty = Number(m[1]); continue; }

    // Material
    if (/^(?:foam\s*)?material\s*[:\-]/i.test(tl)) {
      const mat = grabMaterial(tl);
      if (mat) out.material = mat;
      continue;
    }

    // Density
    m = tl.match(/^dens(?:ity|it|ty)?\s*[:\-]\s*(\d+(?:\.\d+)?)(?:\s*(?:lb|lbs|#))?\b/i);
    if (m) { out.density = `${m[1]}lb`; continue; }

    // Cavity count
    m = tl.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?|holes?|slots?|recess(?:es)?)\s*[:\-]\s*(\d{1,4})\b/i);
    if (m) { out.cavityCount = Number(m[1]); continue; }

    // Cavity sizes (comma list; Ødia x depth; LxWxD)
    m = tl.match(/^(?:cavity|pocket|cut[- ]?out|hole|slot|recess)\s*(?:size|sizes)\s*[:\-]\s*(.+)$/i);
    if (m) {
      const part = m[1].replace(/\beach\b/gi, "");
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const tokT = tok.trim().toLowerCase();
        // Ødia x depth / dia x deep
        const md =
          tokT.match(/[øØo0]?\s*(?:dia(?:meter)?\.?)\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)(?:\s*(?:d|deep|depth))?/i) ||
          tokT.match(/[øØ]\s*(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)(?:\s*(?:d|deep|depth))?/i);
        if (md) { addCavity(`Ø${md[1]}x${md[2]}`); continue; }
        const cls = classifyDimsByContext(tokT);
        if (cls.cavDims?.length) cls.cavDims.forEach(addCavity);
        else if (cls.partDims) addCavity(cls.partDims); // bare dim after “sizes” is a cavity dim
      }
      continue;
    }
  }
  return compact(out);
}

/** Free-text sweep + context classification */
function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase();
  const out: Mem = {};

  // Dims with context → either overall or cavity
  const cls = classifyDimsByContext(t);
  if (cls.partDims) out.dims = cls.partDims;
  if (cls.cavDims?.length) out.cavityDims = cls.cavDims;

  const qty = grabQty(t);
  if (qty !== undefined) out.qty = qty;

  const density = grabDensity(t);
  if (density) out.density = density;

  const material = grabMaterial(t);
  if (material) out.material = material;

  // Cavity count
  const count = t.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?|holes?|slots?|recess(?:es)?)\b/i);
  if (count) out.cavityCount = Number(count[1]);

  // “each 1x2x3” list
  const afterEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)+)/i);
  if (afterEach) {
    const list = afterEach[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = (out.cavityDims || []).concat(list);
  } else {
    const singleEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/i);
    if (singleEach) out.cavityDims = (out.cavityDims || []).concat([normDims(singleEach[1])]);
  }

  // Ødia x depth from freestyle text
  const roundCavAll = t.match(new RegExp(`[${"øØ"}o0]?\\s*(?:dia(?:meter)?\\.?)\\s*(\\d+(?:\\.\\d+)?)\\s*(?:in|")?\\s*(?:x|by|\\*)\\s*(\\d+(?:\\.\\d+)?)(?:\\s*(?:d|deep|depth))?`, "i"));
  if (roundCavAll) {
    out.cavityDims = (out.cavityDims || []).concat([`Ø${roundCavAll[1]}x${roundCavAll[2]}`]);
  }

  return compact(out);
}

function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  return extractFreeText(s);
}

function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const fromTextFree = extractFreeText(body);
  const fromTextLabels = extractLabeledLines(body);
  const fromSubject = extractFromSubject(subject);
  return mergeFactsDeep(mergeFactsDeep(fromTextFree, fromTextLabels), fromSubject);
}

/* ===================== Human Q&A rendering (ask-only) + HTML ===================== */

const OPENERS = [
  "Thanks for the note—once I confirm a couple details I’ll turn pricing around.",
  "Appreciate the info—let me fill a few gaps and I’ll get you numbers.",
  "Got it—if I can confirm a couple specs I’ll price this out right away.",
  "Thanks for reaching out—just a few quick checks and I’ll send a quote.",
];

function hseed(s: string) { let h = 2166136261>>>0; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;} return h>>>0; }
function choose<T>(arr: T[], seed: string) { return arr[hseed(seed)%arr.length]; }

const Q_DIMENSIONS = [
  "Could you confirm the finished part dimensions (L×W×H, inches)?",
  "What are the overall dimensions (length × width × height, in)?",
  "Please share the part size in L×W×H (inches).",
];
const Q_QUANTITY = [
  "What quantity should I price?",
  "How many pieces should I quote?",
  "What’s the run quantity?",
];
const Q_MATERIAL = [
  "Do you prefer PE, EPE, or PU for this job?",
  "Which foam type works here—PE, EPE, or PU?",
  "Foam material preference (PE / EPE / PU)?",
];
const Q_DENSITY = [
  "If PE/EPE, what density should I use (e.g., 1.7 lb)?",
  "What foam density do you want for PE/EPE (e.g., 1.7 lb)?",
  "Please confirm the PE/EPE density (e.g., 1.7 lb).",
];
const Q_CAVITIES = [
  "How many cavities/pockets are needed, if any?",
  "Number of cutouts/pockets to include?",
  "How many features (cavities) should I plan for?",
];
const Q_CAV_SIZES = [
  "What are the cavity sizes? For rectangles use L×W×Depth; for round features a Ø×depth like Ø3×0.75 works.",
  "Please share cavity dimensions: L×W×D or round Ø×depth (e.g., Ø3×0.75).",
  "Cavity details needed—rectangular L×W×D or round Ø×depth.",
];

function buildQuestions(f: Mem, seed: string): string[] {
  const qs: string[] = [];
  if (!f.dims)        qs.push(choose(Q_DIMENSIONS, seed+"d"));
  if (f.qty === undefined) qs.push(choose(Q_QUANTITY, seed+"q"));
  if (!f.material)    qs.push(choose(Q_MATERIAL, seed+"m"));
  if (!f.density)     qs.push(choose(Q_DENSITY, seed+"z"));
  if (f.cavityCount === undefined) qs.push(choose(Q_CAVITIES, seed+"c"));
  if (!(Array.isArray(f.cavityDims) && f.cavityDims.length)) qs.push(choose(Q_CAV_SIZES, seed+"s"));
  return qs;
}

function toPlainText(opener: string, qs: string[]): string {
  const lines = [opener, ""];
  for (const q of qs) lines.push("• " + q);
  lines.push("");
  lines.push("If you have a quick sketch or drawing, you can attach it and I’ll make sure I captured everything.");
  return lines.join("\n");
}

function toHtmlTemplate(opener: string, qs: string[], subject: string) {
  const items = qs.map(q => `<li>${q}</li>`).join("");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no">
    <title>Alex-IO Quote</title>
  </head>
  <body style="margin:0;padding:24px;background:#f6f8fb;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;">
      <div style="background:#0f172a;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;">
        <div style="font-size:16px;font-weight:600;letter-spacing:0.2px;">Alex-IO</div>
        <div style="opacity:0.8;font-size:12px;">Re: ${escapeHtml(subject || "Your foam quote request")}</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;">
        <p style="margin:0 0 10px 0;font-size:14px;line-height:1.55;">${escapeHtml(opener)}</p>
        <ul style="margin:10px 0 14px 18px;padding:0 0 0 10px;font-size:14px;line-height:1.55;">
          ${items}
        </ul>
        <p style="margin:14px 0 0 0;font-size:13px;line-height:1.55;color:#334155;">
          If you have a quick sketch or drawing, feel free to attach it—I'll make sure I captured everything correctly.
        </p>
      </div>
      <div style="text-align:center;color:#64748b;font-size:12px;margin-top:10px;">
        Sent by Alex-IO — quick, accurate foam quotes
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
function normalizeSubject(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/^\s*(re|fwd|fw)\s*:\s*/g, "")
    .trim();
}

/* ===================== route ===================== */

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
    const subject  = String(p.subject || "");
    const threadId = String(p.threadId ?? "").trim();
    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];
    const toEmail = String(p.toEmail || "").trim().toLowerCase();

    // Parse current turn
    const newly = extractAllFromTextAndSubject(lastText, subject);

    // Load + merge with prior facts (primary thread + alias)
    const subjKey = normalizeSubject(subject);
    const aliasKey = toEmail && subjKey ? `hsu:${toEmail}::${subjKey}` : "";

    let loaded: Mem = {};
    if (threadId) loaded = await loadFacts(threadId);
    if ((!loaded || Object.keys(loaded).length === 0) && aliasKey) {
      const aliasLoaded = await loadFacts(aliasKey);
      if (aliasLoaded && Object.keys(aliasLoaded).length) loaded = { ...aliasLoaded };
    }

    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
    };
    let merged = mergeFactsDeep({ ...loaded, ...carry }, newly);

    // Debug visibility
    const primaryKeys = Object.keys(loaded || {});
    const aliasKeys = ["dims","qty","material","density","cavityCount","cavityDims","__lastGraphMessageId","__lastInternetMessageId"].filter(k=>k in loaded);
    console.log("[facts] keys { primary:", threadId || "(none)", ", alias:", aliasKey || "(none)", "}");
    console.log("[facts] loaded_primary_keys:", primaryKeys.join(",") || "(none)");
    console.log("[facts] loaded_alias_keys:", aliasKeys.join(",") || "(none)");
    console.log("[facts] newly:", newly);
    console.log("[facts] merged:", merged);

    // Save to both keys
    if (threadId) await saveFacts(threadId, merged);
    if (aliasKey) await saveFacts(aliasKey, merged);

    // Compose “ask-only” body (text + HTML)
    const seed = threadId || subjKey || toEmail || "";
    const openerAI = await aiOpener(lastText, pickThreadContext(threadMsgs));
    const opener = openerAI || choose(OPENERS, seed);
    const questions = buildQuestions(merged, seed);
    const bodyText = toPlainText(opener, questions);
    const bodyHtml = toHtmlTemplate(opener, questions, subject);

    // Recipient guardrails (unchanged)
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info("[orchestrate] msgraph/send { to:", toEmail, ", dryRun:", !!p.dryRun, ", threadId:", threadId || "<none>", ", alias:", aliasKey || "<none>", ", inReplyTo:", inReplyTo ? "<id>" : "none", "}");

    if (dryRun) {
      return ok({
        mode: "dryrun",
        toEmail,
        subject: p.subject || "Quote",
        preview: bodyText.slice(0, 900),
        htmlPreview: bodyHtml.slice(0, 900),
        facts: merged,
        mem: { threadId: String(threadId), aliasKey, loadedKeys: Object.keys(loaded), mergedKeys: Object.keys(merged) },
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
        text: bodyText,      // for clients that prefer plain text
        html: bodyHtml,      // primary rendering
        inReplyTo: inReplyTo || null,
        dryRun: false
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(()=> ({}));

    // Persist outbound IDs for next turn — to both keys
    if ((r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      if (threadId) await saveFacts(threadId, updated);
      if (aliasKey) await saveFacts(aliasKey, updated);
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
