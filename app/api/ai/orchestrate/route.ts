// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Client payload
 */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[]; // ids/urls of previously uploaded sketches
};

/**
 * Public response (kept stable)
 */
type OrchestrateResponse = {
  ok: boolean;
  dryRun: boolean;
  to: string;
  subject: string;
  htmlPreview: string;
  missing: string[];
  src: ReplyBits["src"];
  extracted: {
    dims?: unknown;
    dbFilter?: unknown;
    searchWords?: string[];
    unitsMentioned?: boolean;
    [k: string]: unknown;
  } | null;
  suggested: {
    count: number;
    items: unknown[];
    top?: unknown;
  };
  pricing?: unknown;     // optional summary/object from /quote
  quote: unknown;        // keep key for callers that expect it (null when N/A)
  diag: Record<string, unknown>; // status/urls/errors for quick debugging
};

const BASE =
  process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
  "https://api.alex-io.com";

const s = (v: unknown) => String(v ?? "").trim();
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** ---------------------------------------------------------------------
 *  Reply preview (AI-less heuristics)
 *  ------------------------------------------------------------------ */
type ReplyBits = {
  html: string;
  missing: string[];
  src: {
    hasDims: boolean;
    hasQty: boolean;
    hasDensity: boolean;
    hasThicknessUnder: boolean;
    unitsMentioned: boolean;
    hasSketch: boolean;
  };
};

function buildReply(input: OrchestrateInput): ReplyBits {
  const raw = s(input.text);

  // dimensions: "12 x 9 x 2", "12x9x2", or "L=12 W=9 H=2"
  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(raw);

  // quantity: "qty: 24", "24 pcs", or "need 24"
  const qtyMatch =
    raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) ||
    raw.match(/\b(\d{1,6})\s*(pcs|pieces|units|ea)\b/i) ||
    raw.match(/\b(?:need|for|make)\s+(\d{1,6})\b/i);
  const hasQty = !!qtyMatch;

  // density / family: "pcf", "lb/ft3", "PE", "EPE", "PU", etc.
  const hasDensity =
    /\b(?:pcf|lb\/?ft3|lb\/?ft\^?3|lb\s*per\s*cubic\s*foot)\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA|XLPE|ESTER)\b/i.test(raw) ||
    /\b\d(?:\.\d+)?\s*(?:pcf|lb\/?ft3)\b/i.test(raw);

  // thickness under the part
  const hasThicknessUnder =
    /\b(thickness|under|bottom)\b.*\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i.test(
      raw
    );

  // units mention
  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);

  // uploaded sketch?
  const hasSketch = !!(input.sketchRefs && input.sketchRefs.length > 0);

  const missing: string[] = [];
  if (!hasDims) missing.push("final outside dimensions (L × W × H)");
  if (!hasQty) missing.push("quantity");
  if (!hasDensity) missing.push("foam density (e.g., 1.7 pcf / PE family)");
  if (!hasThicknessUnder) missing.push("thickness under the part");
  if (!unitsMentioned) missing.push("units (in or mm)");

  const prompt =
    missing.length > 0
      ? `To lock in pricing, could you confirm${hasSketch ? "" : " (or attach a sketch)"}:`
      : `Great — I can run pricing; I’ll prepare a quote and send it right back.`;

  const listHtml =
    missing.length > 0
      ? `<ul style="margin:0 0 12px 18px;padding:0">${missing
          .slice(0, 6)
          .map((m) => `<li>${m}</li>`)
          .join("")}</ul>`
      : "";

  const sketchLine = hasSketch
    ? `<p>Noted — I have your sketch on file and will use it to confirm cavity placement and edge clearances.</p>`
    : `<p>If you have a sketch or photo, attach it — it helps confirm cavity sizes and clearances.</p>`;

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    <p>${prompt}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return {
    html,
    missing,
    src: { hasDims, hasQty, hasDensity, hasThicknessUnder, unitsMentioned, hasSketch },
  };
}

/** ---------------------------------------------------------------------
 *  Helpers for internal API calls (absolute URLs)
 *  ------------------------------------------------------------------ */
async function postJson<T = any>(path: string, payload: any) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
    // Node runtime: SSR safe
    cache: "no-store",
  });
  const status = res.status;
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  return { url, status, data };
}

export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as Partial<OrchestrateInput>;
    const body: OrchestrateInput = {
      mode: "ai",
      toEmail: s(raw.toEmail),
      subject: s(raw.subject || "Re: your message"),
      text: s(raw.text),
      inReplyTo: raw.inReplyTo ?? null,
      dryRun: Boolean(raw.dryRun),
      sketchRefs: Array.isArray(raw.sketchRefs)
        ? raw.sketchRefs.map(s).filter(Boolean)
        : [],
    };

    if (!isEmail(body.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // 1) Always build preview + missing list
    const reply = buildReply(body);

    // diag collector for quick CLI checks
    const diag: Record<string, unknown> = {};

    // 2) Always run EXTRACT (DB-driven hints)
    const ex = await postJson("/api/ai/extract", { text: body.text });
    diag.extract_url = ex.url;
    diag.extract_status = ex.status;
    const extracted =
      ex.status === 200 && ex.data && ex.data.ok ? (ex.data as any) : null;

    // 3) Always run SUGGEST based on extract results
    let suggestedCount = 0;
    let suggestedItems: unknown[] = [];
    let suggestedTop: unknown | undefined;

    const filter = extracted?.dbFilter ?? undefined;
    const searchWords = extracted?.searchWords ?? undefined;

    const sg = await postJson("/api/ai/suggest-materials", { filter, searchWords });
    diag.suggest_url = sg.url;
    diag.suggest_status = sg.status;
    if (sg.status === 200 && sg.data && sg.data.ok) {
      suggestedCount = sg.data.count ?? 0;
      suggestedItems = sg.data.items ?? [];
      suggestedTop = sg.data.top;
    }

    // 4) Try a QUOTE/PRICING preview (best-effort; won't fail route)
    //    We pass original free-text — your /quote handler already parses dims/qty/density
    let pricing: unknown | undefined;
    const qt = await postJson("/api/ai/quote", {
      text: body.text,
      previewOnly: true,
    });
    diag.quote_url = qt.url;
    diag.quote_status = qt.status;
    if (qt.status === 200 && qt.data && qt.data.ok) {
      pricing = qt.data.pricing ?? qt.data.quote ?? qt.data;
      diag.price_status = 200;
    } else {
      diag.price_status = 500;
      diag.price_error_text =
        qt?.data?.error || qt?.data?.message || "pricing temporarily unavailable";
    }

    const payload: OrchestrateResponse = {
      ok: true,
      dryRun: !!body.dryRun,
      to: body.toEmail,
      subject: body.subject || "Re: your message",
      htmlPreview: reply.html,
      missing: reply.missing,
      src: reply.src,
      extracted: extracted
        ? {
            dims: extracted.dims,
            dbFilter: extracted.dbFilter,
            searchWords: extracted.searchWords,
            unitsMentioned: extracted.unitsMentioned,
            ...extracted,
          }
        : null,
      suggested: {
        count: suggestedCount,
        items: suggestedItems,
        top: suggestedTop,
      },
      pricing,
      quote: null, // keep key for compatibility with old callers
      diag,
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "orchestration error" },
      { status: 500 }
    );
  }
}
