import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator
 * Accepts:
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   dryRun?: boolean,
 *   sketchRefs?: string[]
 * }
 */

type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[];
};

type Extracted = {
  dims?: { L_in?: number; W_in?: number; H_in?: number };
  qty?: number;
  density_pcf?: number;
  foam_family?: string;
  color?: string;
  thickness_under_in?: number;
  unitsMentioned?: boolean;
  dbFilter?: Record<string, unknown>;
  searchWords?: string[];
};

type SuggestItem = {
  id: number;
  name: string;
  density_pcf?: number;
  color?: string;
  price_per_bf?: number;
  price_per_ci?: number;
  min_charge?: number;
};

type SuggestResponse = {
  count: number;
  items?: SuggestItem[];
};

type PriceInput = {
  dims: { L?: number; W?: number; H?: number };
  units?: "in" | "mm";
  qty: number;
  materialId?: number;
  round_to_bf?: boolean;
};

type PriceDiag = {
  price_status?: number;
  price_error_text?: string;
  pricingUsedDb?: boolean;
};

type OrchestrateResponse = {
  ok: boolean;
  dryRun: boolean;
  to: string;
  subject: string | undefined;
  inReplyTo: string;
  htmlPreview: string;
  missing: string[];
  extracted: Extracted;
  suggested: SuggestResponse;
  quote?: any;

  // prevent TS index errors where code accesses resp['forwarded'] / resp['result']
  forwarded?: string;
  result?: any;

  diag: Record<string, any>;
};

const BASE =
  process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
  "https://api.alex-io.com";

const s = (v: unknown) => String(v ?? "").trim();
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

function buildReply(missing: string[], hasSketch: boolean) {
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
    ? `<p>Noted — I have your sketch on file.</p>`
    : `<p>If you have a sketch or photo, attach it—it helps confirm cavity sizes and clearances.</p>`;

  const html = `
  <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">
    <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
    <p>${prompt}</p>
    ${listHtml}
    ${sketchLine}
    <p>— Alex-IO Estimator</p>
  </div>`.trim();

  return html;
}

async function callJSON(url: string, payload: any, diag: Record<string, any>, label: string) {
  try {
    const r = await fetch(`${BASE}${url}?t=${Date.now()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      cache: "no-store",
    });
    const status = r.status;
    const json = await r.json().catch(() => ({}));
    diag[`${label}_url`] = `${BASE}${url}`;
    diag[`${label}_status`] = status;
    return json ?? {};
  } catch (e: any) {
    diag[`${label}_error`] = e?.message || String(e);
    return {};
  }
}

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<OrchestrateInput>;
    const input: OrchestrateInput = {
      mode: "ai",
      toEmail: s(body.toEmail),
      subject: s(body.subject || "Re: foam quote"),
      text: s(body.text),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: Boolean(body.dryRun),
      sketchRefs: Array.isArray(body.sketchRefs)
        ? body.sketchRefs.filter((x) => s(x).length > 0)
        : [],
    };

    if (!isEmail(input.toEmail)) {
      return NextResponse.json(
        { ok: false, error: "invalid toEmail" },
        { status: 400 }
      );
    }

    // 1) Extract
    const ex = await callJSON(
      "/api/ai/extract",
      { text: input.text, sketchRefs: input.sketchRefs },
      diag,
      "extract"
    );

    const extracted: Extracted = {
      ...(ex?.extracted || {}),
    };

    // Compute "missing" prompts for the email
    const missing: string[] = [];
    const dims = extracted?.dims || {};
    if (
      !(
        typeof dims?.L_in === "number" &&
        typeof dims?.W_in === "number" &&
        typeof dims?.H_in === "number"
      )
    )
      missing.push("final outside dimensions (L × W × H)");

    if (!(typeof extracted?.qty === "number")) missing.push("quantity");
    if (!(typeof extracted?.density_pcf === "number"))
      missing.push("foam density (e.g., 1.7 pcf)");
    if (!(typeof extracted?.thickness_under_in === "number"))
      missing.push("thickness under the part");
    if (!extracted?.unitsMentioned) missing.push("units (in or mm)");

    // 2) Suggest materials (db-backed)
    const sx = await callJSON(
      "/api/ai/suggest-materials",
      {
        filter: extracted?.dbFilter || {},
        searchWords: extracted?.searchWords || [],
      },
      diag,
      "suggest"
    );

    const suggested: SuggestResponse = {
      count: Number(sx?.count || (sx?.items?.length ?? 0)) || 0,
      items: Array.isArray(sx?.items) ? sx.items : [],
    };

    // 3) Price (only if we have enough)
    let quote: any = undefined;
    if (
      typeof extracted?.qty === "number" &&
      typeof dims?.L_in === "number" &&
      typeof dims?.W_in === "number" &&
      typeof dims?.H_in === "number"
    ) {
      // Choose first suggested material if present
      const matId =
        suggested?.items && suggested.items.length > 0
          ? suggested.items[0].id
          : undefined;

      const pricePayload: PriceInput = {
        dims: { L: dims.L_in, W: dims.W_in, H: dims.H_in },
        qty: extracted.qty || 1,
        units: "in",
        materialId: matId,
        round_to_bf: false,
      };

      const px = await callJSON(
        "/api/ai/price",
        pricePayload,
        diag,
        "price"
      );

      quote = px?.pricing ?? undefined;
      diag.pricingUsedDb = Boolean(px?.pricingUsedDb);
      diag.price_status = px?.status;
      diag.price_error_text = px?.error;
    }

    // 4) Build HTML reply preview
    const htmlPreview = buildReply(missing, (input.sketchRefs?.length || 0) > 0);

    const resp: OrchestrateResponse = {
      ok: true,
      dryRun: !!input.dryRun,
      to: input.toEmail,
      subject: input.subject,
      inReplyTo: s(input.inReplyTo || ""),
      htmlPreview,
      missing,
      extracted,
      suggested,
      quote,
      // keep slots present so TS won't complain when accessed via ['forwarded'] / ['result']
      forwarded: "",
      result: undefined,
      diag,
    };

    // If not dryRun you would call /api/msgraph/send here and set resp.forwarded/result
    // We leave that logic unchanged (Path A).

    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "orchestration error",
        diag,
      },
      { status: 500 }
    );
  }
}
