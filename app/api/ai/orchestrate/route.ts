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
// - NEW 11/27: Pricing calc now ignores cavity volume
// - HARDENING 12/13: grade-first matching
// - HARDENING 12/14: layer intent facts
// - HARDENING 12/17: layer_count authoritative, full layer_thicknesses numeric array
//
// FIX 12/19 (THIS PATCH):
// 1) Remove duplicated needsLLM block (was merging LLM twice and overwriting layers).
// 2) If inbound mentions layers, wipe layer fields ONLY from loaded memory (thread/quote)
//    BEFORE merging newly, so we never delete the inbound-parsed thicknesses.
// 3) Keep regex-derived layer intent authoritative whenever LLM is invoked.
//
// FIX 12/19 (ALIAS PATCH - TOP/MIDDLE/BOTTOM):
// Normalize "top/middle/bottom layer|pad" into numeric "layer N" text *before* regex runs,
// so "top layer" always binds to layer 3 (or layer_count) and never falls back to 1".
//
// FIX 12/19 (DRYRUN INPUT SHAPE):
// Accept "body" as an alias for "text" so PowerShell dryRun payloads work.
// (No behavior change for real inbound calls; this only broadens accepted input.)
//
// FIX 12/19 (CIRCLE CAVITIES - THIS PATCH):
// - Extract Ø/DIA/diameter circle cavities (ØD x depth)
// - Preserve them through cavity normalization (was dropping anything not LxWxH)
//
// FIX 12/21 (THIS PATCH):
// - REMOVE the legacy "2-number cavity => DxDxDepth=1" coercion.
//   That fallback was accidentally reintroduced and would create bogus cavities
//   (e.g., it would split 3-number cavities into multiple 2-number matches),
//   which then poisoned downstream layout seeding and pricing expectations.
//   Circle cavities are handled explicitly as ØDxDepth.

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

  // Primary inbound email text field:
  text?: string;

  // Alias used by many dryRun payloads / older callers:
  body?: string;

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

function pickThreadContext(threadMsgs: any[] = []) {
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

// Allow "1", "1.5" and also ".5" style numbers
// IMPORTANT: used by multiple helpers (dims, cavities, layers) so define it early.
// NOTE: Use [0-9] instead of \d to avoid Unicode backslash paste issues breaking regex matching at runtime.
const NUM = "(?:[0-9]{1,4}(?:\\.[0-9]+)?|\\.[0-9]+)";

// Detect Q-AI-* style quote numbers in subject/body so we can
// pull sketch facts that were stored under quote_no.
function extractQuoteNo(text: string): string | null {
  if (!text) return null;
  const m = text.match(/Q-[A-Z]+-\d{8}-\d{6}/i);
  return m ? m[0] : null;
}

// Detect sales rep slug from subject and/or body.
function extractRepSlugFromSubject(subject: string, body?: string): string | null {
  const subj = subject || "";
  const txt = `${subject || ""}\n\n${body || ""}`;

  const mBracket = subj.match(/\[([a-z0-9_-]+)\]/i);
  if (mBracket) return mBracket[1].toLowerCase();

  const mRepLink = txt.match(/rep\s+link\s*:\s*([a-z0-9_-]+)/i);
  if (mRepLink) return mRepLink[1].toLowerCase();

  const mRepEq = txt.match(/rep\s*=\s*([a-z0-9_-]+)/i);
  if (mRepEq) return mRepEq[1].toLowerCase();

  return null;
}

function inferRepSlugFromThreadMsgs(threadMsgs: any[]): string | null {
  if (!Array.isArray(threadMsgs) || !threadMsgs.length) return null;

  const emailToSlug: Record<string, string> = {
    "sales@alex-io.com": "sales-demo",
    "25thhourdesign@gmail.com": "chuck",
    "viewer@alex-io.com": "viewer-demo",
  };

  for (let i = threadMsgs.length - 1; i >= 0; i--) {
    const m = threadMsgs[i];

    const tos = m?.to;
    if (Array.isArray(tos)) {
      for (const t of tos) {
        const addr = String(t?.email || t || "").toLowerCase();
        if (emailToSlug[addr]) return emailToSlug[addr];
      }
    }

    const mailbox = m?.mailbox || m?.toEmail;
    if (mailbox) {
      const addr = String(mailbox).toLowerCase();
      if (emailToSlug[addr]) return emailToSlug[addr];
    }
  }

  return null;
}

/**
 * Build a canonical layout editor URL that NEVER relies on JS array-to-string
 * (comma-join) behavior. We emit repeated params for thicknesses & cavities:
 *   layer_thicknesses=1&layer_thicknesses=3&layer_thicknesses=0.5
 *   cavity=2x1x0.5&cavity=5x4x1&cavity=3x3x1
 *
 * Path-A: we only add this URL into facts; the template can use it directly.
 */
function buildLayoutEditorUrlFromFacts(f: Mem): string | null {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const url = new URL("/quote/layout", base);

    const quoteNo = String(f.quoteNumber || f.quote_no || "").trim();
    if (quoteNo) url.searchParams.set("quote_no", quoteNo);

    // dims (outside block dims) if present
    if (f.dims) url.searchParams.set("dims", String(f.dims));

    // layer_count authoritative if present
    const n = Number(f.layer_count);
    if (Number.isFinite(n) && n > 0) {
      url.searchParams.set("layer_count", String(n));
    }

    // Repeated thickness params (critical)
    const thRaw = f.layer_thicknesses;
    const thArr: any[] = Array.isArray(thRaw) ? thRaw : [];

    for (const v of thArr) {
      const num = Number(v);
      if (!Number.isFinite(num) || num <= 0) continue;
      // Keep 0.5 canonical as "0.5" (not ".5")
      url.searchParams.append("layer_thicknesses", num.toString());
    }

    // Repeated cavities params (critical)
    const cavArr: any[] = Array.isArray(f.cavityDims) ? f.cavityDims : [];
    for (const c of cavArr) {
      const s = String(c || "").trim();
      if (!s) continue;
      url.searchParams.append("cavity", s);
    }

    // If we know which layer has cavities (1-based), include it
    if (f.layer_cavity_layer_index != null) {
      const idx = Number(f.layer_cavity_layer_index);
      if (Number.isFinite(idx) && idx >= 1) {
        url.searchParams.set("layer_cavity_layer_index", String(idx));
      }
    }

    // Repeated numeric layer labels (repeated).
    // IMPORTANT: The layout editor seeds multi-layer stacks primarily from layer_label.
    // So we ALWAYS emit numeric labels when layer_count is known (>1), even if the
    // layers array is absent (dry-run / early-stage flows).
    //
    // Canonical format: "Layer 1", "Layer 2", ...
    const labels: string[] = [];
    if (Array.isArray(f.layers) && f.layers.length) {
      for (const L of f.layers) {
        const lab = String((L as any)?.label || "").trim();
        if (!lab) continue;
        if (/^layer\s+\d+$/i.test(lab)) labels.push(lab);
      }
    }

    if (labels.length) {
      for (const lab of labels) url.searchParams.append("layer_label", lab);
    } else if (Number.isFinite(n) && n > 1) {
      for (let i = 1; i <= n; i++) url.searchParams.append("layer_label", `Layer ${i}`);
    }

    return url.toString();
  } catch {
    return null;
  }
}

/* ============================================================
   Cavity normalization
   ============================================================ */

function normalizeCavity(raw: string): string {
  if (!raw) return "";
  let s = raw.trim();

  s = s.replace(/\bdia\b/gi, "Ø").replace(/diameter/gi, "Ø");
  s = s.replace(/"/g, "").replace(/\s+/g, " ").trim();

  const mCircle = s.match(/Ø\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (mCircle) {
    return `Ø${mCircle[1]}x${mCircle[2]}`;
  }

  const rect = s
    .toLowerCase()
    .replace(/×/g, "x")
    .replace(/[^0-9.xØ]/g, "")
    .replace(/x+/g, "x");
  return rect || raw.trim();
}

function canonNumStr(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toString();
}

/**
 * Step 1 fix:
 * - Parse ALL valid cavity dims first (3-number LxWxH) AND circle dims (ØDxDepth)
 * - De-dupe conservatively (exact same dims only), preserve order
 * - Only duplicate if still fewer than cavityCount
 * - Canonicalize decimals so ".5" => "0.5"
 *
 * HARDENING: Only duplicate when there is EXACTLY ONE distinct cavity size.
 */
function applyCavityNormalization(facts: Mem): Mem {
  if (!facts) return facts;
  if (!Array.isArray(facts.cavityDims)) return facts;

  const originalCount =
    typeof facts.cavityCount === "number" && facts.cavityCount > 0
      ? facts.cavityCount
      : undefined;

  const seen = new Set<string>();
  const distinct: string[] = [];

  for (const raw of facts.cavityDims as string[]) {
    if (!raw) continue;

    const norm = normalizeCavity(String(raw));

    // Circle: ØD x depth  (e.g., Ø3x1, Ø2.5x0.5)
    const mc = norm.match(new RegExp(`^Ø\\s*(${NUM})\\s*[x×]\\s*(${NUM})$`, "i"));
    if (mc) {
      const D = canonNumStr(mc[1]);
      const Z = canonNumStr(mc[2]);
      const key = `Ø${D}|${Z}`;
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(`Ø${D}x${Z}`);
      }
      continue;
    }

    // Rectangle: L x W x H
    const mr = norm
      .toLowerCase()
      .replace(/"/g, "")
      .match(new RegExp(`^(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})$`, "i"));

    if (mr) {
      const L = canonNumStr(mr[1]);
      const W = canonNumStr(mr[2]);
      const H = canonNumStr(mr[3]);

      const key = `${L}|${W}|${H}`;
      if (!seen.has(key)) {
        seen.add(key);
        distinct.push(`${L}x${W}x${H}`);
      }
      continue;
    }
  }

  if (!distinct.length) {
    delete (facts as any).cavityDims;
    delete (facts as any).cavityCount;
    return facts;
  }

  let targetCount = distinct.length;

  if (originalCount && originalCount > targetCount) {
    // Preserve prior behavior: only duplicate when there is exactly one distinct cavity size.
    if (distinct.length === 1) {
      targetCount = originalCount;
    } else {
      targetCount = distinct.length;
    }
  }

  const finalDims: string[] = [...distinct];
  while (finalDims.length < targetCount) {
    finalDims.push(distinct[finalDims.length % distinct.length]);
  }

  (facts as any).cavityDims = finalDims;
  (facts as any).cavityCount = targetCount;

  return facts;
}

/* ============================================================
   DB enrichment (material)
   ============================================================ */

async function enrichFromDB(f: Mem): Promise<Mem> {
  try {
    if (!f.material) return f;

    const materialToken = String(f.material).toLowerCase().trim();

    const materialGradeRaw = String((f as any).material_grade || "").trim();
    const hasGrade = !!materialGradeRaw && /^\d{3,5}$/.test(materialGradeRaw);
    const gradeLike = hasGrade ? `%${materialGradeRaw}%` : null;

    const like = `%${materialToken}%`;
    const densNum = Number((f.density || "").match(/(\d+(\.\d+)?)/)?.[1] || 0);

    let familyFilter = "";

    const hasEpe =
      materialToken.includes("expanded polyethylene") || /\bepe\b/.test(materialToken);

    const hasPe =
      /\bpe\b/.test(materialToken) ||
      materialToken.includes("pe foam") ||
      materialToken.includes("polyethylene");

    const hasPolyurethane =
      materialToken.includes("polyurethane") ||
      /\bpu\b/.test(materialToken) ||
      /\burethane\b/.test(materialToken);

    const hasPolystyrene =
      materialToken.includes("polystyrene") || /\beps\b/.test(materialToken);

    if (hasEpe) {
      familyFilter = "AND material_family = 'Expanded Polyethylene'";
    } else if (hasPe) {
      familyFilter = "AND material_family = 'Polyethylene'";
    } else if (hasPolyurethane) {
      familyFilter = "AND material_family ILIKE 'Polyurethane%'";
    } else if (hasPolystyrene) {
      familyFilter = "AND material_family ILIKE 'Polystyrene%'";
    }

    const wantsEster = /\bester\b/.test(materialToken);
    const wantsEther = /\bether\b/.test(materialToken);
    const wantsChar = /\bchar\b/.test(materialToken) || materialToken.includes("charcoal");

    let row: any = null;

    if (hasGrade && hasPolyurethane && gradeLike) {
      row = await one<any>(
        `
        SELECT
          id,
          name,
          material_family,
          category,
          subcategory,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,
          min_charge_usd AS min_charge
        FROM materials
        WHERE is_active = true
          ${familyFilter}
          AND (
            name ILIKE $1
            OR category ILIKE $1
            OR subcategory ILIKE $1
          )
        ORDER BY
          CASE
            WHEN $2::boolean = true AND (name ILIKE '%ester%' OR category ILIKE '%ester%' OR subcategory ILIKE '%ester%') THEN 0
            WHEN $3::boolean = true AND (name ILIKE '%ether%' OR category ILIKE '%ether%' OR subcategory ILIKE '%ether%') THEN 0
            WHEN $4::boolean = true AND (name ILIKE '%char%'  OR category ILIKE '%char%'  OR subcategory ILIKE '%char%')  THEN 0
            ELSE 5
          END,
          CASE
            WHEN $2::boolean = false AND (name ILIKE '%ester%' OR category ILIKE '%ester%' OR subcategory ILIKE '%ester%') THEN 50
            ELSE 0
          END,
          CASE
            WHEN $4::boolean = false AND (name ILIKE '%char%' OR category ILIKE '%char%' OR subcategory ILIKE '%char%') THEN 10
            ELSE 0
          END,
          ABS(COALESCE(density_lb_ft3, 0) - $5)
        LIMIT 1;
        `,
        [gradeLike, wantsEster, wantsEther, wantsChar, densNum],
      );
    }

    if (!row) {
      row = await one<any>(
        `
        SELECT
          id,
          name,
          material_family,
          category,
          subcategory,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,
          min_charge_usd AS min_charge
        FROM materials
        WHERE is_active = true
          ${familyFilter}
          AND (
            name ILIKE $1
            OR material_family ILIKE $1
            OR category ILIKE $1
            OR subcategory ILIKE $1
          )
        ORDER BY ABS(COALESCE(density_lb_ft3, 0) - $2)
        LIMIT 1;
        `,
        [like, densNum],
      );
    }

    if (!row) {
      row = await one<any>(
        `
        SELECT
          id,
          name,
          material_family,
          category,
          subcategory,
          density_lb_ft3,
          kerf_waste_pct AS kerf_pct,
          min_charge_usd AS min_charge
        FROM materials
        WHERE is_active = true
          ${familyFilter}
        ORDER BY ABS(COALESCE(density_lb_ft3, 0) - $1)
        LIMIT 1;
        `,
        [densNum],
      );
    }

    if (!row) return f;

    f.material_id = row.id;
    f.material_name = row.name;
    if (!f.material_family) f.material_family = row.material_family;
    if (!f.density && row.density_lb_ft3 != null) f.density = `${row.density_lb_ft3}lb`;
    if (f.kerf_pct == null && row.kerf_pct != null) f.kerf_pct = row.kerf_pct;
    if (f.min_charge == null && row.min_charge != null) f.min_charge = row.min_charge;

    return f;
  } catch {
    return f;
  }
}

/* ============================================================
   hydrateFromDBByQuoteNo
   ============================================================ */

async function hydrateFromDBByQuoteNo(
  f: Mem,
  opts: { lockQty?: boolean; lockCavities?: boolean; lockDims?: boolean } = {},
): Promise<Mem> {
  const out: Mem = { ...(f || {}) };
  const quoteNo: string | undefined = out.quote_no || out.quoteNumber;
  if (!quoteNo) return out;

  try {
    const primaryItem = await one<any>(
      `
      select qi.qty, qi.length_in, qi.width_in, qi.height_in
      from quote_items qi
      join quotes q on qi.quote_id = q.id
      where q.quote_no = $1
      order by qi.id asc
      limit 1;
      `,
      [quoteNo],
    );

    if (primaryItem) {
      if (!opts.lockQty && Number(primaryItem.qty) > 0) {
        out.qty = Number(primaryItem.qty);
      }

      if (!opts.lockDims && !out.dims) {
        const L = Number(primaryItem.length_in) || 0;
        const W = Number(primaryItem.width_in) || 0;
        const H = Number(primaryItem.height_in) || 0;
        if (L && W && H) out.dims = `${L}x${W}x${H}`;
      }
    }

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

      if (layoutPkg?.layout_json && !out.cavityDims) {
        const layout = layoutPkg.layout_json;
        if (Array.isArray(layout?.cavities)) {
          const cavs = layout.cavities
            .map((c: any) =>
              c.lengthIn && c.widthIn && c.depthIn
                ? `${c.lengthIn}x${c.widthIn}x${c.depthIn}`
                : null,
            )
            .filter(Boolean);
          if (cavs.length) {
            out.cavityDims = cavs;
            out.cavityCount = cavs.length;
          }
        }
      }
    }

    return out;
  } catch {
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

function specsCompleteForQuote(s: { dims: string | null; qty: number | string | null; material_id: number | null }) {
  return !!(s.dims && s.qty && s.material_id);
}

/* ============================================================
   Quote calc via internal API
   ============================================================ */

async function fetchCalcQuote(opts: { dims: string; qty: number; material_id: number; round_to_bf: boolean }) {
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
      cavities: [],
      round_to_bf: opts.round_to_bf,
    }),
  });

  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || !j.ok) return null;
  return j.result;
}

/* ============================================================
   Dynamic price breaks
   ============================================================ */

type PriceBreak = {
  qty: number;
  total: number;
  piece: number | null;
  used_min_charge?: boolean | null;
  _attach?: never;
};

async function buildPriceBreaks(
  baseOpts: { dims: string; qty: number; material_id: number; round_to_bf: boolean },
  baseCalc: any,
): Promise<PriceBreak[] | null> {
  const baseQty = baseOpts.qty;
  if (!baseQty || baseQty <= 0) return null;

  const ladder = Array.from(
    new Set([1, 10, 25, 50, 100, 150, 250, baseQty].map((q) => Math.round(q)).filter((q) => q > 0)),
  ).sort((a, b) => a - b);

  const out: PriceBreak[] = [];

  for (const q of ladder) {
    let calcForQ = baseCalc;

    if (q !== baseQty) {
      calcForQ = await fetchCalcQuote({ ...baseOpts, qty: q });
      if (!calcForQ) continue;
    } else if (!calcForQ) {
      continue;
    }

    const total = (calcForQ.price_total ?? calcForQ.total ?? calcForQ.order_total ?? 0) as number | 0;
    const piece = total && q > 0 ? total / q : null;

    out.push({
      qty: q,
      total,
      piece,
      used_min_charge: (calcForQ.min_charge_applied ?? null) as boolean | null,
    });
  }

  return out.length ? out : null;
}

/* ============================================================
   Regex-based parsing helpers
   ============================================================ */

function grabDims(raw: string): string | undefined {
  const text = (raw || "").toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");

  const reMain = new RegExp(
    `\\b(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*(?:in|inch|inches))?\\b`,
    "gi",
  );

  let m: RegExpExecArray | null;
  while ((m = reMain.exec(text))) {
    const start = m.index || 0;
    const before = text.slice(Math.max(0, start - 25), start);

    // Ignore layer-by-layer dimension statements like:
    // "layer 1 is 12x10x1" / "layer2 12x10x2.5"
    if (/\blayer\s*\d{1,2}\b/.test(before) || /\bpad\s*\d{1,2}\b/.test(before)) {
      continue;
    }

    return `${m[1]}x${m[2]}x${m[3]}`;
  }

  const m2 = text.match(
    new RegExp(
      `\\b(?:size|dimensions?|dims?)\\s*[:\\-]?\\s*(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})\\b`,
      "i",
    ),
  );

  if (!m2) return undefined;
  return `${m2[1]}x${m2[2]}x${m2[3]}`;
}


function grabOutsideDims(raw: string): string | undefined {
  const text = raw.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ");
  const m = text.match(
    new RegExp(
      `\\b(?:overall|outside|block|foam)\\s+(?:size|dimensions?|dims?)` +
        `\\s*(?:of\\s+the\\s+[a-z]+\\s*)?(?:is|=|:)?\\s*` +
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
    t.match(/\b(\d{1,6})\s*(?:pcs?|pieces?|parts?|sets?)\b/);

  if (m) return Number(m[1]);

  const norm = t.replace(/(\d+(?:\.\d+)?)\s*"\s*(?=[x×])/g, "$1 ");
  m = norm.match(
    new RegExp(`\\b(\\d{1,6})\\s+(?:${NUM}\\s*[x×]\\s*${NUM}\\s*[x×]\\s*${NUM})(?:\\s*(?:pcs?|pieces?|sets?))?\\b`, "i"),
  );
  if (m) return Number(m[1]);

  m = norm.match(/\bfor\s+(\d{1,6})\s*(?:pcs?|pieces?|parts?|sets?)?\b/);
  if (m) return Number(m[1]);

  return undefined;
}

function grabDensity(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const m =
    t.match(/(\d+(\.\d+)?)\s*(?:pcf|lb\/?ft3?|pound(?:s)?\s*per\s*cubic\s*foot)/) ||
    t.match(/(\d+(\.\d+)?)\s*#\s*(?:foam)?\b/);
  if (!m) return undefined;
  return `${m[1]}#`;
}

function grabColor(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const m = t.match(/\b(black|white|gray|grey|blue|red|green|yellow|orange|tan|natural)\b/);
  if (!m) return undefined;
  return m[1];
}

function grabMaterialGrade(raw: string): string | undefined {
  const t = raw.toLowerCase();
  const hasPU = t.includes("polyurethane") || /\bpu\b/.test(t) || /\burethane\b/.test(t);
  if (!hasPU) return undefined;

  const m = t.match(/\b(1\d{3})\b/);
  if (!m) return undefined;
  return m[1];
}

function grabMaterial(raw: string): string | undefined {
  const t = raw.toLowerCase();

  if (/\bepe\b/.test(t) || /\bepe\s+foam\b/.test(t) || t.includes("expanded polyethylene")) return "epe";
  if (/\bxlpe\b/.test(t) || t.includes("cross-linked polyethylene") || t.includes("cross linked polyethylene") || t.includes("crosslinked polyethylene"))
    return "xlpe";
  if (t.includes("polyurethane") || /\bpu\b/.test(t) || /\burethane\b/.test(t) || t.includes("urethane foam")) return "polyurethane";
  if (/\bkaizen\b/.test(t)) return "kaizen";
  if (t.includes("polystyrene") || /\beps\b/.test(t)) return "eps";
  if (/\bpp\b/.test(t)) return "pp";
  if (t.includes("polyethylene") || t.includes("pe foam") || /\bpe\b/.test(t)) return "pe";

  return undefined;
}

/* ============================================================
   Step 2: Layer intent extraction helpers
   ============================================================ */

// Summary: "(3) 10x10 layers"
function grabLayerSummary(raw: string): { layer_count?: number; footprint?: string } {
  const t = (raw || "").toLowerCase();

  // Pattern A: "(3) 12x10 layers" (existing style)
  const reA = new RegExp(
    `\\b(?:made\\s+up\\s+of\\s+)?\\(?\\s*(\\d{1,2})\\s*\\)?\\s*` +
      `(${NUM})\\s*["']?\\s*[x×]\\s*(${NUM})\\s*["']?\\s*` +
      `(?:layers?|layer)\\b`,
    "i",
  );

  let m = t.match(reA);
  if (m) {
    const count = Number(m[1]);
    const L = canonNumStr(m[2]);
    const W = canonNumStr(m[3]);
    if (Number.isFinite(count) && count > 0) return { layer_count: count, footprint: `${L}x${W}` };
  }

  // Pattern B: "(3) layers, each 12x10"  (YOUR TEST EMAIL STYLE)
  const reB = new RegExp(
    `\\b(?:made\\s+up\\s+of\\s+)?\\(?\\s*(\\d{1,2})\\s*\\)?\\s*layers?\\b[^\\n\\r]{0,120}?` +
      `\\b(?:each|size|sized)\\b[^\\n\\r]{0,40}?` +
      `(${NUM})\\s*["']?\\s*[x×]\\s*(${NUM})\\s*["']?\\b`,
    "i",
  );

  m = t.match(reB);
  if (m) {
    const count = Number(m[1]);
    const L = canonNumStr(m[2]);
    const W = canonNumStr(m[3]);
    if (Number.isFinite(count) && count > 0) return { layer_count: count, footprint: `${L}x${W}` };
  }

  return {};
}


function grabLayerFootprintOnly(raw: string): { footprint?: string } {
  const t = (raw || "").toLowerCase();
  const re = new RegExp(`\\b(${NUM})\\s*["']?\\s*[x×]\\s*(${NUM})\\s*["']?\\s*(?:layers?|layer)\\b`, "i");
  const m = t.match(re);
  if (!m) return {};
  const L = canonNumStr(m[1]);
  const W = canonNumStr(m[2]);
  return { footprint: `${L}x${W}` };
}

/**
 * Normalize "top/middle/bottom layer|pad" into numeric "layer N" text before parsing.
 * This makes "top layer" always bind to layer_count (e.g., Layer 3) consistently.
 */
function normalizeLayerAliases(raw: string, n: number): string {
  if (!raw) return raw;
  if (!Number.isFinite(n) || n <= 0) return raw;

  const mid = Math.max(1, Math.min(n, Math.round((n + 1) / 2)));

  // Replace whole-word phrases only; preserve original punctuation around it.
  // We normalize both "layer" and "pad" phrasing.
  return raw
    .replace(/\b(bottom)\s+(layer|pad)\b/gi, `layer 1`)
    .replace(/\b(middle)\s+(layer|pad)\b/gi, `layer ${mid}`)
    .replace(/\b(top)\s+(layer|pad)\b/gi, `layer ${n}`);
}

/**
 * Extract per-layer thicknesses.
 * Layer 1 = bottom ... Layer N = top
 */
function grabLayerThicknessesCanonical(
  raw: string,
  layerCount: number | undefined,
): { thicknessesByLayer1Based: (number | null)[]; cavityLayerIndex1Based: number | null } {
  const n = Number.isFinite(layerCount as any) && (layerCount as number) > 0 ? (layerCount as number) : 0;

  // IMPORTANT: normalize aliases first so "top layer" becomes "layer N"
  const s0 = raw || "";
  const s = n ? normalizeLayerAliases(s0, n) : s0;

  const thicknesses: (number | null)[] = n ? Array.from({ length: n }, () => null) : [];
  let cavityIdx1: number | null = null;

  const setTh = (layer1: number, th: number) => {
    if (!n) return;
    if (layer1 < 1 || layer1 > n) return;
    if (!Number.isFinite(th) || th <= 0) return;
    thicknesses[layer1 - 1] = th;
  };

  // Keep this for backwards compatibility (still works if someone literally writes "top layer"),
  // but in practice the alias normalization above makes the numbered regex catch everything.
  const rePos = new RegExp(
    `\\b(top|middle|bottom)\\s+(?:layer|pad)\\b[^.\\n\\r]{0,160}?(${NUM})\\s*(?:"|inches?|inch)?\\s*(?:[^.\\n\\r]{0,60}?\\bthick\\b)?`,
    "gi",
  );

  let m: RegExpExecArray | null;
  while ((m = rePos.exec(s))) {
    const pos = String(m[1] || "").toLowerCase();
    const th = Number(m[2]);
    if (!Number.isFinite(th) || th <= 0) continue;

    if (n) {
      if (pos === "bottom") setTh(1, th);
      else if (pos === "top") setTh(n, th);
      else if (pos === "middle") {
        const mid = Math.max(1, Math.min(n, Math.round((n + 1) / 2)));
        setTh(mid, th);
      }
    }

    const windowText = s.slice(Math.max(0, m.index), Math.min(s.length, m.index + 220)).toLowerCase();
    if (/\b(cavity|cavities|pocket|pockets|cutout|cutouts)\b/.test(windowText) && n) {
      if (pos === "bottom") cavityIdx1 = 1;
      else if (pos === "top") cavityIdx1 = n;
      else if (pos === "middle") cavityIdx1 = Math.max(1, Math.min(n, Math.round((n + 1) / 2)));
    }
  }

    const reNum = new RegExp(
    `\\b(?:layer|pad)\\s*(\\d{1,2})\\b[^.\\n\\r]{0,160}?` +
      `\\b(?:thickness\\b[^.\\n\\r]{0,40}?|(?:will\\s+be|is|=|at)?\\s*)` +
      `(${NUM})\\s*(?:"|inches?|inch)?\\s*[^.\\n\\r]{0,80}?` +
      `\\b(?:thick|thickness)\\b?`,
    "gi",
  );


  while ((m = reNum.exec(s))) {
    const idx = Number(m[1]);
    const th = Number(m[2]);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    if (!Number.isFinite(th) || th <= 0) continue;
    if (n) setTh(idx, th);

    const windowText = s.slice(Math.max(0, m.index), Math.min(s.length, m.index + 220)).toLowerCase();
    if (/\b(cavity|cavities|pocket|pockets|cutout|cutouts)\b/.test(windowText) && n) {
      if (idx >= 1 && idx <= n) cavityIdx1 = idx;
    }
  }

  // ALSO support the common formatted-email pattern:
  // "Layer 1 (bottom):" newline "Thickness 1.00""
  const reLayerHeaderThickness = new RegExp(
    `\\blayer\\s*(\\d{1,2})\\b[^\\n\\r]{0,80}[:\\)]?\\s*[\\s\\S]{0,120}?\\bthickness\\b\\s*[:\\-]?\\s*(${NUM})\\s*(?:"|inches?|inch)?\\b`,
    "gi",
  );

  while ((m = reLayerHeaderThickness.exec(s))) {
    const idx = Number(m[1]);
    const th = Number(m[2]);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    if (!Number.isFinite(th) || th <= 0) continue;
    if (n) setTh(idx, th);

    const windowText = s.slice(Math.max(0, m.index), Math.min(s.length, m.index + 240)).toLowerCase();
    if (/\b(cavity|cavities|pocket|pockets|cutout|cutouts|through-?hole|hole)\b/.test(windowText) && n) {
      if (idx >= 1 && idx <= n) cavityIdx1 = idx;
    }
  }



  if (!cavityIdx1 && n) {
    const t = s.toLowerCase();
    const cavIdx = t.search(/\b(cavity|cavities|pocket|pockets|cutout|cutouts)\b/);
    if (cavIdx >= 0) {
      const windowText = t.slice(Math.max(0, cavIdx - 160), Math.min(t.length, cavIdx + 160));
      // Note: even here, the alias normalization means these phrases might be gone,
      // but we keep this fallback as-is.
      if (windowText.includes("middle layer") || windowText.includes("middle pad")) {
        cavityIdx1 = Math.max(1, Math.min(n, Math.round((n + 1) / 2)));
      } else if (windowText.includes("top layer") || windowText.includes("top pad")) {
        cavityIdx1 = n;
      } else if (windowText.includes("bottom layer") || windowText.includes("bottom pad")) {
        cavityIdx1 = 1;
      }
    }
  }

  return { thicknessesByLayer1Based: thicknesses, cavityLayerIndex1Based: cavityIdx1 };
}

/* ============================================================
   Cavity extraction + normalization
   ============================================================ */

function extractCavities(raw: string): { cavityCount?: number; cavityDims?: string[] } {
  const t = (raw || "").toLowerCase();
  const lines = (raw || "").split(/\r?\n/);

  const cavityDims: string[] = [];
  let cavityCount: number | undefined;

  const mCount =
    t.match(/\b(\d{1,3})\s*(?:cavities|cavity|pockets?|cutouts?)\b/) ||
    t.match(/\btotal\s+of\s+(\d{1,3})\s*(?:cavities|cavity|pockets?|cutouts?)\b/);
  if (mCount) cavityCount = Number(mCount[1]);

  for (const line of lines) {
    const lower = (line || "").toLowerCase();
    if (!/\b(cavity|cavities|cutout|pocket)\b/.test(lower)) continue;

    const lineNoQuotes = (line || "").replace(/"/g, " ");

    // Rectangular cavities: L x W x D (ONLY 3-number)
    const reTriple = new RegExp(`(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})`, "gi");
    let m: RegExpExecArray | null;
    while ((m = reTriple.exec(lineNoQuotes))) {
      cavityDims.push(`${m[1]}x${m[2]}x${m[3]}`);
    }

    // Circle cavities: ØD x depth  (supports "Ø3 x 1", "3 dia x 1", "3 diameter x 1")
    const norm = normalizeCavity(lineNoQuotes);
    const reCircle = new RegExp(`Ø\\s*(${NUM})\\s*[x×]\\s*(${NUM})`, "gi");
    while ((m = reCircle.exec(norm))) {
      cavityDims.push(`Ø${m[1]}x${m[2]}`);
    }
  }

  if (cavityDims.length) cavityCount = cavityDims.length;

  return { cavityCount, cavityDims: cavityDims.length ? cavityDims : undefined };
}

function recoverCavityDimsFromText(rawText: string, mainDims?: string | null): string[] {
  if (!rawText) return [];

  const text = rawText.toLowerCase().replace(/"/g, " ").replace(/\s+/g, " ");
  const mainNorm = (mainDims || "").toLowerCase().trim();

  // Rects: L x W x D
  const re = new RegExp(`\\b(${NUM})\\s*[x×]\\s*(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*(?:in|inch|inches))?\\b`, "gi");

  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    const dims = `${m[1]}x${m[2]}x${m[3]}`;
    const norm = dims.toLowerCase().trim();
    if (mainNorm && norm === mainNorm) continue;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(dims);
    }
  }

  // Circles: ØD x depth
  const normAll = normalizeCavity(rawText);
  const reCircle = new RegExp(`Ø\\s*(${NUM})\\s*[x×]\\s*(${NUM})`, "gi");
  while ((m = reCircle.exec(normAll))) {
    const dims = `Ø${m[1]}x${m[2]}`;
    const norm = dims.toLowerCase().trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(dims);
    }
  }

  return out;
}

/* ============================================================
   Initial fact extraction from subject + body
   ============================================================ */

function extractAllFromTextAndSubject(body: string, subject: string): Mem {
  const rawBody = body || "";
  const facts: Mem = {};
  const text = `${subject}\n\n${rawBody}`.replace(/[”“″]/g, '"');

  let outsideDimsWasExplicit = false;

  const outsideDims = grabOutsideDims(text);
  if (outsideDims) {
    facts.dims = normDims(outsideDims) || outsideDims;
    outsideDimsWasExplicit = true;
  } else {
    const bodyNoCavity = rawBody
      .split(/\r?\n/).filter((ln) => !/\b(cavity|cavities|pocket|pockets|cutout|cutouts)\b/i.test(ln))
      .join("\n");

    const dimsSource = `${subject}\n\n${bodyNoCavity}`;
    const dims = grabDims(dimsSource);
    if (dims && !facts.dims) facts.dims = normDims(dims) || dims;
  }

  const qtyVal = grabQty(text);
  if (qtyVal) facts.qty = qtyVal;

  const density = grabDensity(text);
  if (density) facts.density = density;

  const needsMaterial = grabMaterial(text);
  if (needsMaterial) facts.material = needsMaterial;

  const color = grabColor(text);
  if (color) facts.color = color;

  const grade = grabMaterialGrade(text);
  if (grade) (facts as any).material_grade = grade;

  const { cavityCount, cavityDims } = extractCavities(text);
  if (cavityCount != null) facts.cavityCount = cavityCount;
  if (cavityDims?.length) facts.cavityDims = cavityDims;

   if (facts.dims && (!facts.cavityDims || facts.cavityDims.length === 0)) {
    // Only "recover" cavity dims if the message actually mentions cavities/cutouts
    // (prevents layer-dim replies like "layer 1 is 12x10x1" from becoming fake cavities).
    const mentionsCavity =
      /\b(cavity|cavities|pocket|pockets|cutout|cutouts|through-?hole|hole)\b/i.test(text) ||
      /[Ø]/.test(text) ||
      /\b(dia|diameter)\b/i.test(text);

    if (mentionsCavity) {
      const recovered = recoverCavityDimsFromText(text, facts.dims);
      if (recovered.length > 0) {
        facts.cavityDims = recovered;
        facts.cavityCount = recovered.length;
      }
    }
  }


  const mMaterialPhrase = text.match(/\b(\d{3,5})\s+(black|white|gray|grey|blue|red|green|yellow|orange|tan|natural)\s+(polyurethane|urethane)\b/i);
  if (mMaterialPhrase) {
    facts.material = `${mMaterialPhrase[1]} ${mMaterialPhrase[2]} polyurethane`.toLowerCase();
    (facts as any).material_grade = mMaterialPhrase[1];
    facts.color = String(mMaterialPhrase[2]).toLowerCase();
  }

  const layerSummary = grabLayerSummary(text);
  const layerFootOnly = !layerSummary.footprint ? grabLayerFootprintOnly(text) : {};

  const layerCount = layerSummary.layer_count;
  const footprint = layerSummary.footprint || layerFootOnly.footprint;

  if (layerCount) facts.layer_count = layerCount;
  if (footprint) facts.layer_footprint = footprint;

  if (facts.layer_count) {
    const n = Number(facts.layer_count);
    if (Number.isFinite(n) && n > 0) {
      const th = grabLayerThicknessesCanonical(text, n);
      let thicknesses1 = th.thicknessesByLayer1Based.slice();

      const missingIdxs = thicknesses1.map((v, idx) => (v == null ? idx : -1)).filter((idx) => idx >= 0);

      const dimsNow = facts.dims ? String(facts.dims) : null;
      if (missingIdxs.length === 1 && dimsNow) {
        const { H } = parseDimsNums(dimsNow);
        const knownSum = thicknesses1
          .map((v) => (v == null ? 0 : Number(v)))
          .filter((x) => Number.isFinite(x) && x > 0)
          .reduce((a, b) => a + b, 0);

        const inferred = H - knownSum;
        if (Number.isFinite(inferred) && inferred > 0) {
          thicknesses1[missingIdxs[0]] = Number(canonNumStr(String(inferred)));
        }
      }

      for (let i = 0; i < thicknesses1.length; i++) {
        if (thicknesses1[i] == null) thicknesses1[i] = 1;
      }

      const layers: any[] = [];
      for (let i = 0; i < n; i++) {
        const thv = thicknesses1[i];
        const o: any = { index: i, label: `Layer ${i + 1}` };
        if (thv != null && Number.isFinite(Number(thv)) && Number(thv) > 0) {
          o.thickness_in = Number(thv);
        }
        layers.push(o);
      }

      facts.layers = layers;

      const numericThicknesses = thicknesses1.map((v) => (v == null ? 1 : Number(canonNumStr(String(v)))));
      (facts as any).layer_thicknesses = numericThicknesses;

      if (th.cavityLayerIndex1Based != null) facts.layer_cavity_layer_index = th.cavityLayerIndex1Based;

      if (!outsideDimsWasExplicit && facts.layer_footprint) {
        const fp = String(facts.layer_footprint || "").trim();
        const [fpLRaw, fpWRaw] = fp.split("x");
        const fpL = Number(fpLRaw);
        const fpW = Number(fpWRaw);

        const sumTh = numericThicknesses
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0)
          .reduce((a, b) => a + b, 0);

        if (Number.isFinite(fpL) && fpL > 0 && Number.isFinite(fpW) && fpW > 0 && sumTh > 0) {
          facts.dims = `${canonNumStr(String(fpL))}x${canonNumStr(String(fpW))}x${canonNumStr(String(sumTh))}`;
        }
      }
    }
  }

  return compact(facts);
}

/* ============================================================
   LLM helpers (facts + opener)
   ============================================================ */

async function aiParseFacts(model: string, body: string, subject: string): Promise<Mem> {
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
- color: string (if present)
- material_grade: string/number like "1560" (if present)

Layer keys (Layer 1 = bottom ... Layer N = top):
- layer_count: integer
- layer_footprint: string like "12x12"
- layer_thicknesses: array of numbers (length = layer_count)
- layer_cavity_layer_index: integer (1-based)

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
    if (parsed.color) out.color = parsed.color;
    if (parsed.material_grade != null) (out as any).material_grade = String(parsed.material_grade);

    if (parsed.cavityCount != null) out.cavityCount = parsed.cavityCount;
    if (Array.isArray(parsed.cavityDims)) out.cavityDims = parsed.cavityDims.map((x: string) => normalizeCavity(normDims(x) || x));

    if (parsed.layer_count != null) {
      const n = Number(parsed.layer_count);
      if (Number.isFinite(n) && n > 0) out.layer_count = n;
    }
    if (parsed.layer_footprint) {
      const fp = String(parsed.layer_footprint || "").trim();
      if (fp) out.layer_footprint = fp;
    }
    if (parsed.layer_cavity_layer_index != null) {
      const idx = Number(parsed.layer_cavity_layer_index);
      if (Number.isFinite(idx) && idx >= 1) out.layer_cavity_layer_index = idx;
    }
    if (Array.isArray(parsed.layer_thicknesses)) {
      const arr = parsed.layer_thicknesses
        .map((x: any) => Number(x))
        .map((x: number) => (Number.isFinite(x) && x > 0 ? x : null));
      if (arr.length) (out as any).layer_thicknesses = arr;
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

async function aiOpener(model: string, lastInbound: string, context: string): Promise<string | null> {
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

    if (mode !== "ai") return err("unsupported_mode", { mode });

    // FIX: accept "body" as alias for "text" (dryRun + older callers)
    const lastText = String(p.text || p.body || "");

    const subject = String(p.subject || "");
    const providedThreadId = String(p.threadId || "").trim();

    const threadMsgs = Array.isArray(p.threadMsgs) ? p.threadMsgs : [];
    const dryRun = !!p.dryRun;

    const salesRepSlugFromSubject = extractRepSlugFromSubject(subject, lastText);
    const salesRepSlugFromThread = inferRepSlugFromThreadMsgs(threadMsgs);
    const salesRepSlugResolved =
      salesRepSlugFromSubject ||
      salesRepSlugFromThread ||
      (process.env.DEFAULT_SALES_REP_SLUG || undefined);

    const threadKey =
      providedThreadId ||
      (subject ? `sub:${subject.toLowerCase().replace(/\s+/g, " ")}` : "");

    const subjectQuoteNo = extractQuoteNo(subject);

    /* ------------------- Parse new turn ------------------- */

    let newly = extractAllFromTextAndSubject(lastText, subject);

    // Preserve regex-derived fields that must stay authoritative even if we call the LLM.
    const regexDims = newly.dims || null;

    const regexLayerCount = newly.layer_count ?? null;
    const regexLayerFootprint = newly.layer_footprint ?? null;
    const regexLayerThicknesses = Array.isArray(newly.layer_thicknesses) ? [...(newly.layer_thicknesses as any[])] : null;
    const regexLayerCavityIdx = newly.layer_cavity_layer_index ?? null;
    const regexLayers = Array.isArray(newly.layers) ? [...(newly.layers as any[])] : null;

    const needsLLM =
      !newly.dims ||
      !newly.qty ||
      !newly.material ||
      !newly.density ||
      (newly.cavityCount && (!newly.cavityDims || newly.cavityDims.length === 0));

    if (needsLLM) {
      const llmFacts = await aiParseFacts("gpt-4.1-mini", lastText, subject);
      newly = mergeFacts(newly, llmFacts);

      // Keep regex dims authoritative
      if (regexDims) newly.dims = regexDims;

      // Keep regex layer intent authoritative
      if (regexLayerCount != null) newly.layer_count = regexLayerCount;
      if (regexLayerFootprint != null) newly.layer_footprint = regexLayerFootprint;
      if (regexLayerThicknesses != null) (newly as any).layer_thicknesses = regexLayerThicknesses;
      if (regexLayerCavityIdx != null) newly.layer_cavity_layer_index = regexLayerCavityIdx;
      if (regexLayers != null) newly.layers = regexLayers;
    }

    const hadNewQty = newly.qty != null;
    const hadNewCavities = Array.isArray(newly.cavityDims) && newly.cavityDims.length > 0;
    const hadNewDims = !!newly.dims;

    /* ------------------- Merge with memory ------------------- */

    let loadedThread: Mem = {};
    let loadedQuote: Mem = {};

    if (threadKey) loadedThread = await loadFacts(threadKey);
    if (subjectQuoteNo) loadedQuote = await loadFacts(subjectQuoteNo);

    // PATH-A: If inbound email mentions layers, discard ONLY saved layer fields from memory
    // BEFORE merging newly, so we never delete the inbound-parsed thicknesses.
const inboundMentionsLayers =
  /\b(top|middle|bottom)\s+(?:layer|pad)\b/i.test(`${subject}\n${lastText}`) ||
  /\blayer\s*\d+\b/i.test(`${subject}\n${lastText}`) ||
  /\b\d+\s*(?:layers?|layer)\b/i.test(`${subject}\n${lastText}`);

// IMPORTANT (Path-A hardening):
// Only wipe saved layer fields if the inbound turn actually provides a structured layer update.
// Many real replies *mention* layers but do not restate all thicknesses; those should not erase memory.
//
// "Structured" = has a declared layer_count AND at least one thickness value OR a layers array.
const inboundHasStructuredLayerUpdate = (() => {
  const n = Number(newly.layer_count);
  const hasCount = Number.isFinite(n) && n > 0;

  const th = Array.isArray((newly as any).layer_thicknesses) ? ((newly as any).layer_thicknesses as any[]) : [];
  const hasAnyThickness = th.some((x) => {
    const v = Number(x);
    return Number.isFinite(v) && v > 0;
  });

  const hasLayersArray = Array.isArray(newly.layers) && newly.layers.length > 0;

  return hasCount && (hasAnyThickness || hasLayersArray);
})();

if (inboundMentionsLayers && inboundHasStructuredLayerUpdate) {
  delete loadedThread.layer_thicknesses;
  delete loadedThread.layers;
  delete loadedThread.layer_cavity_layer_index;

  delete loadedQuote.layer_thicknesses;
  delete loadedQuote.layers;
  delete loadedQuote.layer_cavity_layer_index;
}


    let merged = mergeFacts(mergeFacts(loadedThread, loadedQuote), newly);

    if (salesRepSlugResolved && !merged.sales_rep_slug) merged.sales_rep_slug = salesRepSlugResolved;

    if (merged.cavityCount && (!Array.isArray(merged.cavityDims) || merged.cavityDims.length === 0)) {
      const recovered = recoverCavityDimsFromText(`${subject}\n\n${lastText}`, merged.dims);
      if (recovered.length > 0) merged.cavityDims = recovered;
    }

    merged = applyCavityNormalization(merged);

    if (merged.dims && Array.isArray(merged.cavityDims)) {
      const dimsNorm = String(merged.dims).toLowerCase().trim();
      const filtered = (merged.cavityDims as string[]).filter((c) => String(c).toLowerCase().trim() !== dimsNorm);
      if (filtered.length > 0) {
        merged.cavityDims = filtered;
        merged.cavityCount = filtered.length;
      } else {
        delete merged.cavityDims;
        delete merged.cavityCount;
      }
    }

    // FINAL thickness authority pass (after merges so nothing overwrites it later)
    if (merged.layer_count) {
      const n = Number(merged.layer_count);
      if (Number.isFinite(n) && n > 1) {
        const emailText = `${subject}\n\n${lastText}`.replace(/[”“″]/g, '"');

        const thFinal = grabLayerThicknessesCanonical(emailText, n);
        const thArr = thFinal.thicknessesByLayer1Based.slice(0, n);

        const foundAny = thArr.some((v) => v != null && Number(v) > 0);

        if (foundAny) {
          const existing = Array.isArray(merged.layer_thicknesses) ? (merged.layer_thicknesses as any[]) : [];

          for (let i = 0; i < n; i++) {
            if (thArr[i] == null) {
              const ev = Number(existing[i]);
              thArr[i] = Number.isFinite(ev) && ev > 0 ? ev : 1;
            }
          }

          merged.layer_thicknesses = thArr.map((v) => Number(canonNumStr(String(v))));

          const layers: any[] = [];
          for (let i = 0; i < n; i++) {
            layers.push({ index: i, label: `Layer ${i + 1}`, thickness_in: Number(merged.layer_thicknesses[i]) });
          }
          merged.layers = layers;

          if (thFinal.cavityLayerIndex1Based != null) merged.layer_cavity_layer_index = thFinal.cavityLayerIndex1Based;
        }
      }
    }

    merged.__turnCount = (merged.__turnCount || 0) + 1;

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

    if (subjectQuoteNo && !merged.quote_no) {
      merged.quote_no = subjectQuoteNo;
      merged.quoteNumber = subjectQuoteNo;
    }

    /* ------------------- DB enrichment ------------------- */

    merged = await enrichFromDB(merged);

    merged = await hydrateFromDBByQuoteNo(merged, {
      lockQty: hadNewQty,
      lockCavities: hadNewCavities,
      lockDims: hadNewDims,
    });

    // Ensure layer_thicknesses remains a FULL numeric array (length = layer_count)
    if (merged.layer_count && Array.isArray(merged.layer_thicknesses)) {
      const n = Number(merged.layer_count);
      if (Number.isFinite(n) && n > 0) {
        const arr = (merged.layer_thicknesses as any[])
          .slice(0, n)
          .map((x) => {
            const v = Number(x);
            return Number.isFinite(v) && v > 0 ? v : null;
          });

        while (arr.length < n) arr.push(null);
        for (let i = 0; i < arr.length; i++) if (arr[i] == null) arr[i] = 1;

        merged.layer_thicknesses = arr;
      }
    }

    if (threadKey) await saveFacts(threadKey, merged);
    if (merged.quote_no) await saveFacts(merged.quote_no, merged);

    /* ------------------- LLM opener ------------------- */

    const context = pickThreadContext(threadMsgs);
    const opener =
      (await aiOpener("gpt-4.1-mini", lastText, context)) || chooseOpener(threadKey || subject || "default");

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

    const foamFamily = merged.material_family || specs.material || null;

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
        round_to_bf: false,
      });

      if (calc && !dryRun) {
        priceBreaks = await buildPriceBreaks(
          {
            dims: specs.dims as string,
            qty: Number(specs.qty),
            material_id: Number(specs.material_id),
            round_to_bf: false,
          },
          calc,
        );
      }
    }

    if (priceBreaks && priceBreaks.length) merged.price_breaks = priceBreaks;

    /* ------------------- Store quote header + item (unchanged) ------------------- */

    let quoteId = merged.quote_id;

    const salesRepSlugForHeader: string | undefined =
      (merged.sales_rep_slug as string | undefined) || salesRepSlugResolved || undefined;

    if (!dryRun && merged.quoteNumber && !quoteId) {
      try {
        const customerName = merged.customerName || merged.customer_name || merged.name || "Customer";
        const customerEmail = merged.customerEmail || merged.email || null;
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
            sales_rep_slug: salesRepSlugForHeader,
            color: merged.color || null,
          }),
        });

        const headerJson = await headerRes.json().catch(() => ({} as any));
        if (headerRes.ok && headerJson?.ok && headerJson.quote?.id) {
          quoteId = headerJson.quote.id;
          merged.quote_id = quoteId;
          merged.status = headerJson.quote.status || merged.status;

          if (headerJson.quote.sales_rep_id != null) merged.sales_rep_id = headerJson.quote.sales_rep_id;

          if (threadKey) await saveFacts(threadKey, merged);
          if (merged.quote_no) await saveFacts(merged.quote_no, merged);
        }
      } catch (err) {
        console.error("quote header store error:", err);
      }
    }

    if (!dryRun && quoteId && canCalc && specs.material_id && !merged.__primary_item_created) {
      try {
        const { L, W, H } = parseDimsNums(specs.dims);
        const itemBody: any = {
          length_in: L,
          width_in: W,
          height_in: H,
          material_id: Number(specs.material_id),
          qty: Number(specs.qty),
          color: merged.color || null,
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

    /* ------------------- Build canonical layout editor link (Path-A) ------------------- */

    const layoutEditorUrl = buildLayoutEditorUrlFromFacts(merged);
    if (layoutEditorUrl) {
      merged.layout_editor_url = layoutEditorUrl;
      merged.layoutEditorUrl = layoutEditorUrl;
      merged.layout_editor_link = layoutEditorUrl;
      merged.layoutEditorLink = layoutEditorUrl;
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
        foam_family: foamFamily,
        thickness_under_in: merged.thickness_under_in,
        color: merged.color,
        cavityCount: merged.cavityCount ?? (Array.isArray(merged.cavityDims) ? merged.cavityDims.length : null),
        cavityDims: Array.isArray(merged.cavityDims) ? (merged.cavityDims as string[]) : [],
      },
      material: {
        name: merged.material_name,
        family: merged.material_family,
        density_lbft3: densityPcf,
        kerf_pct: merged.kerf_pct,
        min_charge: merged.min_charge,
      },
      pricing: {
        total: calc?.price_total ?? calc?.order_total ?? calc?.total ?? 0,
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
        if (!foamFamily) miss.push("Material");
        if (!merged.density) miss.push("Density");
        if (merged.cavityCount > 0 && (!merged.cavityDims || merged.cavityDims.length === 0)) miss.push("Cavity sizes");
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
      merged.__lastGraphMessageId = sent.messageId || merged.__lastGraphMessageId;
      merged.__lastInternetMessageId = sent.internetMessageId || merged.__lastInternetMessageId;
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
