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

/** Deep merge:
 * - primitives override when provided
 * - arrays => union (preserve order, dedupe by string form)
 * - missing values never delete existing
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

/** number token supports leading-dot decimals like .25 */
const N = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const CAVITY_TOKENS = new RegExp(`(cavities|cavity|pockets?|cut[- ]?outs?|holes?|slots?|recess(?:es)?)`,"i");

/** Normalize dims: ' 5 x .25 x 1" ' → '5x.25x1' */
function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/,"").toLowerCase();
}

/** Find all LxWxH occurrences with indices */
function findDimsAll(t: string) {
  const re = new RegExp(`(${N})\\s*[x×]\\s*(${N})\\s*[x×]\\s*(${N})(?:\\s*(?:in|inch|inches|"))?\\b`, "gi");
  const out: Array<{ dims: string; index: number }> = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    out.push({ dims: `${m[1]}x${m[2]}x${m[3]}`, index: m.index });
  }
  return out;
}

/** Context classifier: dims near a cavity token (±50 chars) → cavity; else overall dims */
function classifyDimsByContext(t: string): { partDims?: string; cavDims?: string[] } {
  const matches = findDimsAll(t);
  if (!matches.length) return {};
  const cavList: string[] = [];
  let part: string | undefined;

  for (const m of matches) {
    const start = Math.max(0, m.index - 50);
    const end = Math.min(t.length, m.index + 70);
    const window = t.slice(start, end);
    const dims = normDims(m.dims);
    if (CAVITY_TOKENS.test(window)) {
      if (!cavList.includes(dims)) cavList.push(dims);
    } else if (!part) {
      part = dims;
    } else {
      if (!cavList.includes(dims)) cavList.push(dims);
    }
  }
  const out: any = {};
  if (part) out.partDims = part;
  if (cavList.length) out.cavDims = cavList;
  return out;
}

/** Quantity (qty, quantity, 25 pcs, 25 pieces, sets, pairs) */
function grabQty(t: string) {
  const m =
    t.match(new RegExp(`\\bqty\\s*[:=]?\\s*(\\d{1,6})\\b`,"i")) ||
    t.match(new RegExp(`\\bquantity\\s*[:=]?\\s*(\\d{1,6})\\b`,"i")) ||
    t.match(new RegExp(`\\b(\\d{1,6})\\s*(?:pcs?|pieces?|sets?|pairs?)\\b`,"i"));
  return m ? Number(m[1]) : undefined;
}

/** Density: 1.7#, 1.7 lb, .9 lb; also 'density: 1.7' */
function grabDensity(t: string) {
  const m =
    t.match(new RegExp(`\\b(${N})\\s*(?:lb|lbs|#)\\b`,"i")) ||
    t.match(new RegExp(`\\bdens(?:ity|it|ty)?\\s*[:=]?\\s*(${N})(?:\\s*(?:lb|lbs|#))?\\b`,"i"));
  return m ? `${m[1]}lb` : undefined;
}

/** Material: expanded list */
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b|\bldpe\b|\bhdpe\b|\bxlpe\b|\bcross[-\s]?linked\b/i.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/i.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b|\bester\b|\beth(?:er)?\b/i.test(t)) return "PU";
  return undefined;
}

/** Labeled lines + inline cavity sizes */
function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    const d = normDims(val);
    if (!list.includes(d)) list.push(d);
    out.cavityDims = list;
  };

  for (const raw of lines) {
    const line = raw.trim().replace(/^•\s*/, "");
    const tl = line.toLowerCase();

    // Overall dimensions / size / measurements
    let m = tl.match(/^(?:dimensions?|size|overall\s*size|measurements?)\s*[:\-]\s*(.+)$/i);
    if (m) {
      const payload = m[1].toLowerCase();
      const cls = classifyDimsByContext(payload);
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
    m = tl.match(new RegExp(`^dens(?:ity|it|ty)?\\s*[:\\-]\\s*(${N})(?:\\s*(?:lb|lbs|#))?\\b`,"i"));
    if (m) { out.density = `${m[1]}lb`; continue; }

    // Cavity count
    m = tl.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?|holes?|slots?|recess(?:es)?)\s*[:\-]\s*(\d{1,4})\b/i);
    if (m) { out.cavityCount = Number(m[1]); /* don't continue; sizes may follow on same line */ }

    // Inline cavity sizes after a cavity token in same line
    // Examples:
    //   "Cavities are 1x1x.25 each"
    //   "Pockets: .25 x 1 x 2, 0.5x0.5x.25"
    //   "Cutouts: Ø3 x .75"
    if (CAVITY_TOKENS.test(tl)) {
      // Ødia x depth
      const roundAll = line.match(new RegExp(`[${"øØ"}o0]?\\s*(?:dia(?:meter)?\\.?)?\\s*(${N})\\s*(?:in|")?\\s*(?:x|by|\\*)\\s*(${N})(?:\\s*(?:d|deep|depth))?`,"ig"));
      if (roundAll) {
        for (const r of roundAll) {
          const rr = r.match(new RegExp(`(${N}).*?(?:x|by|\\*)\\s*(${N})`,"i"));
          if (rr) addCavity(`Ø${rr[1]}x${rr[2]}`);
        }
      }
      // Rectangular sequences (one or many)
      const rects = line.match(new RegExp(`(${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N})`,"ig"));
      if (rects) rects.forEach(tok => addCavity(tok));
    }
  }
  return compact(out);
}

/** Free-text sweep + context classifier + “each …” lists */
function extractFreeText(s = ""): Mem {
  const t = (s || "").toLowerCase();
  const out: Mem = {};

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

  // “each 1x2x3, .5x.5x.25 …”
  const afterEachList = t.match(new RegExp(`\\beach\\s+((?:${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N})(?:\\s*,\\s*(?:${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N}))+)`,"i"));
  if (afterEachList) {
    const list = afterEachList[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = (out.cavityDims || []).concat(list);
  } else {
    const singleEach = t.match(new RegExp(`\\beach\\s+(${N}\\s*[x×]\\s*${N}\\s*[x×]\\s*${N})`,"i"));
    if (singleEach) out.cavityDims = (out.cavityDims || []).concat([normDims(singleEach[1])]);
  }

  // Round Ø×depth anywhere in text
  const round = t.match(new RegExp(`[${"øØ"}o0]?\\s*(?:dia(?:meter)?\\.?)?\\s*(${N})\\s*(?:in|")?\\s*(?:x|by|\\*)\\s*(${N})(?:\\s*(?:d|deep|depth))?`,"i"));
  if (round) {
    out.cavityDims = (out.cavityDims || []).concat([`Ø${round[1]}x${round[2]}`]);
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

function toPlainText(opener: string, qs: string[], firstReplyExtra?: string[]): string {
  const lines = [opener, ""];
  if (firstReplyExtra && firstReplyExtra.length) {
    lines.push("Quick things I can do:");
    for (const e of firstReplyExtra) lines.push(`• ${e}`);
    lines.push("");
  }
  for (const q of qs) lines.push("• " + q);
  lines.push("");
  lines.push("If you have a quick sketch or drawing, you can attach it and I’ll make sure I captured everything.");
  return lines.join("\n");
}

function toHtmlTemplate(opener: string, qs: string[], subject: string, firstReplyExtra?: string[]) {
  const items = qs.map(q => `<li>${q}</li>`).join("");
  const extras = (firstReplyExtra && firstReplyExtra.length)
    ? `<div style="margin:0 0 10px 0;">
         <div style="font-weight:600;margin:0 0 4px 0;">Quick things I can do</div>
         <ul style="margin:6px 0 0 18px;padding:0 0 0 10px;">
           ${firstReplyExtra.map(e=>`<li>${e}</li>`).join("")}
         </ul>
       </div>`
    : "";

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
        ${extras}
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

/* ===================== DB enrichment hook (off for now) ===================== */
// When you’re ready, point this at a read-only endpoint to nudge defaults
// (e.g., default PE density by thickness, popular materials, etc.).
/*
async function enrichFromDB(facts: Mem): Promise<Mem> {
  try {
    // Example:
    // if (!facts.density && facts.material === "PE") {
    //   const r = await fetch(process.env.NEXT_PUBLIC_BASE_URL + "/api/admin/materials?kind=PE", { cache: "no-store" });
    //   const j = await r.json();
    //   if (j?.defaultDensity) facts.density = j.defaultDensity;
    // }
    return facts;
  } catch {
    return facts;
  }
}
*/

function normalizeSubject(s: string) {
  return (s || "").toLowerCase().replace(/^\s*(re|fwd|fw)\s*:\s*/g, "").trim();
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

    // Load existing memory (primary + alias)
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

    // Merge + (optional) DB enrich
    let merged = mergeFactsDeep({ ...loaded, ...carry }, newly);
    // merged = await enrichFromDB(merged);

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

    // First-reply detection (only show capabilities card on the first outbound)
    const isFirstReply = !loaded || (!loaded.__lastGraphMessageId && !loaded.__lastInternetMessageId);

    const CAPABILITIES = [
      "Quote PE / EPE / PU foam from your dimensions",
      "Handle cavities: rectangular L×W×Depth or round Ø×depth",
      "Suggest foam types & densities if you’re unsure",
      "Accept sketches/photos and extract specs",
      "Support quantity tiers and quick-turn options",
    ];

    // Compose ask-only email (text + HTML)
    const seed = threadId || subjKey || toEmail || "";
    const openerAI = await aiOpener(lastText, pickThreadContext(threadMsgs));
    const opener = openerAI || choose(OPENERS, seed);
    const questions = buildQuestions(merged, seed);
    const bodyText = toPlainText(opener, questions, isFirstReply ? CAPABILITIES : undefined);
    const bodyHtml = toHtmlTemplate(opener, questions, subject, isFirstReply ? CAPABILITIES : undefined);

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

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
        text: bodyText,
        html: bodyHtml,
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
