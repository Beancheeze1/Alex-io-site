// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Input JSON:
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   dryRun?: boolean
 * }
 */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

// --- helpers -------------------------------------------------------------

function envBool(name: string, d = false) {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === "1" || v === "true" || v === "yes" : d;
}

function sanitize(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * Build a safe, non-echo reply.
 * This is intentionally simple (Path-A minimal): it acknowledges,
 * mirrors the topic, and sets expectation without copying the whole inbound text.
 */
function buildReply(subject: string, inboundText: string): string {
  const topic =
    sanitize(subject) ||
    (sanitize(inboundText).slice(0, 120) && "your request");

  // Short summary line from inbound without echoing everything:
  const snippet = sanitize(inboundText).slice(0, 160);

  return [
    `Hi there — thanks for reaching out about ${topic}.`,
    snippet ? `We received your note: “${snippet}…”` : undefined,
    `We’ll review and follow up with next steps and timing shortly.`,
    ``,
    `— Alex-IO Team`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- route ---------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<OrchestrateInput>;

    const mode = (body.mode || "ai").toLowerCase();
    const toEmail = sanitize(String(body.toEmail || ""));
    const subject = sanitize(String(body.subject || ""));
    const inboundText = sanitize(String(body.text || ""));
    const inReplyTo = body.inReplyTo ?? null;
    const dryRun = !!body.dryRun;

    if (mode !== "ai") {
      return NextResponse.json(
        { ok: false, error: "unsupported_mode", mode },
        { status: 200 }
      );
    }
    if (!toEmail) {
      return NextResponse.json(
        { ok: false, error: "missing_toEmail" },
        { status: 200 }
      );
    }

    // Build NON-ECHO reply content
    const replyText = buildReply(subject, inboundText);

    // Guard: make sure we did not accidentally echo the inbound body
    const willEcho =
      replyText.replace(/\s+/g, " ").toLowerCase() ===
      inboundText.replace(/\s+/g, " ").toLowerCase();

    const finalText = willEcho
      ? `Hi — thanks for your message about ${subject || "your request"}. We’ll follow up with next steps shortly.\n\n— Alex-IO Team`
      : replyText;

    // Send (or dry-run) via internal msgraph route
    const sendPayload = {
      toEmail,
      subject: subject || "Thanks — we’re on it",
      text: finalText,
      inReplyTo,
      dryRun,
    };

    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/msgraph/send?t=${Math.random()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(sendPayload),
    });

    const sendOk = r.ok;
    let sendJson: any = {};
    try { sendJson = await r.json(); } catch {}

    return NextResponse.json(
      {
        ok: true,
        mode: "ai",
        dryRun,
        to: toEmail,
        subject: sendPayload.subject,
        preview: dryRun ? finalText : undefined,
        result: sendOk ? "sent" : "send_failed",
        msgraph_status: r.status,
        msgraph_keys: Object.keys(sendJson || {}),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "orchestrate_exception" },
      { status: 200 }
    );
  }
}
