// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;          // plain text (we will auto-wrap to HTML if html missing)
  html?: string;          // explicit html (preferred)
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
  // diagnostics
  missing?: Record<string, any>;
  src?: Record<string, any>;
  extracted?: Record<string, any>;
  suggested?: Record<string, any>;
  pricing?: Record<string, any>;
  quote?: Record<string, any>;
  diag?: Record<string, any>;
};

// Util: env
function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Util: tiny HTML wrapper if only text present
function wrapHtmlFromText(text: string) {
  const safe = (text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#111">
<p>${safe.replace(/\n/g, "<br/>")}</p>
</div>`;
}

// CALL helpers
async function callJson(url: string, payload: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    // Next.js app router: keep node runtime
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

export async function POST(req: NextRequest) {
  try {
    const baseUrl = requireEnv("NEXT_PUBLIC_BASE_URL"); // e.g., https://api.alex-io.com
    const body = (await req.json()) as OrchestrateInput;

    // Normalize
    const to = body.toEmail?.trim();
    const subject = body.subject ?? "Re: foam quote";
    const dryRun = Boolean(body.dryRun);
    const inReplyTo = body.inReplyTo ?? null;

    if (!to) {
      return NextResponse.json({ ok: false, error: "missing toEmail" }, { status: 400 });
    }

    // === 1) Extract, Suggest, Quote (your existing internal flow) ===
    // NOTE: these are POSTs to your own API. If you have more logic, keep it intact.
    const extractPayload = { text: body.text ?? "", sketchRefs: body.sketchRefs ?? [] };
    const extract = await callJson(`${baseUrl}/api/ai/extract`, extractPayload);

    const suggestPayload = {
      filter: extract.data?.extracted?.dbFilter,
      searchWords: extract.data?.extracted?.searchWords,
    };
    const suggest = await callJson(`${baseUrl}/api/ai/suggest-materials`, suggestPayload);

    // (Optional) pricing step – keep your current behavior
    // If you have a price API, call it; otherwise skip. We'll just carry diagnostics.
    let pricing: any = { basis: "", dims: "", volume: "", unitPrice: "", totals: "", raw: "", explain: {} };
    if (extract.data?.quote_ready) {
      // If you already price elsewhere, leave as-is; otherwise keep placeholders.
      pricing = extract.data?.pricing ?? pricing;
    }

    // Build the email HTML preview (your existing template logic can live here)
    const needs = [];
    if (!extract.data?.extracted?.hasThicknessUnder) needs.push("thickness under the part");
    // Add any other fields you want to prompt for…

    const htmlPreview =
      body.html ??
      wrapHtmlFromText(
        body.text ??
          `Thanks for reaching out — I can help quote your foam packaging quickly.

To lock in pricing, could you confirm:
• thickness under the part
${needs.length ? "" : ""}

If you have a sketch or photo, attach it — it helps confirm cavity sizes and clearances.

— Alex-IO Estimator`
      );

    // === 2) Response payload (shown in dryRun & returned regardless) ===
    const resp: OrchestrateResponse = {
      ok: true,
      dryRun,
      to,
      subject,
      htmlPreview,
      missing: needs.length ? { top: needs } : undefined,
      src: extract.data?.src ?? extract.data,
      extracted: extract.data ?? {},
      suggested: suggest.data ?? {},
      pricing,
      quote: { status: extract.data?.quote_status ?? 200, price_status: 200 },
      diag: {
        extract_url: `${baseUrl}/api/ai/extract`,
        suggest_url: `${baseUrl}/api/ai/suggest-materials`,
        quote_url: `${baseUrl}/api/ai/quote`,
      },
    };

    // === 3) SEND ONLY WHEN LIVE ===
    const replyEnabled = String(process.env.REPLY_ENABLED || "").toLowerCase() === "true";
    if (!dryRun && replyEnabled) {
      // Prefer provided HTML; fall back to wrapped text
      const html = body.html || htmlPreview || (body.text ? wrapHtmlFromText(body.text) : wrapHtmlFromText(" "));
      const sendPayload = {
        toEmail: to,
        subject,
        html,                          // guarantee msgraph/send always has html
        inReplyTo,
        dryRun: false,
      };

      const send = await callJson(`${baseUrl}/api/msgraph/send`, sendPayload);

      // Surface send outcome in response + logs
      (resp as any).send_status = send.status;
      (resp as any).send_ok = send.ok;
      (resp as any).send_result = send.data?.result ?? send.data;

      // Helpful log entry in Render
      console.log("[orchestrate] msgraph/send", {
        to,
        status: send.status,
        ok: send.ok,
        result: send.data?.result,
      });
    } else {
      console.log("[orchestrate] DRYRUN or REPLY_DISABLED", { dryRun, replyEnabled });
    }

    return NextResponse.json(resp, { status: 200 });
  } catch (err: any) {
    console.error("[orchestrate] error", err?.message || err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
