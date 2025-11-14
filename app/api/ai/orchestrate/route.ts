// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";

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
    if (v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "")) {
      out[k] = v;
    }
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

/**
 * Grab 3-D dims from free text.
 * Handles:
 *  - 12x12x3
 *  - 12 x 12 x 3
 *  - 12"x12"x3"
 *  - 12" x 12" x 3"
 *  - 12×12×3
 */
function grabDims(raw: string) {
  if (!raw) return undefined;

  // Normalize common “shop” patterns like 12"x12"x3" → 12x12x3
  const cleaned = raw
    // remove a quote that sits between a number and an x
    .replace(/(\d+(?:\.\d+)?)\s*"\s*(?=[x×])/gi, "$1 ")
    // normalize separators a bit
    .replace(/\s+/g, " ");

  const m = cleaned.match(
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|inch|inches|"))?\b/,
  );
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}

/**
 * Quantity:
 *  - qty 250 / qty: 250 / qty of 250 / qty is 250
 *  - quantity 250 / quantity is 250 / quantity of 250
 *  - 250 pcs / 250 pieces / 250 pc
 *  - 250 12"x12"x3" pieces of foam
 *  - change qty to 300 / change quantity to 300 / qty to 300
 */
function grabQty(raw: string) {
  const t = raw.toLowerCase();

  let m =
    t.match(/\bqty\s*(?:is|=|of|to)?\s*(\d{1,6})\b/) ||
    t.match(/\bquantity\s*(?:is|=|of|to)?\s*(\d{1,6})\b/) ||
    t.match(/\bchange\s+qty(?:uantity)?\s*(?:to|from)?\s*(\d{1,6})\b/) ||
    t.match(/\bmake\s+it\s+(\d{1,6})\b/) ||
    t.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|parts?)\b/);

  if (m) return Number(m[1]);

  // Handle “quantity of 250 12"x12"x3" pieces of foam”
  const norm = t.replace(/(\d+(?:\.\d+)?)\s*"\s*(?=[x×])/g, "$1 "); // strip quotes before x
  m = norm.match(
    /\b(\d{1,6})\s+(?:\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?)(?:\s*(?:pcs?|pieces?))\b/,
  );
  if (m) return Number(m[1]);

  // Fallback: “for 250 pieces”, “for 250”
  m = norm.match(/\bfor\s+(\d{1,6})\s*(?:pcs?|pieces?|parts?)?\b/);
  if (m) return Number(m[1]);

  return undefined;
}

function grabDensity(t: string) {
  const m =
    t.match(/\b(\d+(?:\.\d+)?)\s*(?:lb\/?ft?3|lb(?:s)?|#|pcf)\b/) ||
    t.match(/(?:density|foam\s*density|pcf)\D{0,10}(\d+(?:\.\d+)?)/);
  return m ? `${m[1]}lb` : undefined;
}
function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b/.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b/.test(t)) return "PU";
  return undefined;
}

/** Word numbers like "one cavity" */
const WORD_NUM: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function extractLabeledLines(s: string) {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(normDims(val));
    out.cavityDims = list;
  };

  let inCutouts = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim().replace(/^-\s*/, "").replace(/^•\s*/, "");
    const t = line.toLowerCase();

    if (!t) continue;

    // Section headers
    if (/^cutouts?$/i.test(line)) {
      inCutouts = true;
      continue;
    }

    // Handle 2-line table cells: "Quantity" \n "250"
    const nextRaw = lines[i + 1] ?? "";
    const next = nextRaw.trim();
    const nextLower = next.toLowerCase();

    // Outside size (dimensions broken into next line)
    if (/^outside\s*size$/i.test(line) && next) {
      const dims = grabDims(nextLower) || grabDims(line + " " + nextLower);
      if (dims) {
        out.dims = normDims(dims);
        i++; // consume next line
        continue;
      }
    }

    // Quantity  (label then numeric on next line)
    if (/^quantity$/i.test(line) && /^\d{1,6}\b/.test(nextLower)) {
      out.qty = Number(nextLower.match(/(\d{1,6})/)![1]);
      i++;
      continue;
    }

    // Density  (label then value on next line)
    if (/^density$/i.test(line) && nextLower) {
      const dens = grabDensity(nextLower);
      if (dens) {
        out.density = dens;
        i++;
        continue;
      }
    }

    // Foam family (PE/EPE/PU on next line)
    if (/^foam\s*family$/i.test(line) && nextLower) {
      const mat = grabMaterial(nextLower);
      if (mat) {
        out.material = mat;
        i++;
        continue;
      }
    }

    // Cutouts section lines: Count / Sizes
    if (inCutouts) {
      // "Count: 1"
      let m = t.match(/^count\s*[:\-]\s*(\d{1,4})\b/);
      if (m) {
        out.cavityCount = Number(m[1]);
        continue;
      }

      // "Sizes: ø6x1" or "Sizes: Ø6 x 1"
      m = t.match(/^sizes?\s*[:\-]\s*(.+)$/);
      if (m) {
        const part = m[1].replace(/\beach\b/gi, "");
        const tokens = part.split(/[,;]+/);
        for (const tok of tokens) {
          const tokT = tok.trim();
          const md =
            tokT.match(
              /[øØo0]?\s*(?:dia?|round|circle)\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i,
            ) ||
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
    }

    // Single-line dimension / size labels (original logic)
    let m =
      t.match(/^(?:finished|overall|outside)?\s*(?:size|dimensions?)\s*[:\-]\s*(.+)$/) ||
      t.match(/^dims?\s*[:\-]\s*(.+)$/);
    if (m) {
      const dims = grabDims(m[1]);
      if (dims) out.dims = normDims(dims);
      continue;
    }

    // Qty labels
    m = t.match(/^(?:qty|quantity)\s*(?:is|=|of|to)?\s*(\d{1,6})\b/);
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
    m = t.match(
      /^(?:cavities|cavity|pockets?|cut[- ]?outs?)\s*[:\-]?\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/,
    );
    if (m) {
      out.cavityCount = WORD_NUM[m[1]];
      continue;
    }

    m = t.match(/^(?:cavity|pocket|cut[- ]?out)\s*(?:size|sizes)\s*[:\-]\s*(.+)$/);
    if (m) {
      const part = m[1].replace(/\beach\b/gi, "");
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const tokT = tok.trim();
        const md =
          tokT.match(
            /[øØo0]?\s*(?:dia?|round|circle)\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i,
          ) ||
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

    const cavDiaDepth = t.match(
      /(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:diameter|dia|round|circle)\b[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:deep|depth)\b/,
    );
    if (cavDiaDepth) addCavity(`Ø${cavDiaDepth[1]}x${cavDiaDepth[2]}`);
  }

  // If we clearly have a list of cavity sizes but no count, sync count to list length
  if (Array.isArray(out.cavityDims) && out.cavityDims.length && out.cavityCount === undefined) {
    out.cavityCount = out.cavityDims.length;
  }

  return out;
}

function extractFreeText(s = ""): Mem {
  const lower = (s || "").toLowerCase();
  const out: Mem = {};

  const dims = grabDims(lower);
  if (dims) out.dims = normDims(dims);

  const qty = grabQty(lower);
  if (qty !== undefined) out.qty = qty;

  const density = grabDensity(lower);
  if (density) out.density = density;

  const material = grabMaterial(lower);
  if (material) out.material = material;

  const countNum = lower.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/);
  if (countNum) out.cavityCount = Number(countNum[1]);
  const countWord = lower.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/,
  );
  if (countWord) out.cavityCount = WORD_NUM[countWord[1]];

  const afterEach = lower.match(
    /\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)+)/,
  );
  if (afterEach) {
    const list = afterEach[1].split(/\s*,\s*/).map(normDims);
    out.cavityDims = list;
  } else {
    const singleEach = lower.match(/\beach\s+((?:\d+(?:\.\d+)?\s*[x×]\s*){2}\d+(?:\.\d+)?)/);
    if (singleEach) out.cavityDims = [normDims(singleEach[1])];
  }

  // round cavity: "6\" diameter and 1\" deep", "Ø6 x 1", "dia 6 x 1", "6 inch round x 1 deep"
  const roundCav =
    lower.match(
      /(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:diameter|dia|round|circle)\b.*?(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:deep|depth)/i,
    ) ||
    lower.match(
      /[øØo0]?\s*(?:dia?|round|circle)\s*\.?\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:x|by|\*)\s*(\d+(?:\.\d+)?)/i,
    );
  if (roundCav) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${roundCav[1]}x${roundCav[2]}`);
    out.cavityDims = list;
  }

  const cavDiaDepth = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:diameter|dia|round|circle)\b[^0-9]{0,12}(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*(?:deep|depth)\b/,
  );
  if (cavDiaDepth) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${cavDiaDepth[1]}x${cavDiaDepth[2]}`);
    out.cavityDims = list;
  }

  // If we clearly have a list of cavity sizes but no count, sync count to list length
  if (Array.isArray(out.cavityDims) && out.cavityDims.length && out.cavityCount === undefined) {
    out.cavityCount = out.cavityDims.length;
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

/* ===================== NEW: LLM-assisted parsing ===================== */

async function aiParseFacts(model: string, body: string, subject: string): Promise<Mem> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return {};
  if (!body && !subject) return {};
  try {
    const prompt = `
You are a careful parser for foam quote emails.

Extract ONLY information that is **explicitly** stated in the email or subject.
Do NOT guess or infer anything that is not clearly written.

Return a JSON object with these keys:
- "dims": string | null         // outside part size like "12x12x3" (inches)
- "qty": number | null          // quantity of parts to price
- "material": "PE" | "EPE" | "PU" | null
- "density": string | null      // like "1.7lb", "2lb"
- "cavityCount": number | null  // how many cavities/pockets/cutouts
- "cavityDims": string[] | null // each like "2x3x1" or "Ø6x1"

Rules:
- Only fill a field if you can point to the exact words in the text.
- If you are not sure, use null.
- For dimensions, convert 12" x 12" x 3" or 12 × 12 × 3 in to "12x12x3".
- For round cavities, convert 6" diameter x 1" deep to "Ø6x1".
- For density, just use the number with "lb" suffix (e.g., "1.7lb").

Return ONLY the JSON, no explanation.

Subject:
${subject || "(none)"}

Body:
${body || "(none)"}
`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 180,
      }),
      cache: "no-store",
    });

    const raw = await r.text();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return {};
    const jsonSlice = raw.slice(start, end + 1);
    const parsed = JSON.parse(jsonSlice);

    const out: Mem = {};
    if (parsed.dims && typeof parsed.dims === "string") out.dims = normDims(parsed.dims);
    if (typeof parsed.qty === "number" && parsed.qty > 0) out.qty = parsed.qty;
    if (typeof parsed.material === "string") {
      const m = parsed.material.toUpperCase();
      if (m === "PE" || m === "EPE" || m === "PU") out.material = m;
    }
    if (typeof parsed.density === "string" && parsed.density.trim()) {
      out.density = parsed.density.trim();
    }
    if (typeof parsed.cavityCount === "number" && parsed.cavityCount >= 0) {
      out.cavityCount = parsed.cavityCount;
    }
    if (Array.isArray(parsed.cavityDims)) {
      const cleaned = parsed.cavityDims
        .filter((x: any) => typeof x === "string" && x.trim())
        .map((x: string) => normDims(x));
      if (cleaned.length) out.cavityDims = cleaned;
    }

    return compact(out);
  } catch {
    return {};
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

function chooseModel(
  modeEnv: string | undefined,
  lastText: string,
  facts: Mem,
): "gpt-4.1-mini" | "gpt-4.1" {
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

/* ===================== DB enrichment hook (stronger resolver) ===================== */

async function enrichFromDB(facts: Mem): Promise<Mem> {
  try {
    const next: Mem = { ...facts };

    const family = String(facts.material || "").toUpperCase();
    if (!family) return next;

    const like =
      family === "PE"
        ? "%pe%"
        : family === "EPE"
        ? "%epe%"
        : family === "PU"
        ? "%pu%"
        : `%${family.toLowerCase()}%`;

    const densMatch = String(facts.density || "").match(/(\d+(?:\.\d+)?)/);
    const target = densMatch ? Number(densMatch[1]) : null;

    type MatRow = {
      id: number;
      name: string;
      density_lb_ft3: number | null;
      kerf_pct: number | null;
      min_charge: number | null;
    };

    let row: MatRow | null = null;

    if (target != null) {
      row = await one<MatRow>(
        `
        SELECT
          id,
          name,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,      -- real column, aliased
          min_charge_usd AS min_charge     -- real column, aliased
        FROM materials
        WHERE active = true
          AND (name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1)
          AND density_lb_ft3 IS NOT NULL
        ORDER BY ABS(density_lb_ft3 - $2), density_lb_ft3 ASC
        LIMIT 1
        `,
        [like, target],
      );
    } else {
      row = await one<MatRow>(
        `
        SELECT
          id,
          name,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,      -- real column, aliased
          min_charge_usd AS min_charge     -- real column, aliased
        FROM materials
        WHERE active = true
          AND (name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1)
        ORDER BY density_lb_ft3 NULLS LAST, id ASC
        LIMIT 1
        `,
        [like],
      );
    }

    if (!row) return next;

    // Fill everything we can, but don't overwrite explicit user input
    if (!next.material_id && row.id) next.material_id = row.id;
    if (!next.material_name && row.name) next.material_name = row.name;
    if (!next.density && row.density_lb_ft3 != null) {
      next.density = `${Number(row.density_lb_ft3)}lb`;
    }
    if (typeof next.kerf_pct !== "number" && row.kerf_pct != null) {
      next.kerf_pct = Number(row.kerf_pct);
    }
    if (typeof next.min_charge !== "number" && row.min_charge != null) {
      next.min_charge = Number(row.min_charge);
    }

    return next;
  } catch {
    return facts;
  }
}

/* ===================== NEW: price fetch helper ===================== */

function parseDimsNums(dims: string | null) {
  const d = String(dims || "").split("x").map((n) => Number(n));
  const [L, W, H] = [d[0] || 0, d[1] || 0, d[2] || 0];
  return { L, W, H };
}
function densityToPcf(density: string | null) {
  const m = String(density || "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function specsCompleteForQuote(s: {
  dims: string | null;
  qty: number | null;
  material_id: number | null;
}) {
  return !!(s.dims && s.qty && s.material_id);
}

async function fetchCalcQuote(opts: {
  dims: string;
  qty: number;
  material_id: number;
  cavities: string[];
  round_to_bf?: boolean;
}) {
  const { L, W, H } = parseDimsNums(opts.dims);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const url = `${base}/api/quotes/calc`;

  const body = {
    length_in: L,
    width_in: W,
    height_in: H,
    material_id: opts.material_id,
    qty: opts.qty,
    cavities: opts.cavities && opts.cavities.length ? opts.cavities : null,
    round_to_bf: !!opts.round_to_bf,
  };

  const r = await fetch(`${url}?t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j?.ok) return null;
  return j?.result || null;
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

    /** Thread key fallback when no explicit threadId provided */
    const providedThreadId = String(p.threadId ?? "").trim();
    const threadKey =
      providedThreadId ||
      (subject ? `sub:${subject.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180)}` : "");

    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    // Parse current turn (rule-based)
    let newly = extractAllFromTextAndSubject(lastText, subject);

    // LLM-assisted parsing to fill any remaining gaps (mini-only, no guessing)
    const needsLLM =
      (!!process.env.OPENAI_API_KEY &&
        (!newly.dims ||
          !newly.qty ||
          !newly.material ||
          !newly.density ||
          newly.cavityCount === undefined)) &&
      (lastText.length + subject.length) < 4000;

    if (needsLLM) {
      const llmFacts = await aiParseFacts("gpt-4.1-mini", lastText, subject);
      if (llmFacts && Object.keys(llmFacts).length) {
        newly = mergeFacts(newly, llmFacts);
      }
    }

    // Load + merge with prior facts
    let loaded: Mem = {};
    if (threadKey) loaded = await loadFacts(threadKey);

    // NEW: multi-turn helper —
    // if we already have an outside size, and the new message mentions a cavity
    // and contains a bare LxWxH, treat that new size as a cavity dim instead
    // of overwriting the outer dims.
    if (loaded && loaded.dims && newly.dims && newly.dims !== loaded.dims) {
      const lower = lastText.toLowerCase();
      const cavityCtx = /\b(cavity|cavities|pocket|pockets|cut[- ]?out|cutouts?)\b/.test(lower);
      const outsideCtx = /\b(outside|overall|finished)\s+(size|dimension|dimensions)\b/.test(lower);
      if (cavityCtx && !outsideCtx) {
        const prevCav = Array.isArray(loaded.cavityDims) ? loaded.cavityDims.slice() : [];
        const nextCav = Array.isArray(newly.cavityDims) ? newly.cavityDims.slice() : [];
        const combined: string[] = [...prevCav];

        const maybeNew = [newly.dims, ...nextCav];
        for (const cd of maybeNew) {
          if (cd && !combined.includes(cd)) combined.push(cd);
        }

        newly.cavityDims = combined;

        // Keep cavity count in sync with the list when we’re clearly talking about cavities
        if (combined.length) {
          newly.cavityCount = combined.length;
        }

        delete (newly as any).dims; // keep original outer dims from loaded
      }
    }

    const carry = {
      __lastMessageId: loaded?.__lastMessageId || "",
      __lastInternetMessageId: loaded?.__lastInternetMessageId || "",
      __turnCount: typeof loaded?.__turnCount === "number" ? loaded.__turnCount : 0,
    };

    let merged = mergeFacts({ ...loaded, ...carry }, newly);

    // bump turn counter (persist only if we have a key)
    merged.__turnCount = (merged.__turnCount || 0) + 1;

    // DB enrichment (fills density/material_id/kerf/min_charge when possible)
    merged = await enrichFromDB(merged);

    // Persist facts
    if (threadKey) await saveFacts(threadKey, merged);

    // LLM selection (hybrid) – used for openers, not parsing
    const llmSelected = chooseModel(process.env.ALEXIO_LLM_MODE, lastText, merged);

    // Compose text body (always include specs so later turns never “lose” details)
    const context = pickThreadContext(threadMsgs);
    const openerLLM =
      (await aiOpener(llmSelected, lastText, context)) || chooseOpener(threadKey || subject);
    const questions = renderQAAskOnlyMissing(merged);
    const firstReplyExtras = merged.__turnCount === 1 ? "\n\n" + capabilitiesBlurb() : "";

    const specs = {
      dims: merged.dims || null,
      qty: merged.qty ?? null,
      material: merged.material || null,
      density: merged.density || null,
      cavityCount: merged.cavityCount ?? null,
      cavityDims: Array.isArray(merged.cavityDims) ? merged.cavityDims : [],
      kerf_pct: typeof merged.kerf_pct === "number" ? merged.kerf_pct : null,
      min_charge: typeof merged.min_charge === "number" ? merged.min_charge : null,
      material_name: merged.material_name || null,
      material_id: typeof merged.material_id === "number" ? merged.material_id : null,
    };

    // Plain-text fallback with a Specs echo
    const textSpecsLines = [
      specs.dims ? `• Dimensions: ${specs.dims}` : "",
      specs.qty != null ? `• Quantity: ${specs.qty}` : "",
      specs.material ? `• Material: ${specs.material}` : "",
      specs.density ? `• Density: ${specs.density}` : "",
      specs.cavityCount != null ? `• Cavities: ${specs.cavityCount}` : "",
      specs.cavityDims && specs.cavityDims.length
        ? `• Cavity sizes: ${specs.cavityDims.join(", ")}`
        : "",
    ].filter(Boolean);

    let textBody =
      `${openerLLM}\n\n${questions}${firstReplyExtras}` +
      (textSpecsLines.length
        ? `\n\n— Specs (parsed) —\n${textSpecsLines.join("\n")}`
        : "");

    /* ========= If specs complete, call /api/quotes/calc to get pricing ========= */
    let calc: any = null;
    if (specsCompleteForQuote({ dims: specs.dims, qty: specs.qty, material_id: specs.material_id })) {
      try {
        calc = await fetchCalcQuote({
          dims: specs.dims as string,
          qty: Number(specs.qty),
          material_id: Number(specs.material_id),
          cavities: specs.cavityDims || [],
          round_to_bf: false,
        });
        if (calc) {
          const previewTotal =
            calc.total ?? calc.price_total ?? calc.prelim_total ?? null;
          if (previewTotal != null) {
            textBody += `\n\n— Preliminary total: ${previewTotal}`;
          }
        }
      } catch {
        // silent fail; we still send a template without pricing
      }
    }

    /* ========= Map parsed facts + calc to template signature ========= */

    const dimsNums = parseDimsNums(specs.dims);
    const densityPcf = densityToPcf(specs.density);
    const qtyNum = Number(specs.qty || 0) || 0;
    const kerfPct =
      typeof specs.kerf_pct === "number"
        ? specs.kerf_pct
        : typeof calc?.kerf_pct === "number"
        ? calc.kerf_pct
        : 0;

    const piece_ci_fallback = Math.max(0, dimsNums.L * dimsNums.W * dimsNums.H);
    const order_ci_fallback = piece_ci_fallback * qtyNum;
    const order_ci_waste_fallback = Math.round(order_ci_fallback * (1 + kerfPct / 100));

    const templateInput = {
      customerLine: openerLLM,
      specs: {
        L_in: Number(dimsNums.L) || 0,
        W_in: Number(dimsNums.W) || 0,
        H_in: Number(dimsNums.H) || 0,
        thickness_under_in: null,
        qty: qtyNum || 0,
        density_pcf: densityPcf,
        foam_family: specs.material ? String(specs.material).toUpperCase() : null,
        color: null,
      },
      material: {
        name: specs.material_name || (specs.material ? String(specs.material).toUpperCase() : null),
        density_lbft3: densityPcf,
        kerf_pct: kerfPct || 0,
        price_per_ci: calc?.price_per_ci ?? null,
        price_per_bf: calc?.price_per_bf ?? null,
        min_charge: specs.min_charge ?? (calc?.min_charge ?? null),
      },
      pricing: {
        piece_ci: calc?.piece_ci ?? piece_ci_fallback,
        order_ci: calc?.order_ci ?? order_ci_fallback,
        order_ci_with_waste: calc?.order_ci_with_waste ?? order_ci_waste_fallback,
        raw: calc?.raw ?? calc?.price_raw ?? null,
        total: calc?.total ?? calc?.price_total ?? 0,
        used_min_charge: !!(calc?.used_min_charge || calc?.min_charge_applied),
      },
      missing: questions
        .split("\n")
        .map((s) => s.replace(/^-+\s?/, "").trim())
        .filter((s) => !!s && !/^fyi/i.test(s)),
    };

    // HTML body from your template
    let htmlBody = "";
    try {
      htmlBody = String(renderQuoteEmail(templateInput as any));

      // Append a small Cutouts section if we have them
      const cavCount = specs.cavityCount ?? null;
      const cavList = Array.isArray(specs.cavityDims) ? specs.cavityDims : [];
      if (cavCount != null || cavList.length > 0) {
        const listHtml = cavList.length ? `<li>Sizes: ${cavList.join(", ")}</li>` : "";
        const countHtml = cavCount != null ? `<li>Count: ${cavCount}</li>` : "";
        htmlBody += `
          <h3 style="margin:18px 0 8px 0">Cutouts</h3>
          <ul style="margin:0 0 12px 20px">${countHtml}${listHtml}</ul>
        `;
      }
    } catch {
      const li = textSpecsLines.map((l) => `<li>${l.replace(/^•\s?/, "")}</li>`).join("");
      const missingHtml = templateInput.missing.map((l) => `<li>${l}</li>`).join("");
      htmlBody = `
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
          <p>${openerLLM}</p>
          ${
            missingHtml
              ? `<ul>${missingHtml}</ul>`
              : `<p>Great — I have everything I need. I’ll run pricing now and follow up shortly.</p>`
          }
          ${li ? `<h3 style="margin-top:16px;margin-bottom:6px">Specs (parsed)</h3><ul>${li}</ul>` : ""}
        </div>
      `;
    }

    // Recipient guardrails
    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail)
      return err("missing_toEmail", {
        reason: "Lookup did not produce a recipient; refusing to fall back to mailbox.",
      });
    const ownDomain = mailbox.split("@")[1] || "";
    if (toEmail === mailbox || (ownDomain && toEmail.endsWith(`@${ownDomain}`))) {
      return err("bad_toEmail", {
        toEmail,
        reason: "Recipient is our own mailbox/domain; blocking to avoid self-replies.",
      });
    }

    // Thread continuity
    const inReplyTo = String(merged?.__lastInternetMessageId || "").trim() || undefined;

    console.info(
      "[orchestrate] msgraph/send { to:",
      toEmail,
      ", dryRun:",
      !!p.dryRun,
      ", threadKey:",
      threadKey || "<none>",
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
        preview: textBody.slice(0, 900),
        htmlPreview: htmlBody.slice(0, 900),
        specs: {
          dims: specs.dims,
          qty: specs.qty,
          material: specs.material,
          density: specs.density,
          cavityCount: specs.cavityCount,
          cavityDims: specs.cavityDims,
          material_id: specs.material_id,
        },
        calc: calc || null,
        facts: merged,
        mem: { threadKey: String(threadKey), loadedKeys: Object.keys(loaded), mergedKeys: Object.keys(merged) },
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
        text: textBody, // plain fallback
        html: htmlBody, // template w/ pricing if available
        inReplyTo: inReplyTo || null,
        dryRun: false,
      }),
      cache: "no-store",
    });
    const sent = await r.json().catch(() => ({}));

    // Persist outbound IDs for next turn
    if (threadKey && (r.ok || r.status === 202) && (sent?.messageId || sent?.internetMessageId)) {
      const updated = {
        ...merged,
        __lastGraphMessageId: sent?.messageId || merged?.__lastGraphMessageId || "",
        __lastInternetMessageId: sent?.internetMessageId || merged?.__lastInternetMessageId || "",
      };
      await saveFacts(threadKey, updated);
    }

    return ok({
      sent: r.ok || r.status === 202,
      status: r.status,
      toEmail,
      result: sent?.result || null,
      messageId: sent?.messageId || null,
      internetMessageId: sent?.internetMessageId || null,
      specs: {
        dims: specs.dims,
        qty: specs.qty,
        material: specs.material,
        density: specs.density,
        cavityCount: specs.cavityCount,
        cavityDims: specs.cavityDims,
        material_id: specs.material_id,
      },
      calc: calc || null,
      facts: merged,
      store: LAST_STORE,
      llm: llmSelected,
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
