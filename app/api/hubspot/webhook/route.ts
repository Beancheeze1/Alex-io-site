// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { parseHubspotPayload } from "../../../lib/hubspot";
import { callMsGraphSend } from "../../../lib/msgraph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * HubSpot Webhook (conversation.newMessage)
 * - Accepts array or object payloads (HubSpot test vs live)
 * - Extracts { toEmail, text, subject, messageId }
 * - ?dryRun=1 echoes a stub result and 200
 * - Otherwise forwards to /api/ai/orchestrate; falls back to /api/msgraph/send
 * - Always return 200 so HubSpot stays green
 */

function ok(body: any) {
  return NextResponse.json({ ok: true, ...body }, { status: 200 });
}
function err(body: any) {
  return NextResponse.json({ ok: false, ...body }, { status: 200 });
}

async function callOrchestrate(args: {
  toEmail: string;
  text: string;
  subject?: string;
  inReplyTo?: string;
  dryRun?: boolean;
}) {
  const { toEmail, text, subject, inReplyTo, dryRun } = args;
  const base = process.env.NEXT_PUBLIC_BASE_URL || "";

  const res = await fetch(`${base}/api/ai/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      mode: "email",
      toEmail,
      text,
      subject,
      inReplyTo,
      dryRun,
    }),
  });

  const details = await res.json().catch(() => ({}));
  return { status: res.status, details };
}

export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.has("dryRun");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err({ error: "no_body" });
  }

  const { toEmail, text, subject, messageId } = parseHubspotPayload(raw);
  const hasEmail = !!toEmail && typeof toEmail === "string";
  const hasText = !!text && typeof text === "string" && text.trim().length > 0;

  console.log("[webhook] ARRIVE {",
    "\n  subscriptionType:", (raw as any)?.subscriptionType,
    "\n  messageType:", (raw as any)?.messageType ?? null,
    "\n  changeFlag:", (raw as any)?.changeFlag,
    "\n}", `\n  hasEmail: ${hasEmail},`, `\n  hasText: ${hasText}`);

  if (dryRun) {
    return ok({
      dryRun: true,
      toEmail,
      subject: subject ?? "(none)",
      text: (text ?? "").slice(0, 120),
      inReplyTo: messageId,
    });
  }

  if (!hasEmail || !hasText) {
    console.log("[webhook] IGNORE missing", { toEmail: !!toEmail, text: !!text });
    return ok({ ignored: true, reason: "missing_email_or_text" });
  }

  // Primary: AI orchestrator
  try {
    const orch = await callOrchestrate({
      toEmail: toEmail!,
      text: text!,
      subject,
      inReplyTo: messageId,
      dryRun: false,
    });
    if (orch.status >= 200 && orch.status < 300) {
      return ok({ route: "/api/ai/orchestrate", status: orch.status });
    }
    console.warn("[webhook] Orchestrate failed, falling back", orch);
  } catch (e) {
    console.warn("[webhook] Orchestrate threw, falling back", e);
  }

  // Fallback: direct msgraph send
  try {
    const ms = await callMsGraphSend({
      to: toEmail!,
      subject: subject ?? "[Alex-IO] We received your message",
      text: text!,
      inReplyTo: messageId,
      dryRun: false,
    });
    return ok({ route: "/api/msgraph/send", status: ms.status, graph: ms.details });
  } catch (e) {
    console.error("[webhook] graph fallback failed", e);
    return err({ error: "graph_send_failed" });
  }
}
