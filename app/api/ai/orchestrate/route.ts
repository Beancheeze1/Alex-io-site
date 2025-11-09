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

// ---------------- helpers ----------------

function sanitize(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripSignaturesAndReplies(raw: string): string {
  let s = raw || "";
  // Trim forwarded/quoted chunks
  s = s
    .split(/\nOn .* wrote:\n/i)[0]
    .split(/\n-{2,}\s*Original Message\s*-{2,}\n/i)[0]
    .split(/\nFrom: .*?\nSent: .*?\nTo: .*?\nSubject: .*?\n/i)[0];
  // Drop common signature separators
  s = s.split(/\n--\s*\n/)[0];
  // Limit to a safe preview
  return s.trim().slice(0, 1200);
}

function nonEchoReply(subject: string, inboundText: string): string {
  const topic = sanitize(subject) || "your request";
  const snippet = sanitize(inboundText).slice(0, 180);
  return [
    `Hi there — thanks for reaching out about ${topic}.`,
    snippet ? `We noted: “${snippet}…”` : undefined,
    `We’ll review and follow up with next steps and timing shortly.`,
    ``,
    `— Alex-IO Team`,
  ]
    .filter(Boolean)
    .join("\n");
}

function isEcho(a: string, b: string) {
  return a.replace(/\s+/g, " ").toLowerCase() === b.replace(/\s+/g, " ").toLowerCase();
}

async function tryOpenAIReply(subject: string, inbound: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const system = [
    "You are Alex-IO, a helpful quoting assistant.",
    "Write a short, professional reply to the customer.",
    "Summarize what they asked, ask for any missing specs, and propose next steps.",
    "Keep it concise (80–160 words).",
    "NEVER paste back the user’s full email; you may include a tiny quoted fragment if needed.",
    "If they request a foam quote, ask for dimensions (L×W×H), density, quantity, and any cavities or cutouts.",
    "Close with a friendly sign-off.",
  ].join(" ");

  const user = [
    subject ? `Subject: ${subject}` : "",
    "",
    "Customer message:",
    inbound,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    model: process.env.AI_MODEL?.trim() || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    max_tokens: 300,
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) return null;

  const j: any = await r.json().catch(() => ({}));
  const out: string =
    j?.choices?.[0]?.message?.content?.toString?.() ?? "";

  const reply = sanitize(out);
  if (!reply) return null;

  // Final guard: if model somehow echoed the entire thing, fall back to null
  if (isEcho(reply, inbound)) return null;
  return reply;
}

// ---------------- route ----------------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<OrchestrateInput>;

    const mode = (body.mode || "ai").toLowerCase();
    const toEmail = sanitize(String(body.toEmail || ""));
    const subject = sanitize(String(body.subject || ""));
    const inboundRaw = String(body.text || "");
    const inboundText = sanitize(stripSignaturesAndReplies(inboundRaw));
    const inReplyTo = body.inReplyTo ?? null;
    const dryRun = !!body.dryRun;

    if (mode !== "ai") {
      return NextResponse.json({ ok: false, error: "unsupported_mode", mode }, { status: 200 });
    }
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "missing_toEmail" }, { status: 200 });
    }

    // 1) Try AI
    let replyText: string | null = null;
    try {
      replyText = await tryOpenAIReply(subject, inboundText);
    } catch {
      replyText = null;
    }

    // 2) Fallback template (non-echo)
    if (!replyText) {
      const fallback = nonEchoReply(subject, inboundText);
      replyText = isEcho(fallback, inboundText)
        ? `Hi — thanks for your message about ${subject || "your request"}. We’ll follow up shortly.\n\n— Alex-IO Team`
        : fallback;
    }

    const payload = {
      toEmail,
      subject: subject || "Thanks — we’re on it",
      text: replyText,
      inReplyTo,
      dryRun,
    };

    const sendRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/msgraph/send?t=${Math.random()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      }
    );

    let sendJson: any = {};
    try { sendJson = await sendRes.json(); } catch {}

    return NextResponse.json(
      {
        ok: true,
        mode: "ai",
        dryRun,
        to: toEmail,
        subject: payload.subject,
        result: sendRes.ok ? "sent" : "send_failed",
        msgraph_status: sendRes.status,
        used_ai: !!process.env.OPENAI_API_KEY,
        preview: dryRun ? replyText : undefined,
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
