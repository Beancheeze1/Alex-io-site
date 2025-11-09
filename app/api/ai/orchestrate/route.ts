import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * AI Orchestrator (local, no external LLM)
 * Accepts:
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

type SendResult = {
  ok: boolean;
  status?: number;
  error?: string;
  result?: any;
};

function flag(name: string, dflt = false) {
  const v = process.env[name];
  if (!v) return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

/** Create a concise, helpful subject */
function composeSubject(inSubject?: string) {
  const base = "Re: your packaging quote request";
  if (!inSubject) return base;
  // normalize
  const s = String(inSubject).trim();
  if (!s) return base;
  return s.toLowerCase().startsWith("re:") ? s : `Re: ${s}`;
}

/** Extract structured hints from free text */
function parseHints(textRaw: string | undefined) {
  const text = (textRaw ?? "").replace(/\s+/g, " ").trim();

  // Dimensions like "12 x 8 x 3", "12x8x3 in", "12\" x 8\" x 3\""
  const dimRe =
    /\b(\d+(?:\.\d+)?)\s*(?:in|")?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|")?\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*(?:in|"))?\b/i;

  // Quantity like "qty 200", "200 pcs"
  const qtyRe = /\b(?:qty|quantity|pcs?|pieces?)\s*[:=]?\s*(\d{1,6})\b/i;

  // Density like "1.7 lb", "1.9lb", "2.2#"
  const densityRe = /\b(\d(?:\.\d+)?)\s*(?:lb|#)\b/i;

  // Material hints
  const matHints = {
    pe: /\b(?:pe|polyethylene|epe|xlpe|cross[-\s]?link(?:ed)?|plank)\b/i,
    pu: /\b(?:pu|urethane|polyurethane|foam)\b/i,
    eps: /\b(?:eps|styrofoam|polystyrene)\b/i,
    honeycomb: /\b(?:honeycomb|paper(?:\s*board)?|fiber board|hc)\b/i,
  };

  // Deadline
  const rushRe = /\b(?:rush|asap|urgent|today|tomorrow|next week)\b/i;

  // Cavities (like "2 cavities" or "2-up")
  const cavRe = /\b(\d+)\s*(?:cavities?|cavity|up)\b/i;

  const dims = dimRe.exec(text);
  const qty = qtyRe.exec(text);
  const dens = densityRe.exec(text);
  const cav = cavRe.exec(text);

  const mat: string[] = [];
  if (matHints.pe.test(text)) mat.push("PE");
  if (matHints.pu.test(text)) mat.push("PU");
  if (matHints.eps?.test?.(text)) mat.push("EPS");
  if (matHints.honeycomb.test(text)) mat.push("Honeycomb");

  return {
    dims: dims
      ? {
          L: Number(dims[1]),
          W: Number(dims[2]),
          H: Number(dims[3]),
          unit: "in",
        }
      : null,
    qty: qty ? Number(qty[1]) : null,
    density: dens ? Number(dens[1]) : null,
    materials: mat,
    rush: rushRe.test(text),
    cavities: cav ? Number(cav[1]) : null,
    raw: text,
  };
}

/** Build a friendly, guided reply */
function composeReply(subjectIn?: string, textIn?: string) {
  const hints = parseHints(textIn);

  const have: string[] = [];
  const need: string[] = [];

  if (hints.dims) {
    const { L, W, H } = hints.dims;
    have.push(`Dimensions: ${L} x ${W} x ${H} in`);
  } else {
    need.push("Finished part size (L × W × H, inches)");
  }

  if (hints.qty) have.push(`Quantity: ${hints.qty}`);
  else need.push("Quantity (pcs)");

  if (hints.cavities) have.push(`Cavities: ${hints.cavities}`);
  else need.push("Number of cavities (1-up, 2-up, etc.)");

  if (hints.materials.length) have.push(`Material hint: ${hints.materials.join(", ")}`);
  else need.push("Preferred material (PE, PU, EPS, or honeycomb) if any");

  if (hints.density) have.push(`Target density: ${hints.density} lb/ft³`);
  else need.push("Target foam density (if known)");

  if (hints.rush) have.push("Timeline: rush/ASAP noted");
  else need.push("Desired ship date / timeline");

  // Short summary line
  const summary =
    have.length > 0 ? `I caught: ${have.join(" · ")}.` : "I didn’t catch any specs in your message yet.";

  // Ask-back checklist
  const checklist =
    need.length > 0
      ? need.map((n) => `• ${n}`).join("\n")
      : "• Looks like we have enough to start a preliminary price—I'll run it and follow up.";

  // Subject
  const subject = composeSubject(subjectIn);

  // Main body
  const greeting = "Thanks for reaching out to Alex-IO — we can help with a fast packaging quote.";
  const nextSteps =
    need.length > 0
      ? "To firm up your pricing, could you confirm the items below?"
      : "I’ll run a prelim price using your specs and follow up shortly.";

  const sign = [
    "",
    "— Alex-IO Quoting",
    "sales@alex-io.com",
    "Alex-IO • Shelby–Mansfield, OH",
  ].join("\n");

  const body = [
    greeting,
    "",
    summary,
    "",
    nextSteps,
    checklist,
    "",
    "If you have a sketch or photo, you can reply with it and I’ll extract any missing details.",
    sign,
  ].join("\n");

  return { subject, body };
}

/** Send via local msgraph route */
async function sendEmail(base: string, toEmail: string, subject: string, text: string): Promise<SendResult> {
  const url = `${base}/api/msgraph/send?t=${Date.now()}`;
  const payload = {
    mode: "live",
    toEmail,
    subject,
    text,
    dryRun: false,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const out = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, result: out, error: r.ok ? undefined : "msgraph_send_failed" };
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json().catch(() => ({}))) as OrchestrateInput;
    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(req.url).origin.replace(/\/$/, "");

    // input validation
    if (payload.mode !== "ai") {
      return NextResponse.json({ ok: false, error: "invalid_mode" }, { status: 200 });
    }
    const toEmail = String(payload.toEmail ?? "").trim();
    if (!toEmail) {
      return NextResponse.json({ ok: false, error: "missing_toEmail" }, { status: 200 });
    }

    // Compose AI text (no echo)
    const { subject, body } = composeReply(payload.subject, payload.text);

    // Respect dryRun: return the composed message without sending
    if (payload.dryRun) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          toEmail,
          subject,
          text: body,
          note: "dryRun=true — not sent",
        },
        { status: 200 },
      );
    }

    // Gate by REPLY_ENABLED env (final safety)
    const replyEnabled = flag("REPLY_ENABLED", true);
    if (!replyEnabled) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          toEmail,
          subject,
          text: body,
          note: "REPLY_ENABLED is false — treating as dry-run",
        },
        { status: 200 },
      );
    }

    const send = await sendEmail(base, toEmail, subject, body);

    return NextResponse.json(
      {
        ok: send.ok,
        toEmail,
        subject,
        text: body,
        send_status: send.status,
        send_result: send.result,
        error: send.ok ? undefined : send.error,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "orchestrate_exception" }, { status: 200 });
  }
}
