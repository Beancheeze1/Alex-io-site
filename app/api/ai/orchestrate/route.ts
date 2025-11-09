import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function stripNoise(raw: string): string {
  let t = raw || "";
  t = t
    .split(/\nOn .* wrote:\n/i)[0]
    .split(/\nFrom:\s.*\nSent:\s.*\nTo:\s.*\nSubject:\s.*\n/i)[0]
    .split(/\n-{2,}\s*Original Message\s*-{2,}\n/i)[0];
  t = t.split(/\n--\s*\n/)[0];
  t = t.split(/\nThanks[,.! ]*?\n/i)[0];
  return t.trim().slice(0, 1600);
}

function nonEchoFallback(subject: string): string {
  const topic = tidy(subject) || "your request";
  return [
    `Hi there — thanks for reaching out about ${topic}.`,
    `We’ve received your message and will follow up with next steps and timing shortly.`,
    ``,
    `— Alex-IO Team`,
  ].join("\n");
}

/** Remove any quoted blocks and any long fragments copied from inbound. */
function scrubEcho(out: string, inbound: string): string {
  let r = out || "";

  // Strip hard-quoted blocks and “> ” quote lines
  r = r
    .replace(/^>.*$/gm, "")
    .replace(/“[^”]{12,}”/g, "") // long smart-quoted spans
    .replace(/"[^"]{12,}"/g, ""); // long straight-quoted spans

  // Remove any substring (>=12 chars) that appears in inbound (case-insensitive)
  const cleanIn = inbound.toLowerCase();
  if (cleanIn.length >= 12) {
    // sliding window over reply words
    const words = r.split(/\s+/);
    for (let w = words.length; w >= 2; w--) {
      const window = words.slice(0, w).join(" ");
    }
    // simpler: split reply into sentences and drop those mostly present in inbound
    r = r
      .split(/(\.|\!|\?)\s+/)
      .reduce<string[]>((acc, chunk) => {
        const c = tidy(chunk);
        if (!c) return acc;
        const present = cleanIn.includes(c.toLowerCase());
        if (!present) acc.push(c);
        return acc;
      }, [])
      .join(". ");
  }

  // Collapse whitespace
  r = r.replace(/\n{3,}/g, "\n\n").trim();

  return r;
}

/* ----------------------------- prompt registry ----------------------------- */

const PROMPTS: Record<string, string> = {
  general: [
    "You are Alex-IO, a helpful quoting assistant.",
    "Do NOT quote or copy the customer’s text. Do NOT include quoted blocks. No '>' lines. No text in quotes taken from the customer.",
    "Write a short, professional reply: summarize in your own words, then list clear next steps.",
    "Keep 80–160 words. Plain language. Friendly and confident.",
  ].join(" "),
  foam_quote: [
    "You are Alex-IO, a quoting assistant for foam/corrugated/crates.",
    "Do NOT quote/copy the customer. No quoted blocks. Use your own words only.",
    "If specs are missing, ask for: Dimensions (L×W×H in), Density (e.g., 1.7 lb/ft³ PE), Quantity, Cavities/cutouts (count + size), Under-product thickness.",
    "If specs are present, confirm them succinctly and ask for only what’s missing. Give a preliminary timeline.",
    "90–150 words. Professional and friendly.",
  ].join(" "),
  followup: [
    "You are Alex-IO. Send a brief, friendly follow-up.",
    "Do NOT quote/copy the customer. No quoted blocks.",
    "Recap what we need and invite a quick reply. 60–100 words.",
  ].join(" "),
  terse_ack: [
    "Acknowledge receipt in 1–3 short sentences. No quotes. No copying customer text.",
    "If next step is on us, say what we’ll do and when to expect an update. Max 60 words.",
  ].join(" "),
};

function detectPromptKey(subject: string, body: string): keyof typeof PROMPTS {
  const hay = `${subject} ${body}`.toLowerCase();
  if (/foam|poly|pe|epe|density|cushion|insert|cavity|cutout|quote|pricing|rfq|dimensions?|l\s*x\s*w\s*x\s*h/i.test(hay))
    return "foam_quote";
  if (/follow[\s-]?up|checking in|any update|status/i.test(hay)) return "followup";
  if (/received|got it|ok|thanks|thx|ack/i.test(hay) && hay.length < 240) return "terse_ack";
  return "general";
}

/* ----------------------------- model call ----------------------------- */

async function callOpenAI(system: string, user: string): Promise<string | null> {
  const key = tidy(process.env.OPENAI_API_KEY || "");
  if (!key) return null;
  const model = tidy(process.env.AI_MODEL || "") || "gpt-4o-mini";

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content:
            user +
            "\n\nIMPORTANT: Do not quote or copy any customer text. Do not include quoted blocks. Summarize in your own words only.",
        },
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

    if (mode !== "ai") return NextResponse.json({ ok: false, error: "unsupported_mode", mode }, { status: 200 });
    if (!toEmail) return NextResponse.json({ ok: false, error: "missing_toEmail" }, { status: 200 });

    const cleaned = tidy(stripNoise(rawText));
    const key = (forcedKey && PROMPTS[forcedKey]) ? (forcedKey as keyof typeof PROMPTS) : detectPromptKey(subject, cleaned);

    const system = PROMPTS[key] || PROMPTS.general;
    const userMsg = [
      subject ? `Subject: ${subject}` : "",
      "",
      "Customer message (cleaned, for context only — DO NOT QUOTE):",
      cleaned || "(empty)",
    ]
      .filter(Boolean)
      .join("\n");

    // Generate
    let reply = await callOpenAI(system, userMsg);

    // Scrub any echo/quotes if model slipped them in
    if (reply) reply = scrubEcho(reply, cleaned);

    // If no AI or reply is too short after scrubbing, use non-echo fallback
    if (!reply || reply.replace(/\s+/g, " ").trim().length < 24) {
      reply = nonEchoFallback(subject);
    }

    // Final guard: remove any leftover '>' quote lines
    reply = reply.replace(/^>.*$/gm, "").trim();

    // Send via Graph
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
    try { sendJson = await sendRes.json(); } catch {}

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
    return NextResponse.json({ ok: false, error: err?.message ?? "orchestrate_exception" }, { status: 200 });
  }
}
