// app/api/ai/orchestrate/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Request body
 * {
 *   mode: "ai",
 *   toEmail: string,
 *   subject?: string,
 *   text?: string,
 *   inReplyTo?: string | null,
 *   dryRun?: boolean,
 *   promptKey?: string  // optional: force a prompt profile
 * }
 */
type OrchestrateInput = {
  mode: "ai";
  toEmail: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
  promptKey?: string | null;
};

/* ----------------------------- utilities ----------------------------- */

function s(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function tidy(x: string): string {
  return s(x).replace(/\s+/g, " ").trim();
}

// chop signatures, quoted replies, forward blocks, long tails
function stripNoise(raw: string): string {
  let t = raw || "";

  // remove forwarded/quoted segments
  t = t
    .split(/\nOn .* wrote:\n/i)[0]
    .split(/\nFrom:\s.*\nSent:\s.*\nTo:\s.*\nSubject:\s.*\n/i)[0]
    .split(/\n-{2,}\s*Original Message\s*-{2,}\n/i)[0];

  // drop signatures after `--` or common sign-off dividers
  t = t.split(/\n--\s*\n/)[0];
  t = t.split(/\nThanks[,.! ]*?\n/i)[0]; // soft cutoff

  // limit to a safe window
  return t.trim().slice(0, 1600);
}

function nonEchoFallback(subject: string, inbound: string): string {
  const topic = tidy(subject) || "your request";
  const snippet = tidy(inbound).slice(0, 160);
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
  return tidy(a).toLowerCase() === tidy(b).toLowerCase();
}

/* ----------------------------- prompt registry ----------------------------- */

/**
 * We consolidate prior prompt styles into a simple registry.
 * Use promptKey to force one, or we auto-choose with detectPromptKey().
 */
const PROMPTS: Record<string, string> = {
  // general: default helpful assistant
  general: [
    "You are Alex-IO, a helpful quoting assistant.",
    "Write a short, professional reply to the customer.",
    "Summarize their ask in one sentence, then list clear next steps.",
    "Keep 80–160 words. Use plain language.",
    "NEVER paste the full inbound email; you may quote a tiny fragment if helpful.",
    "Close with a friendly sign-off.",
  ].join(" "),

  // foam_quote: request structured specs and guide next steps
  foam_quote: [
    "You are Alex-IO, a quoting assistant for foam/corrugated/crates.",
    "The customer likely needs a foam quote. Ask for missing specs:",
    "• Dimensions (L×W×H) in inches  • Density (e.g., 1.7 lb/ft³ PE)  • Quantity  • Cavities/cutouts (count + size)  • Under-product thickness",
    "If specs are present, confirm them and ask for any missing items.",
    "Offer a timeline for a preliminary estimate once specs are complete.",
    "Write 90–150 words, professional and friendly.",
    "Do not echo their full email.",
  ].join(" "),

  // followup: polite nudge with recap
  followup: [
    "You are Alex-IO. Send a brief, friendly follow-up.",
    "Briefly recap what we need and invite a quick reply.",
    "60–100 words. Do not paste their full email.",
  ].join(" "),

  // terse_ack: concise acknowledgment used for short confirmations
  terse_ack: [
    "Acknowledge receipt in 1–3 short sentences.",
    "If next step is on us, say what we'll do and when they should expect an update.",
    "Max 60 words. No fluff. No full echo.",
  ].join(" "),
};

function detectPromptKey(subject: string, body: string): keyof typeof PROMPTS {
  const hay = `${subject} ${body}`.toLowerCase();

  // foam/quote cues
  if (
    /foam|poly|pe|epe|density|cushion|insert|cavity|cutout|quote|pricing|rfq|dimensions?|l\s*x\s*w\s*x\s*h/i.test(
      hay
    )
  ) {
    return "foam_quote";
  }

  if (/follow[\s-]?up|checking in|any update|status/i.test(hay)) {
    return "followup";
  }

  if (/received|got it|ok|thanks|thx|ack/i.test(hay) && hay.length < 240) {
    return "terse_ack";
  }

  return "general";
}

/* ----------------------------- model call ----------------------------- */

async function callOpenAI(
  system: string,
  user: string
): Promise<string | null> {
  const key = tidy(process.env.OPENAI_API_KEY || "");
  if (!key) return null;

  const model = tidy(process.env.AI_MODEL || "") || "gpt-4o-mini";

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 350,
    }),
  });

  if (!r.ok) return null;
  const j: any = await r.json().catch(() => ({}));
  const out = tidy(j?.choices?.[0]?.message?.content || "");
  return out || null;
}

/* ------------------------------- route ------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json().catch(() => ({}))) as Partial<OrchestrateInput>;

    const mode = tidy((input.mode || "ai").toLowerCase());
    const toEmail = tidy(input.toEmail || "");
    const subject = tidy(input.subject || "");
    const rawText = s(input.text || "");
    const inReplyTo = input.inReplyTo ?? null;
    const dryRun = !!input.dryRun;
    const forcedKey = tidy(input.promptKey || "").toLowerCase();

    if (mode !== "ai") {
      return NextResponse.json({ ok: false, error: "unsupported_mode", mode }, { status: 200 });
    }
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "missing_toEmail" }, { status: 200 });
    }

    const cleaned = tidy(stripNoise(rawText));
    const key = (forcedKey && PROMPTS[forcedKey]) ? (forcedKey as keyof typeof PROMPTS)
      : detectPromptKey(subject, cleaned);

    // Build messages
    const system = PROMPTS[key] || PROMPTS.general;
    const userMsg = [
      subject ? `Subject: ${subject}` : "",
      "",
      "Customer message (cleaned):",
      cleaned || "(empty)",
    ]
      .filter(Boolean)
      .join("\n");

    // Try AI
    let reply = await callOpenAI(system, userMsg);

    // Safety: If model echoed back, null it so we fallback.
    if (reply && isEcho(reply, cleaned)) reply = null;

    // Fallback if no AI or failed
    if (!reply) {
      reply = nonEchoFallback(subject, cleaned);
      if (isEcho(reply, cleaned)) {
        reply = `Hi — thanks for your message about ${subject || "your request"}. We’ll follow up shortly.\n\n— Alex-IO Team`;
      }
    }

    // Send via your existing MS Graph route
    const base = tidy(process.env.NEXT_PUBLIC_BASE_URL || "");
    const url = `${base}/api/msgraph/send?t=${Math.random()}`;
    const payload = {
      toEmail,
      subject: subject || "Thanks — we’re on it",
      text: reply,
      inReplyTo,
      dryRun,
    };

    const sendRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });

    let sendJson: any = {};
    try {
      sendJson = await sendRes.json();
    } catch {
      // noop
    }

    return NextResponse.json(
      {
        ok: true,
        mode: "ai",
        dryRun,
        to: toEmail,
        subject: payload.subject,
        promptKey: key,
        used_ai: !!process.env.OPENAI_API_KEY,
        result: sendRes.ok ? "sent" : "send_failed",
        msgraph_status: sendRes.status,
        preview: dryRun ? reply : undefined,
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
