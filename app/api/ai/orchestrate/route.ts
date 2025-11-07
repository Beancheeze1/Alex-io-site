// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator v2 (baseline)
 * Minimal pass-through to /api/msgraph/send with light input shaping.
 *
 * Accepts (JSON):
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,               // plain text to wrap as HTML
 *   html?: string,               // if provided, used as-is
 *   inReplyTo?: string | null,   // Internet-Message-ID for threading
 *   dryRun?: boolean,
 *   sketchRefs?: string[]        // kept for future use; ignored here
 * }
 */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  sketchRefs?: string[];
};

export async function POST(req: NextRequest) {
  try {
    let body: OrchestrateInput | null = null;
    try {
      body = (await req.json()) as OrchestrateInput;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }

    if (!body || body.mode !== "ai") {
      return NextResponse.json({ ok: false, error: "mode must be 'ai'" }, { status: 400 });
    }

    const to = (body.toEmail || "").trim();
    if (!to) {
      return NextResponse.json({ ok: false, error: "toEmail is required" }, { status: 400 });
    }

    // Subject: optional for replies; default politely if new thread
    const subject =
      (body.subject || "").trim() ||
      (body.inReplyTo ? "" : "Re: Your message"); // blank ok when replying; Graph will keep thread

    // Prefer provided HTML; otherwise wrap plain text
    const html = (body.html && body.html.trim().length > 0)
      ? body.html
      : wrapTextAsHtml(body.text || "");

    // Build payload for /api/msgraph/send
    const sendPayload: any = {
      to,
      subject,
      html,
      dryRun: !!body.dryRun,
    };
    if (body.inReplyTo) {
      // /api/msgraph/send accepts inReplyTo or internetMessageId; either works
      sendPayload.inReplyTo = body.inReplyTo;
    }

    const res = await fetch(getInternalUrl("/api/msgraph/send"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sendPayload),
    });

    const text = await safeText(res);
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: res.status,
          error: "msgraph/send failed",
          detail: data ?? text ?? null,
        },
        { status: 200 } // keep 200 so admin chains don't hard-fail
      );
    }

    return NextResponse.json({
      ok: true,
      route: "/api/ai/orchestrate",
      forwarded: "/api/msgraph/send",
      result: data ?? text ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 200 } // soft-fail pattern used elsewhere
    );
  }
}

/* =========================
   Helpers
   ========================= */

function wrapTextAsHtml(t: string): string {
  const escaped = escapeHtml(t || "");
  // Split on blank lines -> paragraphs; keep single newlines as <br/>
  const blocks = escaped
    .split(/\r?\n\r?\n/g)
    .map(p => p.replace(/\r?\n/g, "<br/>").trim())
    .filter(Boolean);
  return blocks.length ? `<div>${blocks.map(p => `<p>${p}</p>`).join("")}</div>` : "<div></div>";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Resolve an internal route to an absolute URL.
 * If NEXT_PUBLIC_BASE_URL is set, use it; otherwise default to http://localhost:3000.
 */
function getInternalUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") || "http://localhost:3000";
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return null; }
}
