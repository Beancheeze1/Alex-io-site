// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/app/lib/internalFetch";
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

// Matches the shape we put in suggested.itemsPretty
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
      const extractUrl = absoluteUrl(req, "/api/ai/extract");
      const exRes = await fetch(extractUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      if (exRes.ok) {
        const j = await exRes.json();
        extracted = j?.extracted ?? null;
        missing = j?.missing ?? null;
      }
    } catch {
      /* noop */
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
      const hasHints = extracted?.dbFilter || extracted?.searchWords;
      if (hasHints) {
        const sugUrl = absoluteUrl(req, "/api/ai/suggest-materials");
        const payload = {
          filter: extracted?.dbFilter ?? {},
          searchWords: extracted?.searchWords ?? [],
        };
        const sRes = await fetch(sugUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(payload),
        });
        if (sRes.ok) {
          const j = await sRes.json();
          const items = Array.isArray(j?.items) ? j.items : [];
          suggested.items = items;
          suggested.count = Number(j?.count ?? items.length);
          suggested.top = pickTopMaterial(items, extracted ?? null);

          // Pretty, minimal objects for display / logging
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

          // One-line summary per item (used in dryRun HTML below)
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
        }
      }
    } catch {
      /* suggestions are optional */
    }

    // ---- 3) quote html (with safe fallback) ----
    let quotePayload: any = null;
    let html: string | null = null;
    try {
      const quoteUrl = absoluteUrl(req, "/api/ai/quote");
      const qRes = await fetch(quoteUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ text: input.text }),
      });
      if (qRes.ok) {
        const j = await qRes.json();
        quotePayload = j ?? null;
        html = j?.html ?? null;
      }
    } catch {
      /* noop */
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
          suggested, // { count, items, itemsPretty, summary, top }
        },
        { status: 200 }
      );
    }

    // ---- live send via Graph ----
    const sendUrl = absoluteUrl(req, "/api/msgraph/send");
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
