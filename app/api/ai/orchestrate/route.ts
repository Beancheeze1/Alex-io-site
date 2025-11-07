// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { absoluteUrl } from "@/app/lib/internalFetch";

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
      sketchRefs: Array.isArray(body.sketchRefs) ? body.sketchRefs.filter(x => s(x).length > 0) : [],
    };
    if (!isEmail(input.toEmail)) {
      return NextResponse.json({ ok: false, error: "invalid toEmail" }, { status: 400 });
    }

    // ---- robust call to /api/ai/quote (never throw) ----
    let quotePayload: any = null;
    let html: string | null = null;

    try {
      const url = absoluteUrl(req, "/api/ai/quote");
      const qRes = await fetch(url, {
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
    } catch (_) {
      // swallow; we’ll fall back to a generic email below
    }

    if (!html) {
      // graceful fallback if quote service is unreachable
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

    // dry run: preview only
    if (input.dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          to: input.toEmail,
          subject: input.subject,
          htmlPreview: html,
          quote: quotePayload?.quote ?? null,
        },
        { status: 200 }
      );
    }

    // live send
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
