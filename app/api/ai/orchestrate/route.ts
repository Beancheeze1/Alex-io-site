// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pickTopMaterial } from "@/app/lib/ai/materialSelect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[];
};

const s = (v: unknown) => String(v ?? "").trim();
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v));

function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- origin + URL helpers (FIX for localhost:10000) ----
function getOrigin(req: NextRequest) {
  const xfProto = req.headers.get("x-forwarded-proto") || undefined;
  const xfHost =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    undefined;
  const proto = xfProto || "https";
  if (!xfHost) {
    // last resort: parse from req.url but do NOT trust its host in Render
    try {
      const u = new URL(req.url);
      return `${proto}://${u.hostname}`;
    } catch {
      return `${proto}://api.alex-io.com`;
    }
  }
  return `${proto}://${xfHost}`;
}

function local(req: NextRequest, path: string) {
  const base = getOrigin(req);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

// Minimal pretty-shape for suggestions
type PrettyItem = {
  id: string | number | null;
  name: string | null;
  density_pcf: number | null;
  color: string | null;
  price_per_bf: number | null;
  price_per_ci: number | null;
  min_charge: number | null;
};

export async function POST(req: NextRequest) {
  const diag: Record<string, any> = {};
  try {
    const body = (await req.json()) as Partial<OrchestrateInput>;
    const input: OrchestrateInput = {
      mode: "ai",
      toEmail: s(body.toEmail),
      subject: s(body.subject || "Re: your message"),
      text: s(body.text),
      inReplyTo: body.inReplyTo ?? null,
      dryRun: !!body.dryRun,
      sketchRefs: Array.isArray(body.sketchRefs)
        ? body.sketchRefs.filter((x) => s(x).length > 0)
        : [],
    };
    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // ---- 1) extract ----
    let extracted: any = null;
    let missing: string[] | null = null;
    try {
      const extractUrl = local(req, "/api/ai/extract");
      diag.extract_url = extractUrl;
      const exRes = await fetch(extractUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      diag.extract_status = exRes.status;
      if (!exRes.ok) {
        diag.extract_error = await safeText(exRes);
      } else {
        const j = await exRes.json();
        extracted = j?.extracted ?? null;
        missing = j?.missing ?? null;
        diag.extract_ok = true;
      }
    } catch (e: any) {
      diag.extract_throw = e?.message || String(e);
    }

    // ---- 2) suggest materials ----
    let suggested: {
      count: number;
      items: any[];
      itemsPretty?: PrettyItem[];
      summary?: string;
      top: any | null;
    } = { count: 0, items: [], top: null };

    try {
      const hasHints =
        (extracted && extracted.dbFilter && Object.keys(extracted.dbFilter).length > 0) ||
        (extracted && Array.isArray(extracted.searchWords) && extracted.searchWords.length > 0);

      diag.hasHints = !!hasHints;
      if (hasHints) {
        const sugUrl = local(req, "/api/ai/suggest-materials");
        diag.suggest_url = sugUrl;
        const payload = {
          filter: extracted?.dbFilter ?? {},
          searchWords: extracted?.searchWords ?? [],
        };
        diag.suggest_payload = payload;

        const sRes = await fetch(sugUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(payload),
        });
        diag.suggest_status = sRes.status;

        if (!sRes.ok) {
          diag.suggest_error = await safeText(sRes);
        } else {
          const j = await sRes.json();
          const items = Array.isArray(j?.items) ? j.items : [];
          suggested.items = items;
          suggested.count = Number(j?.count ?? items.length);
          suggested.top = pickTopMaterial(items, extracted ?? null);

          // Pretty slice for display
          const pretty: PrettyItem[] = items.slice(0, 8).map((it: any): PrettyItem => ({
            id: it?.id ?? null,
            name: it?.name ?? null,
            density_pcf: toNum(it?.density_pcf),
            color: it?.color ?? null,
            price_per_bf: toNum(it?.price_per_bf),
            price_per_ci: toNum(it?.price_per_ci),
            min_charge: toNum(it?.min_charge),
          }));
          suggested.itemsPretty = pretty;

          suggested.summary =
            pretty.length > 0
              ? pretty
                  .map((it: PrettyItem) => {
                    const parts: string[] = [];
                    parts.push(it.name ?? "Material");
                    if (it.density_pcf != null) parts.push(`${it.density_pcf.toFixed(1)} pcf`);
                    if (it.color) parts.push(it.color);
                    if (it.price_per_bf != null) parts.push(`$${it.price_per_bf}/BF`);
                    else if (it.price_per_ci != null) parts.push(`$${it.price_per_ci}/CI`);
                    return "• " + parts.join(" — ");
                  })
                  .join("\n")
              : "None";
          diag.suggest_ok = true;
        }
      }
    } catch (e: any) {
      diag.suggest_throw = e?.message || String(e);
    }

    // ---- 3) quote html (with safe fallback) ----
    let quotePayload: any = null;
    let html: string | null = null;
    try {
      const quoteUrl = local(req, "/api/ai/quote");
      diag.quote_url = quoteUrl;
      const qRes = await fetch(quoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      diag.quote_status = qRes.status;
      if (!qRes.ok) {
        diag.quote_error = await safeText(qRes);
      } else {
        const j = await qRes.json();
        quotePayload = j ?? null;
        html = j?.html ?? null;
        diag.quote_ok = true;
      }
    } catch (e: any) {
      diag.quote_throw = e?.message || String(e);
    }

    if (!html) {
      html = `
        <div style="font-family:Segoe UI,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111">
          <p>Thanks for reaching out — I can help quote your foam packaging quickly.</p>
          <p>To lock in pricing, could you confirm (or attach a sketch):</p>
          <ul style="margin:0 0 12px 18px">
            <li>final outside dimensions (L × W × H)</li>
            <li>quantity</li>
            <li>foam density (e.g., 1.7 pcf)</li>
            <li>thickness under the part</li>
            <li>units (in or mm)</li>
          </ul>
          <p>— Alex-IO Estimator</p>
        </div>
      `.trim();
      diag.html_fallback = true;
    }

    // ---- Dry-run enhancements: append suggestions under the preview ----
    if (input.dryRun && suggested.itemsPretty && suggested.itemsPretty.length) {
      const list = (suggested.itemsPretty as PrettyItem[])
        .slice(0, 3)
        .map((it: PrettyItem) => {
          const bits: string[] = [];
          bits.push(it.name ?? "Material");
          if (it.density_pcf != null) bits.push(`${it.density_pcf.toFixed(1)} pcf`);
          if (it.color) bits.push(it.color);
          if (it.price_per_bf != null) bits.push(`$${it.price_per_bf}/BF`);
          else if (it.price_per_ci != null) bits.push(`$${it.price_per_ci}/CI`);
          return `<li>${bits.join(" — ")}</li>`;
        })
        .join("");

      html += `
        <div style="margin-top:16px">
          <p style="margin:0 0 6px 0"><strong>Suggested materials (top ${Math.min(
            3,
            suggested.itemsPretty.length
          )}):</strong></p>
          <ul style="margin:0 0 12px 18px">${list}</ul>
        </div>
      `;
    }

    // ---- dryRun: preview only ----
    if (input.dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          to: input.toEmail,
          subject: input.subject,
          htmlPreview: html,
          quote: quotePayload?.quote ?? null,
          extracted,
          missing,
          suggested,
          diag, // diagnostics
        },
        { status: 200 }
      );
    }

    // ---- live send via Graph ----
    const sendUrl = local(req, "/api/msgraph/send");
    diag.send_url = sendUrl;
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        mode: "reply",
        to: input.toEmail,
        subject: input.subject,
        html,
        inReplyTo: input.inReplyTo ?? null,
      }),
    });
    const forwarded = await sendRes.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: sendRes.ok,
        status: sendRes.status,
        forwardedPath: "/api/msgraph/send",
        result: forwarded,
        quote: quotePayload?.quote ?? null,
        extracted,
        missing,
        suggested,
        diag,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "orchestration error" },
      { status: 500 }
    );
  }
}

// Read text safely with truncation
async function safeText(res: Response, max = 300) {
  try {
    const t = await res.text();
    return t.length > max ? t.slice(0, max) + "…(truncated)" : t;
  } catch {
    return "<no-text>";
  }
}
