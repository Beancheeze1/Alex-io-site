// app/api/ai/orchestrate/route.ts
//
// PATH-A SAFE VERSION
// - Hybrid regex + LLM parser
// - Cavity durability + DIA normalization
// - DB enrichment for material
// - Quote calc via /api/quotes/calc
// - Quote template rendering with missing-specs list
// - Stable quoteNumber per thread
// - Always store quote header when we have dims + qty + quoteNumber,
//   and only store line items once material_id is known.
// - Also load + save facts under quote_no so sketch auto-quote
//   data (dims/qty/cavities/material) is available on follow-up emails.
// - Dynamic price-break generation for multiple quantities (and stored into facts).
// - NEW 11/24: hydrateFromDBByQuoteNo()
//     * Pulls latest qty + dims from quote_items for this quote_no
//     * Pulls latest cavity sizes from quote_layout_packages.layout_json
//     * Only fills in fields that were NOT explicitly updated in this turn,
//       so “change qty to 250” in the email still wins over DB.

import { NextRequest, NextResponse } from "next/server";
import { loadFacts, saveFacts } from "@/app/lib/memory";
import { one } from "@/lib/db";
import { renderQuoteEmail } from "@/app/lib/email/quoteTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* ============================================================
   Types & small helpers
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
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
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
    .map((m) => {
      const from = m?.from?.email || m?.from?.name || "Customer";
      const txt = (m?.text || "").trim();
      if (!txt) return "";
      return `${from}: ${txt}`;
    })
    .filter(Boolean);
  return snippets.join("\n\n");
}

// Detect Q-AI-* style quote numbers in subject/body so we can
// pull sketch facts that were stored under quote_no.
function extractQuoteNo(text: string): string | null {
  if (!text) return null;
  const m = text.match(/Q-[A-Z]+-\d{8}-\d{6}/i);
  return m ? m[0] : null;
}

/* ============================================================
   Cavity normalization
   ============================================================ */

// Allow "1", "1.5" and also ".5" style numbers
const NUM = "(?:\\d{1,4}(?:\\.\\d+)?|\\.\\d+)";

function normalizeCavity(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();

  // DIA -> Ø
  s = s.replace(/\bdia\b/gi, "Ø").replace(/diameter/gi, "Ø");

  // Kill quotes, collapse spaces
  s = s.replace(/"/g, "").replace(/\s+/g, " ").trim();

  // Pattern: Ø6 x 1  -> Ø6x1
  const mCircle = s.match(/Ø\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (mCircle) {
    return `Ø${mCircle[1]}x${mCircle[2]}`;
  }

  // Generic rectangle: 3 x 2 x 1 -> 3x2x1
  const rect = s
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/[^0-9.xØ]/g, "")
    .replace(/x+/g, "x");
  return rect || raw.trim();
}

function applyCavityNormalization(facts: Mem): Mem {
  if (!facts) return facts;
  if (!Array.isArray(facts.cavityDims)) return facts;

  const cleaned: string[] = [];

  for (const raw of facts.cavityDims as string[]) {
    if (!raw) continue;

    // First basic normalization (DIA, quotes, etc.)
    const norm = normalizeCavity(String(raw));

    // Require exactly 3 numeric components L x W x H
    const m = norm
      .toLowerCase()
      .replace(/"/g, "")
      .match(
        new RegExp(
          `(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})`,
          "i",
        ),
      );

    if (!m) {
      // Can't see 3 numbers => skip this cavity
      continue;
    }

    const L = m[1];
    const W = m[2];
    const H = m[3];

    cleaned.push(`${L}x${W}x${H}`);
  }

  if (!cleaned.length) {
    // Nothing valid left — drop cavity info
    delete (facts as any).cavityDims;
    delete (facts as any).cavityCount;
    return facts;
  }

  (facts as any).cavityDims = cleaned;
  (facts as any).cavityCount = cleaned.length;

  return facts;
}

/* ============================================================
   DB enrichment (material)
   ============================================================ */

async function enrichFromDB(f: Mem): Promise<Mem> {
  try {
    if (!f.material) return f;

    const like = `%${String(f.material).toLowerCase()}%`;
    const densNum = Number((f.density || "").match(/(\d+(\.\d+)?)/)?.[1] || 0);

    const row = await one<any>(
      `
      SELECT
        id,
        name,
        density_lb_ft3,
        kerf_waste_pct AS kerf_pct,
        min_charge_usd AS min_charge
      FROM materials
      WHERE active = true
        AND (name ILIKE $1 OR category ILIKE $1 OR subcategory ILIKE $1)
      ORDER BY ABS(COALESCE(density_lb_ft3, 0) - $2)
      LIMIT 1;
      `,
      [like, densNum],
    );

    if (row) {
      if (!f.material_id) f.material_id = row.id;
      if (!f.material_name) f.material_name = row.name;
      if (!f.density && row.density_lb_ft3 != null) {
        f.density = `${row.density_lb_ft3}lb`;
      }
      if (f.kerf_pct == null && row.kerf_pct != null)
        f.kerf_pct = row.kerf_pct;
      if (f.min_charge == null && row.min_charge != null)
        f.min_charge = row.min_charge;
    }

    return f;
  } catch {
    return f;
  }
}

/* ============================================================
   NEW: hydrateFromDBByQuoteNo
   Keeps facts in sync with DB qty + cavities
   ============================================================ */

async function hydrateFromDBByQuoteNo(
  f: Mem,
  opts: { lockQty?: boolean; lockCavities?: boolean; lockDims?: boolean } = {},
): Promise<Mem> {
  const out: Mem = { ...(f || {}) };

  const quoteNo: string | undefined =
    (out.quote_no as string | undefined) ||
    (out.quoteNumber as string | undefined);

  if (!quoteNo) return out;

  try {
    // 1) Primary item for this quote: qty + dims
    const primaryItem = await one<any>(
      `
      select qi.id,
             qi.quote_id,
             qi.qty,
             qi.length_in,
             qi.width_in,
             qi.height_in
      from quote_items qi
      join quotes q on qi.quote_id = q.id
      where q.quote_no = $1
      order by qi.id asc
      limit 1;
      `,
      [quoteNo],
    );

    if (primaryItem) {
      // Qty: only hydrate from DB if this turn did NOT explicitly provide a qty
      if (!opts.lockQty) {
        const dbQty = Number(primaryItem.qty);
        if (Number.isFinite(dbQty) && dbQty > 0) {
          out.qty = dbQty;
        }
      }

      // Dims: if we don't already have dims (or they are clearly bogus), hydrate from DB
      if (!opts.lockDims) {
        const hasDims =
          typeof out.dims === "string" && out.dims.trim().length > 0;
        if (!hasDims) {
          const L = Number(primaryItem.length_in) || 0;
          const W = Number(primaryItem.width_in) || 0;
          const H = Number(primaryItem.height_in) || 0;
          if (L > 0 && W > 0 && H > 0) {
            out.dims = `${L}x${W}x${H}`;
          }
        }
      }
    }

    // 2) Latest saved layout package: cavity sizes from layout_json
    if (!opts.lockCavities) {
      const layoutPkg = await one<any>(
        `
        select lp.layout_json
        from quote_layout_packages lp
        join quotes q on lp.quote_id = q.id
        where q.quote_no = $1
        order by lp.created_at desc
        limit 1;
        `,
        [quoteNo],
      );

      if (layoutPkg && layoutPkg.layout_json && !out.cavityDims) {
        const layout = layoutPkg.layout_json as {
          cavities?: {
            lengthIn: number;
            widthIn: number;
            depthIn: number;
          }[];
        };

        if (layout && Array.isArray(layout.cavities) && layout.cavities.length) {
          const cavDims = layout.cavities
            .map((c) => {
              const L = Number(c.lengthIn) || 0;
              const W = Number(c.widthIn) || 0;
              const D = Number(c.depthIn) || 0;
              if (L <= 0 || W <= 0 || D <= 0) return null;
              return `${L}x${W}x${D}`;
            })
            .filter(Boolean) as string[];

          if (cavDims.length) {
            out.cavityDims = cavDims;
            out.cavityCount = cavDims.length;
          }
        }
      }
    }

    return out;
  } catch {
    // If anything goes wrong, fall back to existing facts
    return out;
  }
}

/* ============================================================
   Dimension / density helpers
   ============================================================ */

function normDims(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = t.match(
    new RegExp(
      `\\b(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*(?:in|inch|inches))?\\b`,
      "i",
    ),
  );
  if (!m) return undefined;
  return `${m[1]}x${m[2]}x${m[3]}`;
}

function parseDimsNums(dims: string | null | undefined) {
  const d = (dims || "").split("x").map(Number);
  return {
    L: d[0] || 0,
    W: d[1] || 0,
    H: d[2] || 0,
  };
}

function densityToPcf(density: string | null | undefined) {
  const m = String(density || "").match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function specsCompleteForQuote(s: {
  dims: string | null;
  qty: number | string | null;
  material_id: number | null;
}) {
  return !!(s.dims && s.qty && s.material_id);
}

/* ============================================================
   Quote calc via internal API
   ============================================================ */

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
      round_to_bf: opts.round_to_bf,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j.ok) return null;
  return j.result;
}

// Dynamic price breaks
type PriceBreak = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
};

async function buildPriceBreaks(
  baseOpts: {
    dims: string;
    qty: number;
    material_id: number;
    cavities: string[];
    round_to_bf: boolean;
  },
  baseCalc: any,
): Promise<PriceBreak[] | null> {
  const baseQty = baseOpts.qty;
  if (!baseQty || baseQty <= 0) return null;

  const factors = [1, 2, 3, 5, 10];
  const seen = new Set<number>();
  const out: PriceBreak[] = [];

  for (const f of factors) {
    const q = Math.round(baseQty * f);
    if (!q || q <= 0 || seen.has(q)) continue;
    seen.add(q);

    let calc = baseCalc;
    if (f !== 1) {
      calc = await fetchCalcQuote({
        ...baseOpts,
        qty: q,
      });
      if (!calc) continue;
    }

    const total = (calc.price_total ?? calc.total ?? calc.order_total ?? 0) as
      | number
      | 0;
    const piece = total && q > 0 ? total / q : null;

    out.push({
      qty: q,
      total,
      piece,
      used_min_charge: (calc.min_charge_applied ?? null) as boolean | null,
    });
  }

  return out.length ? out : null;
}

/* ============================================================
   Regex-based parsing helpers
   ============================================================ */

function grabDims(raw: string): string | undefined {
  const text = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m =
    text.match(
      new RegExp(
        `\\b(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*(?:in|inch|inches))?\\b`,
        "i",
      ),
    ) ||
    text.match(
      new RegExp(
        `\\b(?:size|dimensions?|dims?)\\s*[:\\-]?\\s*(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})\\b`,
        "i",
      ),
    );

  if (!m) return undefined;
  return `${m[1]}x${m[2]}x${m[3]}`;
}

// Prefer explicit "overall / outside / block size" phrases for the main block.
function grabOutsideDims(raw: string): string | undefined {
  const text = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = text.match(
    new RegExp(
      `\\b(?:overall|outside|block|foam)\\s+(?:size|dimensions?|dims?)` +
        `\\s*(?:is|=|:)?\\s*` +
        `(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})` +
        `(?:\\s*(?:in|inch|inches))?\\b`,
      "i",
    ),
  );
  if (!m) return undefined;
  return `${m[1]}x${m[2]}x${m[3]}`;
}


function grabQty(raw: string): number | undefined {
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
      `\\b(\\d{1,6})\\s+(?:${NUM}\\s*[x×]\\s*${NUM}\\s*[x×]\\s*${NUM})(?:\\s*(?:pcs?|pieces?))?\\b`,
      "i",
    ),
  );
  if (m) return Number(m[1]);

  m = norm.match(/\bfor\s+(\d{1,6})\s*(?:pcs?|pieces?|parts?)?\b/);
  if (m) return Number(m[1]);

  return undefined;
}

function grabDensity(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const m =
    t.match(
      /(\d+(\.\d+)?)\s*(?:pcf|lb\/?ft3?|pound(?:s)?\s*per\s*cubic\s*foot)/,
    ) || t.match(/(\d+(\.\d+)?)\s*#\s*(?:foam)?\b/);
  if (!m) return undefined;
  return `${m[1]}#`;
}

function grabMaterial(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const materials = [
    "polyethylene",
    "pe",
    "epe",
    "xlpe",
    "polyurethane",
    "urethane",
    "pu",
    "kaizen",
    "pp",
    "polystyrene",
    "eps",
  ];

  for (const name of materials) {
    if (t.includes(name)) return name;
  }
  return undefined;
}

function extractCavities(raw: string): {
  cavityCount?: number;
  cavityDims?: string[];
} {
  const t = raw.toLowerCase();
  const lines = raw.split(/\r?\n/);
  const cavityDims: string[] = [];
  let cavityCount: number | undefined;

  const mCount =
    t.match(/\b(\d{1,3})\s*(?:cavities|cavity|pockets?|cutouts?)\b/) ||
    t.match(
      /\btotal\s+of\s+(\d{1,3})\s*(?:cavities|cavity|pockets?|cutouts?)\b/,
    );
  if (mCount) {
    cavityCount = Number(mCount[1]);
  }

 for (const line of lines) {
    const lower = line.toLowerCase();
    if (!/\bcavity|cavities|cutout|pocket\b/.test(lower)) continue;

    // NEW: split on period, comma, semicolon so we don't mix cavity dims with outside dims
    const tokens = line.split(/[.;,]/);

    for (const tok of tokens) {
      const dd = grabDims(tok);
      if (dd) {
        cavityDims.push(dd);
        continue;
      }

      const mPair = tok.trim().match(new RegExp(`(${NUM})\\s*[x×]\\s*(${NUM})`));
      if (mPair) {
        // If only LxW found, we treat missing depth as 1"
        // Example: "1x1" → "1x1x1"
        cavityDims.push(`${mPair[1]}x${mPair[2]}x1`);
      }
    }
  }

  return {
    cavityCount,
    cavityDims: cavityDims.length ? cavityDims : undefined,
  };
}

/* ============================================================
   Initial fact extraction from subject + body
   ============================================================ */

function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const rawBody = body || "";
  const facts: Mem = {};

  // Full text (subject + body) for most parsing
  const text = `${subject}\n\n${rawBody}`;

  // 1) MAIN DIMS (outside size / block size)
  //
  // First, try to find explicit "overall / outside / block size" phrases
  // anywhere in the text (even if they share a line with "cavity").
  const outsideDims = grabOutsideDims(text);
  if (outsideDims) {
    facts.dims = normDims(outsideDims) || outsideDims;
  } else {
    // Fallback: old behavior — ignore lines that talk about cavities/pockets/cutouts
    const bodyNoCavity = rawBody
      .split(/\r?\n/)
      .filter(
        (ln) =>
          !/\bcavity\b|\bcavities\b|\bpocket\b|\bpockets\b|\bcutout\b|\bcutouts\b/i.test(
            ln,
          ),
      )
      .join("\n");

    const dimsSource = `${subject}\n\n${bodyNoCavity}`;
    const dims = grabDims(dimsSource);
    if (dims && !facts.dims) {
      facts.dims = normDims(dims) || dims;
    }
  }

  // 2) Everything else (qty, density, material, cavities) can look at full text


  const qtyVal = grabQty(text);
  if (qtyVal) facts.qty = qtyVal;

  const density = grabDensity(text);
  if (density) facts.density = density;

  const material = grabMaterial(text);
  if (material) facts.material = material;

  const { cavityCount, cavityDims } = extractCavities(text);
  if (cavityCount != null) facts.cavityCount = cavityCount;
  if (cavityDims && cavityDims.length) facts.cavityDims = cavityDims;

  const mEmail = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (mEmail) facts.customerEmail = mEmail[0];

  return compact(facts);
}

/* ============================================================
   LLM helpers (facts + opener)
   ============================================================ */

async function aiParseFacts(
  model: string,
  body: string,
  subject: string,
): Promise<Mem> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return {};
  if (!body && !subject) return {};
  try {
    const prompt = `
Extract foam quote facts.
Return JSON only.

Valid keys:
- dims: string like "12x10x2"
- qty: integer
- material: string
- density: string like "1.7#"
- cavityCount: integer
- cavityDims: array of strings

Subject:
${subject}

Body:
${body}
    `.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 256,
        temperature: 0.1,
      }),
    });

    const raw = await r.text();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return {};

    const parsed = JSON.parse(raw.slice(start, end + 1));
    const out: Mem = {};

    if (parsed.dims) out.dims = normDims(parsed.dims) || parsed.dims;
    if (parsed.qty) out.qty = parsed.qty;
    if (parsed.material) out.material = parsed.material;
    if (parsed.density) out.density = parsed.density;
    if (parsed.cavityCount != null) out.cavityCount = parsed.cavityCount;
    if (Array.isArray(parsed.cavityDims)) {
      out.cavityDims = parsed.cavityDims.map((x: string) =>
        normalizeCavity(normDims(x) || x),
      );
    }

    return compact(out);
  } catch {
    return {};
  }
}

/* ============================================================
   LLM opener
   ============================================================ */

const HUMAN_OPENERS = [
  "Appreciate the details—once we lock a few specs I’ll price this out.",
  "Thanks for sending this—happy to quote it as soon as I confirm a couple items.",
  "Got it—let me confirm a few specs and I’ll run pricing.",
  "Thanks for the info—if I can fill a couple gaps I’ll send numbers right away.",
];

function chooseOpener(seed: string) {
  if (!seed) return HUMAN_OPENERS[0];
  let h = 2166136261 >>> 0;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return HUMAN_OPENERS[h % HUMAN_OPENERS.length];
}

async function aiOpener(
  model: string,
  lastInbound: string,
  context: string,
): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  try {
    const prompt = `
Write ONE friendly sentence acknowledging the message and saying you'll price it after confirming a couple specs.
No bullets.

Context:
${context}

Last inbound:
${lastInbound}
    `.trim();

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
        max_output_tokens: 80,
        temperature: 0.4,
      }),
    });

    const j = await r.json().catch(() => ({} as any));
    const txt: string =
      j.output?.[0]?.content?.[0]?.text ??
      j.output_text ??
      j.choices?.[0]?.message?.content ??
      "";
    const clean = String(txt || "").replace(/\s+/g, " ").trim();
    return clean || null;
  } catch {
    return null;
  }
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

export async function POST(req: NextRequest) {
  try {
    const p = (await req.json().catch(() => ({}))) as In;
    const mode = String(p.mode || "ai");

    if (mode !== "ai") {
      return err("unsupported_mode", { mode });
    }

    const lastText = String(p.text || "");
    const subject = String(p.subject || "");
    const providedThreadId = String(p.threadId || "").trim();

    const threadKey =
      providedThreadId ||
      (subject ? `sub:${subject.toLowerCase().replace(/\s+/g, " ")}` : "");

    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];
    const dryRun = !!p.dryRun;

    // See if we can detect a quote_no in the subject so we can
    // pull sketch facts stored under that key.
    const subjectQuoteNo = extractQuoteNo(subject);

    /* ------------------- Parse new turn ------------------- */

    let newly = extractAllFromTextAndSubject(lastText, subject);

    const needsLLM =
      !newly.dims ||
      !newly.qty ||
      !newly.material ||
      !newly.density ||
      (newly.cavityCount &&
        (!newly.cavityDims || newly.cavityDims.length === 0));

    if (needsLLM) {
      const llmFacts = await aiParseFacts("gpt-4.1-mini", lastText, subject);
      newly = mergeFacts(newly, llmFacts);
    }

    const hadNewQty = newly.qty != null;
    const hadNewCavities =
      Array.isArray(newly.cavityDims) && newly.cavityDims.length > 0;
    const hadNewDims = !!newly.dims;

    /* ------------------- Merge with memory ------------------- */

    let loadedThread: Mem = {};
    let loadedQuote: Mem = {};

    if (threadKey) {
      loadedThread = await loadFacts(threadKey);
    }
    if (subjectQuoteNo) {
      loadedQuote = await loadFacts(subjectQuoteNo);
    }

        // Merge order: thread-level facts first, then sketch / quote-level facts,
    // then the newest email facts overwrite.
    //
    // IMPORTANT:
    // For shared keys like dims / cavityDims / qty, the quote-level facts
    // (which now reflect the latest layout/apply) should override older
    // thread-level memory so we don't keep showing stale "3x2x1 in 10x10x2".
    let merged = mergeFacts(mergeFacts(loadedThread, loadedQuote), newly);


    merged = applyCavityNormalization(merged);

    // NEW: drop bogus cavities that exactly equal the main outside dims
    if (merged.dims && Array.isArray(merged.cavityDims)) {
      const dimsNorm = String(merged.dims).toLowerCase().trim();
      const filtered = (merged.cavityDims as string[]).filter(
        (c) => String(c).toLowerCase().trim() !== dimsNorm,
      );
      if (filtered.length > 0) {
        merged.cavityDims = filtered;
        merged.cavityCount = filtered.length;
      } else {
        delete merged.cavityDims;
        delete merged.cavityCount;
      }
    }

    merged.__turnCount = (merged.__turnCount || 0) + 1;

    // If sketch facts indicated fromSketch, normalize to a string flag
    // so the template can show the "from sketch" note.
    if (merged.fromSketch && !merged.from) {
      merged.from = "sketch-auto-quote";
    }

    // Stable quote number per thread
    if (!merged.quoteNumber && !merged.quote_no) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mi = String(now.getUTCMinutes()).padStart(2, "0");
      const ss = String(now.getUTCSeconds()).padStart(2, "0");
      const autoNo = `Q-AI-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
      merged.quoteNumber = autoNo;
      merged.quote_no = autoNo;
    } else if (!merged.quoteNumber && merged.quote_no) {
      merged.quoteNumber = merged.quote_no;
    }

    // If subject contained a quote number and merged doesn't have one yet,
    // adopt it so we stay aligned with sketch/apply.
    if (subjectQuoteNo && !merged.quote_no) {
      merged.quote_no = subjectQuoteNo;
      merged.quoteNumber = subjectQuoteNo;
    }

    /* ------------------- DB enrichment ------------------- */

    merged = await enrichFromDB(merged);

    // 🔁 NEW: hydrate from DB so qty + cavities match the latest saved quote
    merged = await hydrateFromDBByQuoteNo(merged, {
      lockQty: hadNewQty,
      lockCavities: hadNewCavities,
      lockDims: hadNewDims,
    });

    // Save early baseline facts (pre-pricing) under keys
    if (threadKey) await saveFacts(threadKey, merged);
    if (merged.quote_no) await saveFacts(merged.quote_no, merged);

    /* ------------------- LLM opener ------------------- */

    const context = pickThreadContext(threadMsgs);
    const opener =
      (await aiOpener("gpt-4.1-mini", lastText, context)) ||
      chooseOpener(threadKey || subject || "default");

    /* ------------------- Specs for template ------------------- */

    const specs = {
      dims: merged.dims || null,
      qty: merged.qty || null,
      material: merged.material || null,
      density: merged.density || null,
      cavityCount: merged.cavityCount ?? null,
      cavityDims: merged.cavityDims || [],
      material_id: merged.material_id || null,
    };

    /* ------------------- Pricing & price breaks ------------------- */

    const canCalc = specsCompleteForQuote({
      dims: specs.dims,
      qty: specs.qty,
      material_id: specs.material_id,
    });

    let calc: any = null;
    let priceBreaks: PriceBreak[] | null = null;
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";

    if (canCalc) {
      calc = await fetchCalcQuote({
        dims: specs.dims as string,
        qty: Number(specs.qty),
        material_id: Number(specs.material_id),
        cavities: specs.cavityDims,
        round_to_bf: false,
      });

      if (calc && !dryRun) {
        priceBreaks = await buildPriceBreaks(
          {
            dims: specs.dims as string,
            qty: Number(specs.qty),
            material_id: Number(specs.material_id),
            cavities: specs.cavityDims,
            round_to_bf: false,
          },
          calc,
        );
      }
    }

    // Store price_breaks into facts so future turns see the same structure
    if (priceBreaks && priceBreaks.length) {
      merged.price_breaks = priceBreaks;
    }

    const hasDimsQty = !!(specs.dims && specs.qty);

    // Header: store whenever we have dims + qty + quoteNumber
    let quoteId = merged.quote_id;
    if (!dryRun && merged.quoteNumber && hasDimsQty && !quoteId) {
      try {
        const customerName =
          merged.customerName ||
          merged.customer_name ||
          merged.name ||
          "Customer";
        const customerEmail =
          merged.customerEmail || merged.email || null;
        const phone = merged.phone || null;
        const status = merged.status || "draft";

        const headerRes = await fetch(`${base}/api/quotes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote_no: String(merged.quoteNumber),
            customer_name: String(customerName),
            email: customerEmail,
            phone,
            status,
          }),
        });

        const headerJson = await headerRes.json().catch(() => ({} as any));
        if (headerRes.ok && headerJson?.ok && headerJson.quote?.id) {
          quoteId = headerJson.quote.id;
          merged.quote_id = quoteId;
          merged.status = headerJson.quote.status || merged.status;

          if (threadKey) await saveFacts(threadKey, merged);
          if (merged.quote_no) await saveFacts(merged.quote_no, merged);
        }
      } catch (err) {
        console.error("quote header store error:", err);
      }
    }

    // Primary item: only when we have material_id, and only once
    if (
      !dryRun &&
      quoteId &&
      canCalc &&
      specs.material_id &&
      !merged.__primary_item_created
    ) {
      try {
        const { L, W, H } = parseDimsNums(specs.dims);
        const itemBody: any = {
          length_in: L,
          width_in: W,
          height_in: H,
          material_id: Number(specs.material_id),
          qty: Number(specs.qty),
        };

        await fetch(`${base}/api/quotes/${quoteId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(itemBody),
        });

        merged.__primary_item_created = true;
        if (threadKey) await saveFacts(threadKey, merged);
        if (merged.quote_no) await saveFacts(merged.quote_no, merged);
      } catch (err) {
        console.error("quote item store error:", err);
      }
    }

    /* ------------------- Build email template ------------------- */

    const dimsNums = parseDimsNums(specs.dims);
    const densityPcf = densityToPcf(specs.density);

    const templateInput = {
      customerLine: opener,
      quoteNumber: merged.quoteNumber || merged.quote_no,
      status: merged.status || "draft",
      specs: {
        L_in: dimsNums.L,
        W_in: dimsNums.W,
        H_in: dimsNums.H,
        qty: specs.qty,
        density_pcf: densityPcf,
        foam_family: specs.material,
        thickness_under_in: merged.thickness_under_in,
        color: merged.color,
      },
      material: {
        name: merged.material_name,
        density_lbft3: densityPcf,
        kerf_pct: merged.kerf_pct,
        min_charge: merged.min_charge,
      },
      pricing: {
        total: calc?.price_total ?? calc?.total ?? 0,
        piece_ci: calc?.piece_ci,
        order_ci: calc?.order_ci,
        order_ci_with_waste: calc?.order_ci_with_waste,
        used_min_charge: calc?.min_charge_applied,
        raw: calc,
        price_breaks: priceBreaks || undefined,
      },
      missing: (() => {
        const miss: string[] = [];
        if (!merged.dims) miss.push("Dimensions");
        if (!merged.qty) miss.push("Quantity");
        if (!merged.material) miss.push("Material");
        if (!merged.density) miss.push("Density");
        if (
          merged.cavityCount > 0 &&
          (!merged.cavityDims || merged.cavityDims.length === 0)
        ) {
          miss.push("Cavity sizes");
        }
        return miss;
      })(),
      facts: merged,
    };

    let htmlBody = "";
    try {
      htmlBody = renderQuoteEmail(templateInput);
    } catch {
      htmlBody = `<p>${opener}</p>`;
    }

    const toEmail = p.toEmail || merged.email || merged.customerEmail;
    if (!toEmail) {
      return ok({
        dryRun: true,
        reason: "missing_toEmail",
        htmlPreview: htmlBody,
        specs,
        calc,
        facts: merged,
      });
    }

    const inReplyTo = merged.__lastInternetMessageId || undefined;

    if (dryRun) {
      return ok({
        mode: "dryrun",
        htmlPreview: htmlBody,
        specs,
        calc,
        facts: merged,
      });
    }

    const sendUrl = `${base}/api/msgraph/send`;

    const r = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toEmail,
        subject: subject || "Foam quote",
        html: htmlBody,
        inReplyTo,
      }),
    });

    const sent = await r.json().catch(() => ({} as any));

    if (threadKey && (sent.messageId || sent.internetMessageId)) {
      merged.__lastGraphMessageId =
        sent.messageId || merged.__lastGraphMessageId;
      merged.__lastInternetMessageId =
        sent.internetMessageId || merged.__lastInternetMessageId;
      await saveFacts(threadKey, merged);
      if (merged.quote_no) await saveFacts(merged.quote_no, merged);
    }

    return ok({
      sent: true,
      toEmail,
      messageId: sent.messageId,
      internetMessageId: sent.internetMessageId,
      specs,
      calc,
      facts: merged,
    });
  } catch (e: any) {
    return err("orchestrate_exception", String(e?.message || e));
  }
}
