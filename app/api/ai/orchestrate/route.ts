// app/api/ai/orchestrate/route.ts
//
// PATH-A SAFE VERSION
// — cavity durability improved
// — DIA conversion
// — template always guaranteed
// — no changes to threading, memory, LLM selection, or msgraph calls

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts, LAST_STORE } from "@/app/lib/memory";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================
   Utility helpers
   ============================================================ */

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

function pickThreadContext(threadMsgs: any[] = []): string {
  const take = threadMsgs.slice(-3);
  const snippets = take
    .map((m) => String(m?.text || m?.body || m?.content || "").trim())
    .filter(Boolean)
    .map((s) => (s.length > 220 ? s.slice(0, 220) + "…" : s));
  return snippets.join("\n---\n");
}

/* ============================================================
   DIMENSION + CAVITY HANDLING FIXES (DIA support)
   ============================================================ */

function normalizeCavity(c: string): string {
  if (!c) return c;
  const s = c.trim();
  // Convert Ø prefix → DIA
  if (s.startsWith("Ø") || s.startsWith("ø")) {
    return `DIA ${s.slice(1)}`;
  }
  return s;
}

function applyCavityNormalization(facts: Mem): Mem {
  if (!facts) return facts;
  if (!Array.isArray(facts.cavityDims)) return facts;

  facts.cavityDims = facts.cavityDims
    .map((c: string) => normalizeCavity(c))
    .filter((x) => x && x.trim());

  return facts;
}

/* ============================================================
   DIM / QTY / DENSITY extraction (core kept same)
   ============================================================ */

const NUM = "\\d*\\.?\\d+";

function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/, "").toLowerCase();
}

function grabDims(raw: string) {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/(\d+(?:\.\d+)?)\s*"\s*(?=[x×])/gi, "$1 ")
    .replace(/\s+/g, " ");

  const m = cleaned.match(
    new RegExp(
      `\\b(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*(?:in|inch|inches|"))?\\b`,
      "i"
    )
  );
  return m ? `${m[1]}x${m[2]}x${m[3]}` : undefined;
}

function grabQty(raw: string) {
  const t = raw.toLowerCase();
  let m =
    t.match(/\bqty\s*(?:is|=|of|to)?\s*(\d{1,6})\b/) ||
    t.match(/\bquantity\s*(?:is|=|of|to)?\s*(\d{1,6})\b/) ||
    t.match(/\bchange\s+qty(?:uantity)?\s*(?:to|from)?\s*(\d{1,6})\b/) ||
    t.match(/\bmake\s+it\s+(\d{1,6})\b/) ||
    t.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|parts?)\b/);

  if (m) return Number(m[1]);

  const norm = t.replace(/(\d+(?:\.\d+)?)\s*"\s*(?=[x×])/g, "$1 ");
  m = norm.match(
    new RegExp(
      `\\b(\\d{1,6})\\s+(?:${NUM}\\s*[x×]\\s*${NUM}\\s*[x×]\\s*${NUM})(?:\\s*(?:pcs?|pieces?))\\b`,
      "i"
    )
  );
  if (m) return Number(m[1]);

  m = norm.match(/\bfor\s+(\d{1,6})\s*(?:pcs?|pieces?|parts?)?\b/);
  if (m) return Number(m[1]);

  return undefined;
}

function grabDensity(t: string) {
  const m =
    t.match(new RegExp(`\\b(${NUM})\\s*(?:lb\\/?:?ft?3|lb(?:s)?|#|pcf)\\b`)) ||
    t.match(new RegExp(`(?:density|foam\\s*density|pcf)\\D{0,10}(${NUM})`));
  return m ? `${m[1]}lb` : undefined;
}

function grabMaterial(t: string) {
  if (/\bpolyethylene\b|\bpe\b/.test(t)) return "PE";
  if (/\bexpanded\s*pe\b|\bepe\b/.test(t)) return "EPE";
  if (/\bpolyurethane\b|\bpu\b/.test(t)) return "PU";
  return undefined;
}

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

/* ============================================================
   LABELED / FREE TEXT PARSERS (unchanged except DIA conversion)
   ============================================================ */

function extractLabeledLines(s: string): Mem {
  const out: Mem = {};
  const lines = (s || "").split(/\r?\n/);

  const addCavity = (val: string) => {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(normalizeCavity(normDims(val)));
    out.cavityDims = list;
  };

  let inCutouts = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim().replace(/^[-•]\s*/, "");
    const t = line.toLowerCase();

    if (!t) continue;

    if (/^cutouts?$/i.test(line)) {
      inCutouts = true;
      continue;
    }

    const next = (lines[i + 1] || "").trim().toLowerCase();

    if (/^outside\s*size$/i.test(line) && next) {
      const dims = grabDims(next) || grabDims(line + " " + next);
      if (dims) {
        out.dims = normDims(dims);
        i++;
        continue;
      }
    }

    if (/^quantity$/i.test(line) && /^\d{1,6}\b/.test(next)) {
      out.qty = Number(next.match(/(\d{1,6})/)![1]);
      i++;
      continue;
    }

    if (/^density$/i.test(line) && next) {
      const dens = grabDensity(next);
      if (dens) {
        out.density = dens;
        i++;
        continue;
      }
    }

    if (/^foam\s*family$/i.test(line) && next) {
      const mat = grabMaterial(next);
      if (mat) {
        out.material = mat;
        i++;
        continue;
      }
    }

    if (inCutouts) {
      let m = t.match(/^count\s*[:\-]\s*(\d{1,4})/);
      if (m) {
        out.cavityCount = Number(m[1]);
        continue;
      }

      m = t.match(/^sizes?\s*[:\-]\s*(.+)$/);
      if (m) {
        const part = m[1].replace(/\beach\b/i, "");
        const tokens = part.split(/[,;]+/);
        for (const tok of tokens) {
          const dd = grabDims(tok.trim());
          if (dd) {
            addCavity(dd);
            continue;
          }
          const m2 = tok.trim().match(new RegExp(`(${NUM})\\s*[x×]\\s*(${NUM})`));
          if (m2) addCavity(`${m2[1]}x${m2[2]}`);
        }
        continue;
      }
    }

    let m =
      t.match(/^(?:finished|overall|outside)?\s*(?:size|dimensions?)\s*[:\-]\s*(.+)$/) ||
      t.match(/^dims?\s*[:\-]\s*(.+)$/);
    if (m) {
      const dims = grabDims(m[1]);
      if (dims) out.dims = normDims(dims);
      continue;
    }

    m = t.match(/^(?:qty|quantity)\s*(?:is|=|of|to)?\s*(\d{1,6})/);
    if (m) {
      out.qty = Number(m[1]);
      continue;
    }

    if (/^material\s*[:\-]/.test(t)) {
      const mat = grabMaterial(t);
      if (mat) out.material = mat;
      continue;
    }

    m = t.match(new RegExp(`^density\\s*[:\\-]\\s*(${NUM})`));
    if (m) {
      out.density = `${m[1]}lb`;
      continue;
    }

    // Cavity Count
    m = t.match(/^(?:cavities?|pockets?|cutouts?)\s*[:\-]\s*(\d{1,4})/);
    if (m) {
      out.cavityCount = Number(m[1]);
      continue;
    }

    // Cavity Size
    m = t.match(/^(?:cavities?|pockets?|cutouts?)\s*[:\-]\s*(.+)$/);
    if (m) {
      const part = m[1];
      const tokens = part.split(/[,;]+/);
      for (const tok of tokens) {
        const dd = grabDims(tok.trim());
        if (dd) addCavity(dd);
      }
    }
  }

  return out;
}

function extractFreeText(s = ""): Mem {
  const lower = s.toLowerCase();
  const out: Mem = {};

  const dims = grabDims(lower);
  if (dims) out.dims = normDims(dims);

  const qty = grabQty(lower);
  if (qty !== undefined) out.qty = qty;

  const dens = grabDensity(lower);
  if (dens) out.density = dens;

  const mat = grabMaterial(lower);
  if (mat) out.material = mat;

  const cavMatch = lower.match(/(\d{1,3})\s*(?:cavities|cavity|pockets?|cutouts?)/);
  if (cavMatch) out.cavityCount = Number(cavMatch[1]);

  return out;
}

function extractFromSubject(s = ""): Mem {
  return extractFreeText(s);
}

function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const a = extractFreeText(body);
  const b = extractLabeledLines(body);
  const c = extractFromSubject(subject);
  return mergeFacts(mergeFacts(a, b), c);
}

/* ============================================================
   AI PARSER (unchanged)
   ============================================================ */

async function aiParseFacts(model: string, body: string, subject: string): Promise<Mem> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return {};
  if (!body && !subject) return {};

  try {
    const prompt = `
Extract foam quote facts.
Return JSON only.

Subject:
${subject}

Body:
${body}
`.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 150 })
    });

    const raw = await r.text();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return {};
    const parsed = JSON.parse(raw.slice(start, end + 1));

    const out: Mem = {};
    if (parsed.dims) out.dims = normDims(parsed.dims);
    if (parsed.qty) out.qty = parsed.qty;
    if (parsed.material) out.material = parsed.material;
    if (parsed.density) out.density = parsed.density;
    if (parsed.cavityCount != null) out.cavityCount = parsed.cavityCount;
    if (Array.isArray(parsed.cavityDims)) {
      out.cavityDims = parsed.cavityDims.map((x: string) => normalizeCavity(normDims(x)));
    }

    return compact(out);
  } catch {
    return {};
  }
}

/* ============================================================
   LLM opener (unchanged)
   ============================================================ */

const HUMAN_OPENERS = [
  "Appreciate the details—once we lock a few specs I’ll price this out.",
  "Thanks for sending this—happy to quote it as soon as I confirm a couple items.",
  "Got it—let me confirm a few specs and I’ll run pricing.",
  "Thanks for the info—if I can fill a couple gaps I’ll send numbers right away."
];

function chooseOpener(seed: string) {
  let h = 2166136261 >>> 0;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return HUMAN_OPENERS[h % HUMAN_OPENERS.length];
}

async function aiOpener(model: string, lastInbound: string, context: string) {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  try {
    const prompt = `
Write ONE friendly sentence acknowledging the message and saying you'll price it after confirming a couple specs.
No bullets.

Context:
${context}

Customer:
${lastInbound}
`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: prompt, max_output_tokens: 60 })
    });

    const j = await r.json().catch(() => ({}));
    const text =
      j.output_text ||
      j.output?.[0]?.content?.[0]?.text ||
      j.choices?.[0]?.text ||
      "";

    return text.trim();
  } catch {
    return null;
  }
}

/* ============================================================
   DB ENRICHMENT (unchanged)
   ============================================================ */

async function enrichFromDB(f: Mem): Promise<Mem> {
  try {
    if (!f.material) return f;
    const like = `%${String(f.material).toLowerCase()}%`;

    const densNum = Number((f.density || "").match(/(\d+(\.\d+)?)/)?.[1] || 0);

    const row = await one<any>(
      `
      SELECT id, name, density_lb_ft3, kerf_waste_pct AS kerf_pct, min_charge_usd AS min_charge
      FROM materials
      WHERE active = true
        AND (name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1)
      ORDER BY ABS(COALESCE(density_lb_ft3,0) - $2)
      LIMIT 1;
      `,
      [like, densNum]
    );

    if (row) {
      if (!f.material_id) f.material_id = row.id;
      if (!f.material_name) f.material_name = row.name;
      if (!f.density && row.density_lb_ft3 != null) {
        f.density = `${row.density_lb_ft3}lb`;
      }
      if (f.kerf_pct == null && row.kerf_pct != null) f.kerf_pct = row.kerf_pct;
      if (f.min_charge == null && row.min_charge != null) f.min_charge = row.min_charge;
    }

    return f;
  } catch {
    return f;
  }
}

/* ============================================================
   QUOTE CALC
   ============================================================ */

function parseDimsNums(dims: string | null) {
  const d = (dims || "").split("x").map(Number);
  return { L: d[0] || 0, W: d[1] || 0, H: d[2] || 0 };
}

function densityToPcf(density: string | null) {
  const m = String(density || "").match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function specsCompleteForQuote(s: any) {
  return !!(s.dims && s.qty && s.material_id);
}

async function fetchCalcQuote(opts: {
  dims: string;
  qty: number;
  material_id: number;
  cavities: string[];
  round_to_bf: boolean;
}) {
  const { L, W, H } = parseDimsNums(opts.dims);
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

  const r = await fetch(`${base}/api/quotes/calc?t=${Date.now()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      length_in: L,
      width_in: W,
      height_in: H,
      material_id: opts.material_id,
      qty: opts.qty,
      cavities: opts.cavities,
      round_to_bf: opts.round_to_bf
    })
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) return null;
  return j.result;
}

/* ============================================================
   MAIN PARSER / ROUTE
   ============================================================ */

async function parse(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const p = await parse(req);
    const dryRun = !!p.dryRun;
    const lastText = String(p.text || "");
    const subject = String(p.subject || "");
    const providedThreadId = String(p.threadId || "").trim();

    const threadKey =
      providedThreadId ||
      (subject ? `sub:${subject.toLowerCase().replace(/\s+/g, " ")}` : "");

    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];

    /* ------------------- Parse new turn ------------------- */
    let newly = extractAllFromTextAndSubject(lastText, subject);

    // LLM assist only if needed
    const needsLLM =
      !!process.env.OPENAI_API_KEY &&
      (!newly.dims || !newly.qty || !newly.material || !newly.density) &&
      lastText.length < 4000;

    if (needsLLM) {
      const llmFacts = await aiParseFacts("gpt-4.1-mini", lastText, subject);
      newly = mergeFacts(newly, llmFacts);
    }

    /* ------------------- Merge with memory ------------------- */
    let loaded: Mem = {};
    if (threadKey) loaded = await loadFacts(threadKey);

    // cavity fix: do NOT overwrite dims with cavity dims
    if (loaded.dims && newly.dims && loaded.dims !== newly.dims) {
      const lower = lastText.toLowerCase();
      const isCavityContext = /\bcavity|cutout|pocket\b/.test(lower);
      if (isCavityContext) {
        const cavs = loaded.cavityDims || [];
        if (!cavs.includes(newly.dims)) cavs.push(newly.dims);
        newly.cavityDims = cavs;
        delete newly.dims;
      }
    }

    let merged = mergeFacts(loaded, newly);

    // Required for template: correct DIA formatting
    merged = applyCavityNormalization(merged);

    merged.__turnCount = (merged.__turnCount || 0) + 1;

    /* ------------------- DB enrichment ------------------- */
    merged = await enrichFromDB(merged);

    if (threadKey) await saveFacts(threadKey, merged);

    /* ------------------- LLM opener ------------------- */
    const context = pickThreadContext(threadMsgs);
    const opener =
      (await aiOpener("gpt-4.1-mini", lastText, context)) ||
      chooseOpener(threadKey || subject);

    /* ------------------- Specs for template ------------------- */
    const specs = {
      dims: merged.dims || null,
      qty: merged.qty || null,
      material: merged.material || null,
      density: merged.density || null,
      cavityCount: merged.cavityCount ?? null,
      cavityDims: merged.cavityDims || [],
      material_id: merged.material_id || null
    };

    /* ------------------- Pricing ------------------- */
    let calc = null;
    if (specsCompleteForQuote(specs)) {
      calc = await fetchCalcQuote({
        dims: specs.dims!,
        qty: Number(specs.qty),
        material_id: Number(specs.material_id),
        cavities: specs.cavityDims,
        round_to_bf: false
      });
    }

    const dimsNums = parseDimsNums(specs.dims);
    const densityPcf = densityToPcf(specs.density);

    const templateInput = {
      customerLine: opener,
      specs: {
        L_in: dimsNums.L,
        W_in: dimsNums.W,
        H_in: dimsNums.H,
        qty: specs.qty,
        density_pcf: densityPcf,
        foam_family: specs.material
      },
      material: {
        name: merged.material_name,
        density_lbft3: densityPcf,
        kerf_pct: merged.kerf_pct,
        min_charge: merged.min_charge
      },
      pricing: {
        total: calc?.price_total ?? calc?.total ?? 0,
        piece_ci: calc?.piece_ci,
        order_ci: calc?.order_ci,
        order_ci_with_waste: calc?.order_ci_with_waste,
        used_min_charge: calc?.min_charge_applied
      },
      missing: (() => {
        const miss = [];
        if (!merged.dims) miss.push("Dimensions");
        if (!merged.qty) miss.push("Quantity");
        if (!merged.material) miss.push("Material");
        if (!merged.density) miss.push("Density");
        if (merged.cavityCount > 0 && (!merged.cavityDims || merged.cavityDims.length === 0)) {
          miss.push("Cavity sizes");
        }
        return miss;
      })(),
      facts: merged
    };

    let htmlBody = "";
    try {
      htmlBody = renderQuoteEmail(templateInput);
    } catch {
      htmlBody = `<div>${opener}</div>`;
    }

    const toEmail = String(p.toEmail || "").trim().toLowerCase();
    if (!toEmail) return err("missing_toEmail");

    const mailbox = String(process.env.MS_MAILBOX_FROM || "").trim().toLowerCase();
    if (toEmail === mailbox) return err("bad_toEmail");

    const inReplyTo = merged.__lastInternetMessageId || undefined;

    if (dryRun) {
      return ok({
        mode: "dryrun",
        htmlPreview: htmlBody,
        specs,
        calc,
        facts: merged
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
        html: htmlBody,
        text: opener,
        inReplyTo
      })
    });

    const sent = await r.json().catch(() => ({}));

    if (threadKey && (sent.messageId || sent.internetMessageId)) {
      merged.__lastGraphMessageId = sent.messageId || merged.__lastGraphMessageId;
      merged.__lastInternetMessageId =
        sent.internetMessageId || merged.__lastInternetMessageId;
      await saveFacts(threadKey, merged);
    }

    return ok({
      sent: true,
      toEmail,
      messageId: sent.messageId,
      internetMessageId: sent.internetMessageId,
      specs,
      calc,
      facts: merged
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
