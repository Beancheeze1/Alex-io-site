// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** -------- Input / Output ------------------------------------------------- */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[];
};

type OrchestrateResponse = {
  ok: boolean;
  dryRun: boolean;
  to: string;
  subject: string;
  htmlPreview: string;
  missing: string[];
  src: ReplyBits["src"];
  extracted: any | null;
  suggested: { count: number; items: unknown[]; top?: unknown };
  pricing?: NormalizedPricing; // <— upgraded object
  quote: unknown; // retained for compatibility
  diag: Record<string, unknown>;
};

/** -------- Utilities ------------------------------------------------------ */
const BASE =
  process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://api.alex-io.com";

const s = (v: unknown) => String(v ?? "").trim();
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const n = (v: any) => {
  const k = typeof v === "string" ? v.replace(/[, ]+/g, "") : v;
  const x = Number(k);
  return Number.isFinite(x) ? x : undefined;
};
const r2 = (x: number) => Math.round(x * 100) / 100;

/** -------- Reply preview (missing list) ----------------------------------- */
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

  const hasDims =
    /\b(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.test(raw) ||
    /\bL\s*=?\s*\d+(?:\.\d+)?\b.*\bW\s*=?\s*\d+(?:\.\d+)?\b.*\bH\s*=?\s*\d+(?:\.\d+)?\b/i.test(
      raw
    );

  const qtyMatch =
    raw.match(/\bqty\s*[:=]?\s*(\d+)\b/i) ||
    raw.match(/\b(\d{1,6})\s*(pcs|pieces|units|ea)\b/i) ||
    raw.match(/\b(?:need|for|make)\s+(\d{1,6})\b/i);
  const hasQty = !!qtyMatch;

  const hasDensity =
    /\b(?:pcf|lb\/?ft3|lb\/?ft\^?3|lb\s*per\s*cubic\s*foot)\b/i.test(raw) ||
    /\b(PE|EPE|PU|EVA|XLPE|ESTER)\b/i.test(raw) ||
    /\b\d(?:\.\d+)?\s*(?:pcf|lb\/?ft3)\b/i.test(raw);

  const hasThicknessUnder =
    /\b(thickness|under|bottom)\b.*\b(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|millimeters?)\b/i.test(
      raw
    );

  const unitsMentioned = /\b(mm|millimeter|millimeters|in|inch|inches)\b/i.test(raw);
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

/** -------- Internal POST helper ------------------------------------------ */
async function postJson<T = any>(path: string, payload: any) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
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

/** -------- Normalized Pricing -------------------------------------------- */
export type NormalizedPricing = {
  material?: string;
  basis: { type: "CI" | "BF" | "UNKNOWN"; ratePerCI?: number; ratePerBF?: number };
  qty?: number;

  dims?: {
    inches?: { L?: number; W?: number; H?: number };
    mm?: { L?: number; W?: number; H?: number };
  };

  volume: {
    piece_ci?: number; // net CI
    with_waste_ci?: number; // CI after kerf/waste
    board_feet?: number; // computed from with_waste_ci
    kerf_pct?: number;
  };

  unitPrice: {
    calc?: number; // price computed from rate*volume (pre min-charge)
    each?: number; // final unit price (min-charge applied if needed)
    appliedMinCharge?: boolean;
    min_charge?: number;
  };

  totals: { extended?: number };

  raw: any; // original structure returned by /quote or /price
  explain: string[]; // human-readable breadcrumbs
};

/**
 * Try to interpret /api/ai/quote (or /price) output and normalize it.
 * Supports either CI or BF rate basis.
 */
function normalizePricing(raw: any, extracted: any): NormalizedPricing {
  const basisRaw = s(raw?.rateBasis || raw?.basis || raw?.rate_basis || "");
  const basis: "CI" | "BF" | "UNKNOWN" =
    basisRaw.toUpperCase() === "CI"
      ? "CI"
      : basisRaw.toUpperCase() === "BF"
      ? "BF"
      : "UNKNOWN";

  const ratePerCI = n(raw?.ratePerCI ?? raw?.rate_per_ci);
  const ratePerBF = n(raw?.ratePerBF ?? raw?.rate_per_bf);
  const kerf_pct = n(raw?.kerf_pct) ?? 0;
  const qty = n(raw?.qty) ?? n(extracted?.qty);

  // Volumes
  const piece_ci =
    n(raw?.piece_ci) ??
    n(raw?.dims_ci) ??
    n(raw?.piece_ci_without_waste) ??
    undefined;

  const with_waste_ci =
    n(raw?.piece_ci_with_waste) ??
    (piece_ci !== undefined ? r2(piece_ci * (1 + kerf_pct / 100)) : undefined);

  const board_feet =
    with_waste_ci !== undefined ? r2(with_waste_ci / 144) : undefined;

  // Price math
  let calcUnit: number | undefined;
  if (basis === "CI" && ratePerCI !== undefined && with_waste_ci !== undefined) {
    calcUnit = r2(with_waste_ci * ratePerCI);
  } else if (basis === "BF" && ratePerBF !== undefined && board_feet !== undefined) {
    calcUnit = r2(board_feet * ratePerBF);
  } else if (n(raw?.each) !== undefined) {
    calcUnit = n(raw?.each);
  }

  const min_charge = n(raw?.min_charge);
  let each: number | undefined =
    n(raw?.each) ?? (calcUnit !== undefined ? calcUnit : undefined);

  let appliedMinCharge = false;
  if (min_charge !== undefined && calcUnit !== undefined) {
    if (calcUnit < min_charge) {
      each = min_charge;
      appliedMinCharge = true;
    } else {
      each = calcUnit;
    }
  }

  const extended =
    n(raw?.extended) ??
    (each !== undefined && qty !== undefined ? r2(each * qty) : undefined);

  // Dims (try to surface both inches and mm when we can)
  const dims_in =
    extracted?.dims?.inches ??
    (extracted?.dims && {
      L: n(extracted?.dims?.L_in),
      W: n(extracted?.dims?.W_in),
      H: n(extracted?.dims?.H_in),
    }) ??
    undefined;

  // If mm not provided, derive from inches when available
  const dims_mm =
    extracted?.dims?.mm ??
    (dims_in
      ? {
          L: dims_in.L !== undefined ? r2(dims_in.L * 25.4) : undefined,
          W: dims_in.W !== undefined ? r2(dims_in.W * 25.4) : undefined,
          H: dims_in.H !== undefined ? r2(dims_in.H * 25.4) : undefined,
        }
      : undefined);

  const explain: string[] = [];
  const material = s(raw?.materialName || raw?.material || extracted?.materialName);

  if (basis === "CI" && ratePerCI !== undefined && with_waste_ci !== undefined) {
    explain.push(
      `Rate basis: CI @ ${ratePerCI}/CI · billable ${with_waste_ci} CI → calc ${calcUnit}`
    );
  } else if (basis === "BF" && ratePerBF !== undefined && board_feet !== undefined) {
    explain.push(
      `Rate basis: BF @ ${ratePerBF}/BF · billable ${board_feet} BF (${with_waste_ci} CI) → calc ${calcUnit}`
    );
  } else {
    explain.push("Rate basis unknown — using values returned by /quote if provided.");
  }

  if (kerf_pct) explain.push(`Kerf/Waste: +${kerf_pct}% applied to net CI.`);
  if (min_charge !== undefined) {
    explain.push(
      `Min charge per piece: ${min_charge}` +
        (appliedMinCharge ? " (APPLIED)" : " (not applied)")
    );
  }
  if (qty !== undefined && each !== undefined) {
    explain.push(`Extended: ${each} × ${qty} = ${extended}`);
  }

  const normalized: NormalizedPricing = {
    material: material || undefined,
    basis: { type: basis, ratePerCI, ratePerBF },
    qty,
    dims: {
      inches: dims_in,
      mm: dims_mm,
    },
    volume: {
      piece_ci,
      with_waste_ci,
      board_feet,
      kerf_pct,
    },
    unitPrice: {
      calc: calcUnit,
      each,
      appliedMinCharge,
      min_charge,
    },
    totals: { extended },
    raw,
    explain,
  };

  return normalized;
}

/** -------- Route ---------------------------------------------------------- */
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

    // 1) Preview + missing list
    const reply = buildReply(body);

    const diag: Record<string, unknown> = {};

    // 2) Extract (always)
    const ex = await postJson("/api/ai/extract", { text: body.text });
    diag.extract_url = ex.url;
    diag.extract_status = ex.status;
    const extracted = ex.status === 200 && ex.data?.ok ? ex.data : null;

    // 3) Suggest based on extract (always)
    const filter = extracted?.dbFilter ?? undefined;
    const searchWords = extracted?.searchWords ?? undefined;
    const sg = await postJson("/api/ai/suggest-materials", { filter, searchWords });
    diag.suggest_url = sg.url;
    diag.suggest_status = sg.status;

    let suggestedCount = 0;
    let suggestedItems: unknown[] = [];
    let suggestedTop: unknown | undefined;
    if (sg.status === 200 && sg.data?.ok) {
      suggestedCount = sg.data.count ?? 0;
      suggestedItems = sg.data.items ?? [];
      suggestedTop = sg.data.top;
    }

    // 4) Try quote/pricing (best-effort)
    const qt = await postJson("/api/ai/quote", { text: body.text, previewOnly: true });
    diag.quote_url = qt.url;
    diag.quote_status = qt.status;

    let pricing: NormalizedPricing | undefined;
    if (qt.status === 200 && qt.data?.ok) {
      const rawPricing = qt.data.pricing ?? qt.data.quote ?? qt.data;
      pricing = normalizePricing(rawPricing, extracted);
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
      extracted,
      suggested: { count: suggestedCount, items: suggestedItems, top: suggestedTop },
      pricing, // <— normalized + enriched
      quote: null,
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
