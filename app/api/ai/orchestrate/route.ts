// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";
import { one } from "@/lib/db"; // <— NEW: DB helper

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ===================== Types & helpers ===================== */

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
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) out[k] = v;
  }
  return out as T;
}
function mergeFacts(a: Mem, b: Mem): Mem {
  return { ...(a || {}), ...compact(b || {}) };
}

/* Keep last few messages for tone; not used for parsing */
function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 220 ? s.slice(0, 220) + "…" : s));
  return snippets.join("\n---\n");
}

/* ===================== Parsing helpers (expanded) ===================== */

function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/, "").toLowerCase();
}
function grabDims(t: string) {
  const m = t.match(/\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/);
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}
function grabQty(t: string) {
  const m =
    t.match(/\bqty\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\bquantity\s*[:=]?\s*(\d{1,6})\b/) ||
    t.match(/\b(\d{1,6})\s*(pcs?|pieces?)\b/);
  return m ? Number(m[1]) : undefined;
}
/* Density expansion */
function grabDensity(t: string) {
  const withUnit = t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb|lbs|#|pcf)\b/);
  if (withUnit) return withUnit[1] + "lb";
  const nearWord = t.match(/(?:density|foam\s*density|pcf)\D{0,8}(\d+(?:\.\d+)?)/);
  if (nearWord) return nearWord[1] + "lb";
  return undefined;
}
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b/.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b/.test(t)) return "PU";
  return undefined;
}

function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(normDims(val));
    out.cavityDims = list;
  };

  for (const raw of lines) {
    const line = raw.trim().replace(/^-\s*/, "").replace(/^•\s*/, "");
    const t = line.toLowerCase();

    let m = t.match(/^dimensions?\s*[:\-]\s*(.+)$/);
    if (m) {
      const dims = grabDims(m[1]);
      if (dims) out.dims = normDims(dims);
      continue;
    }

    m = t.match(/^qty(?:uantity)?\s*[:\-]\s*(\d{1,6})\b/);
    if (m) {
      out.qty = Number(m[1]);
      continue;
    }

    if (/^material\s*[:\-]/.test(t)) {
      const mat = grabMaterial(t);
      if (mat) out.material = mat;
      continue;
    }

    m = t.match(/^density\s*[:\-]\s*(\d+(?:\.\d+)?)(?:\s*(?:lb|lbs|#|pcf))?\b/);
    if (m) {
      out.density = `${m[1]}lb`;
      continue;
    }

    m = t.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?)\s*[:\-]\s*(\d{1,4})\b/);
    if (m) {
      out.cavityCount = Number(m[1]);
      continue;
    }

    m = t.match(/^(?:cavity|pocket|cut[- ]?out)\s*(?:size|sizes)\s*[:\-]\s*(.+)$/);
    if (m) {
      const part = m[1].replace(/\beach\b/gi, "");
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const tokT = tok.trim();
        const md =
          tokT.match(/[øØo0]?\s*dia?\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i) ||
          tokT.match(/[øØ]\s*(\d+(?:\.\d+)?)\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i);
        if (md) {
          addCavity(`Ø${md[1]}x${md[2]}`);
          continue;
        }
        const dd = grabDims(tokT);
        if (dd) {
          addCavity(dd);
          continue;
        }
      }
      continue;
    }

    const inlineCav = t.match(
      /(?:cavities?|pockets?|cut[- ]?outs?)[:\s]+(?:size|sizes)?[:\s]*((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/,
    );
    if (inlineCav) addCavity(inlineCav[1]);
  }

  return out;
}

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

  const count = t.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/);
  if (count) out.cavityCount = Number(count[1]);

  const afterEach = t.match(
    /\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)+)/,
  );
  if (afterEach) {
    const list = afterEach[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = list;
  } else {
    const singleEach = t.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/);
    if (singleEach) out.cavityDims = [normDims(singleEach[1])];
  }

  const roundCav = t.match(/[øØo0]?\s*dia?\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i);
  if (roundCav) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${roundCav[1]}x${roundCav[2]}`);
    out.cavityDims = list;
  }

  return compact(out);
}

function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  return extractFreeText(s);
}

/* ===================== Human Q&A rendering ===================== */

const HUMAN_OPENERS = [
  "Appreciate the details—once we lock a few specs I’ll price this out.",
  "Thanks for sending this—happy to quote it as soon as I confirm a couple items.",
  "Got it—let me confirm a few specs and I’ll run pricing.",
  "Thanks for the info—if I can fill a couple gaps I’ll send numbers right away.",
];

function chooseOpener(seed: string) {
  let h = 2166136261 >>> 0;
  const s = seed || String(Date.now());
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return HUMAN_OPENERS[h % HUMAN_OPENERS.length];
}

function qaLineAsk(label: string): string {
  switch (label) {
    case "Dimensions":
      return "- Could you confirm the finished part dimensions (L×W×H, inches)?";
    case "Quantity":
      return "- What quantity should I price?";
    case "Material":
      return "- Do you prefer PE, EPE, or PU for this job?";
    case "Density":
      return "- If PE/EPE, what density should I use (e.g., 1.7 lb)?";
    case "Cavities":
      return "- How many cavities/pockets are needed, if any?";
    case "Cavity sizes":
      return "- What are the cavity sizes? (L×W×Depth). For round, a diameter × depth like Ø3×0.75 works.";
    default:
      return `- ${label}?`;
  }
}

function renderQAAskOnlyMissing(f: Mem) {
  const missing: string[] = [];
  if (!f.dims) missing.push("Dimensions");
  if (!f.qty) missing.push("Quantity");
  if (!f.material) missing.push("Material");
  if (!f.density) missing.push("Density");
  if (f.cavityCount === undefined) missing.push("Cavities");
  if ((f.cavityCount ?? 0) > 0 && !(Array.isArray(f.cavityDims) && f.cavityDims.length)) {
    missing.push("Cavity sizes");
  }

  if (!missing.length) return "Great — I have everything I need. I’ll run pricing now and follow up shortly.";

  return missing.map(qaLineAsk).join("\n");
}

function capabilitiesBlurb() {
  return [
    "FYI — I can also help with:",
    "- Picking foam type/density for your use case",
    "- Multiple cavities/cutouts (rectangular or round)",
    "- Attaching sketches or simple drawings to speed quoting",
    "- Breaking out quantities for price breaks",
  ].join("\n");
}

/* ===================== Tiny LLM opener (Hybrid model) ===================== */

async function aiOpener(model: string, lastInbound: string, context: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  try {
    const prompt = [
      "Write ONE natural sentence acknowledging the message and saying you'll price it once specs are confirmed.",
      "No bullets or extra lines. Keep it friendly and concise.",
      context ? `Context:\n${context}` : "",
      `Customer message:\n${lastInbound || "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 60 }),
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    const text =
      (j as any)?.output_text ||
      (j as any)?.output?.[0]?.content?.[0]?.text ||
      (j as any)?.choices?.[0]?.message?.content?.[0]?.text ||
      (j as any)?.choices?.[0]?.message?.content ||
      (j as any)?.choices?.[0]?.text ||
      "";
    const one = String(text || "").trim().replace(/\s+/g, " ");
    return one || null;
  } catch {
    return null;
  }
}

/* ===================== Hybrid LLM selection ===================== */

function scoreAmbiguity(lastText: string, facts: Mem): number {
  let score = 0;
  const t = (lastText || "").toLowerCase();

  const missing =
    (facts.dims ? 0 : 1) +
    (facts.qty ? 0 : 1) +
    (facts.material ? 0 : 1) +
    (facts.density ? 0 : 1);

  score += missing;

  if (/\b(asap|rough|about|ish|similar|like last time|close enough|ballpark)\b/.test(t)) score += 1;
  if ((facts.cavityCount ?? 0) > 0 && !(Array.isArray(facts.cavityDims) && facts.cavityDims.length)) score += 1;
  if ((lastText || "").length > 600) score += 1;

  return score; // 0..N
}

function chooseModel(modeEnv: string | undefined, lastText: string, facts: Mem): "gpt-4.1-mini" | "gpt-4.1" {
  const force = (process.env.ALEXIO_LLM_FORCE || "").toLowerCase(); // "mini" | "full" | ""
  if (force === "mini") return "gpt-4.1-mini";
  if (force === "full") return "gpt-4.1";

  const mode = (modeEnv || "hybrid").toLowerCase(); // "mini" | "full" | "hybrid"
  if (mode === "mini") return "gpt-4.1-mini";
  if (mode === "full") return "gpt-4.1";

  const s = scoreAmbiguity(lastText, facts);
  const threshold = Number(process.env.ALEXIO_LLM_ESCALATE_THRESHOLD || 2);
  return s >= threshold ? "gpt-4.1" : "gpt-4.1-mini";
}

/* ===================== Subject/Body parsing aggregator ===================== */

function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const fromTextFree = extractFreeText(body);
  const fromTextLabels = extractLabeledLines(body);
  const fromSubject = extractFromSubject(subject);
  return mergeFacts(mergeFacts(fromTextFree, fromTextLabels), fromSubject);
}

/* ===================== DB enrichment hook ===================== */
async function enrichFromDB(facts: Mem): Promise<Mem> {
  try {
    // Only enrich when we have a material but no explicit density from the user
    if (!facts.material || facts.density) return facts;

    const mat = String(facts.material || "").toUpperCase();
    const like = mat === "PE" ? "%pe%" : mat === "EPE" ? "%epe%" : mat === "PU" ? "%pu%" : `%${mat.toLowerCase()}%`;

    // Prefer 1.7 for PE when available, else lowest density for that material
    const target = mat === "PE" ? 1.7 : null;

    // Build query with optional target bias
    // NOTE: materials schema: id, name, density_lb_ft3, active, etc.
    let row:
      | { id: number; name: string; density_lb_ft3: number | null }
      | null = null;

    if (target !== null) {
      row = await one(
        `
        SELECT id, name, density_lb_ft3
        FROM materials
        WHERE active = true
          AND density_lb_ft3 IS NOT NULL
          AND (
            name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1
          )
        ORDER BY ABS(density_lb_ft3 - $2), density_lb_ft3 ASC
        LIMIT 1
        `,
        [like, target]
      );
    } else {
      row = await one(
        `
        SELECT id, name, density_lb_ft3
        FROM materials
        WHERE active = true
          AND density_lb_ft3 IS NOT NULL
          AND (
            name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1
          )
        ORDER BY density_lb_ft3 ASC
        LIMIT 1
        `,
        [like]
      );
    }

    if (!row) return facts;

    const next: Mem = { ...facts };
    if (row.id && !next.material_id) next.material_id = row.id;
    if (!next.density && row.density_lb_ft3 != null) {
      const d = Number(row.density_lb_ft3);
      if (Number.isFinite(d) && d > 0) next.density = `${d}lb`;
    }
    return next;
  } catch {
    return facts; // never block on enrichment
  }
}

/* ===================== Parse body ===================== */

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

/* ===================== Route ===================== */

export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun = !!p.dryRun;
    const lastText = String(p.text || "");
    const subject = String(p.subject || "");
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
      __turnCount: typeof loaded?.__turnCount === "number" ? loaded.__turnCount : 0,
    };

    let merged = mergeFacts({ ...loaded, ...carry }, newly);

    // bump turn counter (persist only if we have a thread key)
    merged.__turnCount = (merged.__turnCount || 0) + 1;

    // NEW: DB enrichment
    merged = await enrichFromDB(merged);

    // Persist facts
    if (threadId) await saveFacts(threadId, merged);

    // LLM selection (hybrid)
    const llmSelected = chooseModel(process.env.ALEXIO_LLM_MODE, lastText, merged);

    // Compose human Q&A body — opener from LLM (selected), questions only for missing fields
    const context = pickThreadContext(threadMsgs);
    const openerLLM = (await aiOpener(llmSelected, lastText, context)) || chooseOpener(threadId || subject);

    const questions = renderQAAskOnlyMissing(merged);

    const firstReplyExtras =
      merged.__turnCount === 1
        ? "\n\n" + capabilitiesBlurb()
        : "";

    const body = `${openerLLM}\n\n${questions}${firstReplyExtras}`;

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail)
      return err("missing_toEmail", { reason: "Lookup did not produce a recipient; refusing to fall back to mailbox." });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", { toEmail, reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies." });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info(
      "[orchestrate] msgraph/send { to:",
      toEmail,
      ", dryRun:",
      !!p.dryRun,
      ", threadId:",
      threadId || "<none>",
      ", inReplyTo:",
      inReplyTo ? "<id>" : "none",
      ", llm:",
      llmSelected,
      ", turn:",
      merged.__turnCount,
      "}",
    );

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
        llm: llmSelected,
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
        text: body, // plain text; msgraph route wraps to HTML
        inReplyTo: inReplyTo || null,
        dryRun: false,
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(() => ({}));

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
      llm: llmSelected,
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
