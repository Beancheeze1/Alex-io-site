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
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    out[k] = v;
  }
  return out as T;
}

/* ===================== Memory helpers ===================== */

/* ===================== Memory helpers ===================== */

async function loadMem(key: string): Promise<Mem> {
  const facts = await loadFacts(key);
  return facts || {};
}
async function saveMem(key: string, mem: Mem) {
  await saveFacts(key, mem);
}


/* ===================== Parsing helpers (expanded) ===================== */

function normDims(s: string) {
  return s.replace(/\s+/g, "").replace(/×/g, "x").replace(/"+$/, "").toLowerCase();
}

// number that supports .5, 0.5, 5, 10.25, etc.
const NUM = "\\d*\\.?\\d+";

/**
 * Grab 3-D dims from free text.
 * Handles:
 *  - 12x12x3
 *  - 12 x 12 x 3
 *  - 12"x12"x3"
 *  - 1x1x.5 / .5x.5x.5
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
    new RegExp(
      `(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:(?:\\s*(?:in|inch|"))\\b)?`,
      "i",
    ),
  );
  if (!m) return undefined;
  const [L, W, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!L || !W || !H) return undefined;
  return `${L}x${W}x${H}`;
}

function grabQty(t: string) {
  const norm = t.toLowerCase();

  // “Qty 250”, “QTY: 250 pcs”
  let m =
    norm.match(/\bqty\s*[:\-]?\s*(\d{1,6})\b/) ||
    norm.match(/\bquantity\s*[:\-]?\s*(\d{1,6})\b/);
  if (m) return Number(m[1]);

  // “250 pcs”, “250 pieces”
  m = norm.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|parts?)\b/);
  if (m) return Number(m[1]);

  // “250 of these”
  m = norm.match(/\b(\d{1,6})\s+of\b/);
  if (m) return Number(m[1]);

  // Fallback: “for 250 pieces”, “for 250”
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

function grabCavityCount(t: string) {
  const lower = t.toLowerCase();
  let m = lower.match(/\b(\d{1,4})\s*(?:cavities|cavity|pockets?|cut[- ]?outs?)\b/);
  if (m) return Number(m[1]);

  for (const [word, num] of Object.entries(WORD_NUM)) {
    if (lower.includes(`${word} cavity`) || lower.includes(`${word} cavities`)) {
      return num;
    }
  }
  return undefined;
}

/**
 * Quick “free text” extractor.
 * Looks across body/subject for dims, qty, density, material, cutouts.
 */
function extractFreeText(text: string): Mem {
  if (!text) return {};
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out: Mem = {};

  for (const line of lines) {
    const t = line.toLowerCase();

    // Dims
    const dims = grabDims(line);
    if (dims) {
      out.dims = normDims(dims);
    }

    // Qty
    const qty = grabQty(line);
    if (qty && !out.qty) out.qty = qty;

    // Density
    const density = grabDensity(line);
    if (density && !out.density) out.density = density;

    // Material
    const mat = grabMaterial(t);
    if (mat && !out.material) out.material = mat;

    // Cavity count
    const cavCount = grabCavityCount(line);
    if (cavCount && !out.cavityCount) out.cavityCount = cavCount;
  }

  return out;
}

/**
 * Lines like:
 *  - Outside: 12x12x3
 *  - Qty: 250
 *  - Density: 1.7 lb
 *  - Material: EPE
 *  - Cavities: 2
 *  - Cavity dims: 3x3x1, Ø6x1
 */
function extractLabeledLines(text: string): Mem {
  if (!text) return {};
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out: Mem = {};

  for (const line of lines) {
    const t = line.toLowerCase();

    // Outside dims
    let m =
      t.match(/^outside(?:\s*size)?\s*[:\-]\s*(.+)$/i) ||
      t.match(/^inside(?:\s*size)?\s*[:\-]\s*(.+)$/i) ||
      t.match(/^block\s*size\s*[:\-]\s*(.+)$/i);
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

    m = t.match(new RegExp(`^density\\s*[:\\-]\\s*(${NUM})(?:\\s*(?:lb|lbs|#|pcf))?\\b`));
    if (m) {
      out.density = `${m[1]}lb`;
      continue;
    }

    m = t.match(/^(?:cavities|cavity|pockets?|cut[- ]?outs?)\s*[:\-]\s*(\d{1,4})\b/);
    if (m) {
      out.cavityCount = Number(m[1]);
      continue;
    }

    // Cavity dims, maybe comma-separated
    if (/^cavity\s*(?:dims|sizes)?\s*[:\-]/.test(t)) {
      const rest = line.split(/[:\-]/, 2)[1] || "";
      const parts = rest
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const dimsList: string[] = [];
      for (const part of parts) {
        const d = grabDims(part);
        if (d) {
          dimsList.push(normDims(d));
          continue;
        }
        const diaDepth = part.match(
          new RegExp(
            `(${NUM})\\s*(?:in|inch|")?\\s*(?:diameter|dia)\\b[^0-9]{0,12}(${NUM})\\s*(?:in|inch|")?\\s*(?:deep|depth)\\b`,
            "i",
          ),
        );
        if (diaDepth) {
          dimsList.push(`Ø${diaDepth[1]}x${diaDepth[2]}`);
        }
      }
      if (dimsList.length) out.cavityDims = dimsList;
    }
  }

  return out;
}

/**
 * Merge two fact maps, preferring `b` (later) when both have a value.
 */
function mergeFacts(a: Mem, b: Mem): Mem {
  const out: Mem = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Attempt to extract more cavity details from looser free text.
 */
function enrichCavitiesFromLooseText(facts: Mem, text: string): Mem {
  const lower = text.toLowerCase();
  const out = { ...facts };

  // Round cavities like “2 round cavities at Ø6x1”
  const roundCav = lower.match(
    new RegExp(
      `\\b(?:round\\s+)?cavities?\\b[^0-9]{0,20}(${NUM})\\s*(?:in|inch|")?\\s*(?:diameter|dia)\\b[^0-9]{0,12}(${NUM})\\s*(?:in|inch|")?\\s*(?:deep|depth)\\b`,
      "i",
    ),
  );
  if (roundCav) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${roundCav[1]}x${roundCav[2]}`);
    out.cavityDims = list;
  }

  const cavDiaDepth = lower.match(
    new RegExp(
      `(${NUM})\\s*(?:in|inch|")?\\s*(?:diameter|dia)\\b[^0-9]{0,12}(${NUM})\\s*(?:in|inch|")?\\s*(?:deep|depth)\\b`,
      "i",
    ),
  );
  if (cavDiaDepth) {
    const list = (out.cavityDims as string[] | undefined) || [];
    list.push(`Ø${cavDiaDepth[1]}x${cavDiaDepth[2]}`);
    out.cavityDims = list;
  }

  return compact(out);
}

function extractFromSubject(s = ""): Mem {
  if (!s) return {};
  return extractFreeText(s);
}

/* ===================== Human Q&A rendering ===================== */

const HUMAN_QA_LINES = [
  "Here’s what I have so far:",
  "- Outside size (L×W×H)",
  "- Quantity to price",
  "- Foam family + density",
  "- Number of cavities / pockets",
  "- Breaking out quantities for price breaks",
  "",
  "Write ONE natural sentence acknowledging the message and saying you'll price it once specs are confirmed.",
];

function buildQuestionsFromMissing(missing: string[]): string {
  if (!missing.length) return "";
  const bullets = missing.map((m) => `- ${m}`).join("\n");
  return `To finalize your quote, I still need:\n${bullets}`;
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

  const j = (await r.json().catch(() => ({} as any))) as any;
  if (!r.ok || !j?.ok) return null;
  return j?.result || null;
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

/* ===================== LLM helper (for opener line) ===================== */

async function callLLMForOpener(input: {
  customer_text: string;
  specs_summary: string;
  questions_block: string;
}) {
  const apiBase = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You help write short, natural email sentences for a foam packaging estimator bot. ONE sentence only.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Customer wrote:",
                input.customer_text,
                "",
                "Specs we think we see:",
                input.specs_summary,
                "",
                "Questions we still have:",
                input.questions_block || "(none)",
                "",
                "Write ONE friendly sentence that acknowledges what they sent and says you'll price it once any missing specs are confirmed.",
              ].join("\n"),
            },
          ],
        },
      ],
      max_tokens: 80,
      temperature: 0.3,
    };

    const r = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
    const lastText = String(p.text || "").trim();
    const subject = String(p.subject || "");
    const toEmail = String(p.toEmail || "");

    if (!toEmail || !lastText) {
      return err("Missing toEmail or text");
    }

    // Parse + extract specs
    const baseFacts = extractAllFromTextAndSubject(lastText, subject);
    let specs = await enrichFromDB(baseFacts);

    // Extra cavity enrichment pass
    specs = enrichCavitiesFromLooseText(specs, lastText);

    // Build human-facing “missing” questions summary
    const missing: string[] = [];
    if (!specs.dims) missing.push("Outside size (inside cavity if needed)");
    if (!specs.qty) missing.push("Quantity to price");
    if (!specs.material) missing.push("Foam family (PE / EPE / PU, etc.)");
    if (!specs.density) missing.push("Density (e.g. 1.7 lb)");
    if (!specs.cavityCount && !specs.cavityDims) {
      missing.push("Number of cavities / pockets and their sizes");
    }

    const questions = buildQuestionsFromMissing(missing);

    // Load/merge memory (thread-based)
    const memKey = `thread:${p.threadId || "default"}`;
    const prevMem = await loadMem(memKey);
    const mergedSpecs = mergeFacts(prevMem.specs || {}, specs);

    // Save updated memory
    await saveMem(memKey, { ...prevMem, specs: mergedSpecs });

    specs = mergedSpecs;

    // Short “opener” text from LLM (hybrid strategy)
    let openerLLM =
      await callLLMForOpener({
        customer_text: lastText.slice(0, 1200),
        specs_summary: JSON.stringify(specs, null, 2),
        questions_block: questions,
      });

    if (!openerLLM) {
      // Fall back to a deterministic sentence if LLM call fails
      openerLLM =
        "Thanks for the details — I’ll use these specs to build your quote and confirm anything that’s missing.";
    }

    // Human readable questions block for plain-text body
    let textBody = openerLLM;
    if (questions) {
      textBody += `\n\n${questions}`;
    }

    /* ========= If specs complete, call /api/quotes/calc to get pricing ========= */
    let calc: any = null;
    let calcRaw: number | null = null;
    let calcMinCharge: number | null =
      typeof specs.min_charge === "number" ? specs.min_charge : null;
    let calcTotal: number | null = null;
    let calcUsedMinCharge = false;

    if (
      specsCompleteForQuote({
        dims: specs.dims,
        qty: specs.qty,
        material_id: specs.material_id,
      })
    ) {
      try {
        calc = await fetchCalcQuote({
          dims: specs.dims as string,
          qty: Number(specs.qty),
          material_id: Number(specs.material_id),
          cavities: specs.cavityDims || [],
          round_to_bf: false,
        });

        if (calc) {
          const rawTotal =
            typeof calc.raw === "number"
              ? calc.raw
              : typeof calc.price_raw === "number"
              ? calc.price_raw
              : null;

          const baseTotal =
            typeof calc.total === "number"
              ? calc.total
              : typeof calc.price_total === "number"
              ? calc.price_total
              : typeof calc.prelim_total === "number"
              ? calc.prelim_total
              : null;

          const minChargeFromCalc =
            typeof calc.min_charge === "number" ? calc.min_charge : calcMinCharge;

          let finalTotal = baseTotal;
          let usedMinFlag = !!(calc.used_min_charge || calc.min_charge_applied);

          // If the calc result didn't already bake in min charge, compute a safe fallback
          if (finalTotal == null && (rawTotal != null || minChargeFromCalc != null)) {
            if (rawTotal != null && minChargeFromCalc != null) {
              finalTotal = Math.max(rawTotal, minChargeFromCalc);
              usedMinFlag = finalTotal === minChargeFromCalc;
            } else if (rawTotal != null) {
              finalTotal = rawTotal;
            } else {
              finalTotal = minChargeFromCalc!;
              usedMinFlag = true;
            }
          }

          calcRaw = rawTotal;
          calcMinCharge = minChargeFromCalc ?? calcMinCharge;
          calcTotal = finalTotal;
          calcUsedMinCharge = usedMinFlag;

          const previewTotal = finalTotal ?? baseTotal;
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
        name:
          specs.material_name ||
          (specs.material ? String(specs.material).toUpperCase() : null),
        density_lbft3: densityPcf,
        kerf_pct: kerfPct || 0,
        price_per_ci: calc?.price_per_ci ?? null,
        price_per_bf: calc?.price_per_bf ?? null,
        min_charge: calcMinCharge,
      },
      pricing: {
        piece_ci: calc?.piece_ci ?? piece_ci_fallback,
        order_ci: calc?.order_ci ?? order_ci_fallback,
        order_ci_with_waste: calc?.order_ci_with_waste ?? order_ci_waste_fallback,
        raw: calcRaw ?? (calc?.raw ?? calc?.price_raw ?? null),
        total: calcTotal ?? (calc?.total ?? calc?.price_total ?? 0),
        used_min_charge:
          calcUsedMinCharge || !!(calc?.used_min_charge || calc?.min_charge_applied),
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
      const cavCount = specs.cavityCount || (specs.cavityDims && specs.cavityDims.length);
      if (cavCount) {
        const cavLines: string[] = [];
        if (specs.cavityCount) cavLines.push(`Count: ${specs.cavityCount}`);
        if (specs.cavityDims && specs.cavityDims.length) {
          cavLines.push(`Sizes: ${specs.cavityDims.join(", ")}`);
        }
        htmlBody += `
          <h3 style="margin:18px 0 8px 0">Cutouts / Cavities</h3>
          <p style="margin:0 0 8px 0">${cavLines.join("<br/>")}</p>
        `;
      }
    } catch (e: any) {
      console.error("renderQuoteEmail error", e);
    }

    if (dryRun) {
      return ok({
        mode: "dryRun",
        toEmail,
        subject,
        textBody,
        templateInput,
        htmlBody,
        calc,
      });
    }

    // At this point, msgraph/send is responsible for actually sending
    return ok({
      mode: "ai",
      toEmail,
      subject,
      textBody,
      htmlBody,
      templateInput,
      calc,
    });
  } catch (e: any) {
    console.error("AI orchestrate error", e);
    return err("orchestrate_failed", { message: String(e?.message || e) });
  }
}
