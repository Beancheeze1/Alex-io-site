// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import { getHubSpotAccessToken, hubspotGet, pickLastInboundEmailMessage } from "@/app/lib/hubspot";
import { sendRawMimeViaGraph } from "@/app/lib/email/graph";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

function buildReplyMime(params: {
  from: string;
  to: string;
  subject: string;
  inReplyTo: string;
  references?: string;
  textBody: string;
}): string {
  const { from, to, subject, inReplyTo, references, textBody } = params;

  // Minimal RFC822 MIME (UTF-8, text/plain)
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${references ?? inReplyTo}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    ``,
    textBody,
  ];
  return lines.join("\r\n");
}

async function fetchThreadMessages(threadId: string, token: string) {
  // HubSpot API: GET /conversations/v3/conversations/threads/{threadId}/messages
  const path = `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`;
  return hubspotGet<any>(path, token);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId") || "";
    const dry = url.searchParams.get("dryRun") || url.searchParams.get("dryrun");

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "Missing query param: threadId" }, { status: 400 });
    }

    // Dry-run mode: only read HubSpot and echo what we WOULD send
    const token = await getHubSpotAccessToken();
    const messages = await fetchThreadMessages(threadId, token);
    const picked = pickLastInboundEmailMessage(messages);

    if (!picked.customerEmail || !picked.subject || !picked.messageId) {
      return NextResponse.json(
        { ok: false, threadId, picked, error: "Could not resolve customerEmail/subject/messageId." },
        { status: 422 }
      );
    }

    if (dry) {
      return NextResponse.json({
        ok: true,
        mode: "dry-run",
        threadId,
        to: picked.customerEmail,
        subject: `Re: ${picked.subject}`,
        inReplyTo: picked.messageId,
        references: picked.messageId,
        exampleBody: "Thanks for reaching out — this is a dry-run placeholder.",
      });
    }

    // Live send via Graph
    const tenantId = requireEnv("MS_TENANT_ID");
    const clientId = requireEnv("MS_CLIENT_ID");
    const clientSecret = requireEnv("MS_CLIENT_SECRET");
    const from = requireEnv("MS_MAILBOX_FROM");

    const raw = buildReplyMime({
      from,
      to: picked.customerEmail!,
      subject: picked.subject!.startsWith("Re:") ? picked.subject! : `Re: ${picked.subject}`,
      inReplyTo: picked.messageId!,
      references: picked.messageId!,
      textBody:
        "Thanks for reaching out — this is an automated reply from Alex-IO.\r\n\r\n" +
        "If you need a quote, reply with your dimensions, weight, fragility (if known), and ship-to ZIP.\r\n" +
        "— Alex-IO Bot",
    });

    const result = await sendRawMimeViaGraph({
      tenantId,
      clientId,
      clientSecret,
      from,
      rawMime: raw,
    });

    return NextResponse.json({
      ok: result.ok,
      status: result.status,
      provider: "graph",
      threadId,
      to: picked.customerEmail,
      subject: picked.subject,
      inReplyTo: picked.messageId,
      error: result.error ?? null,
    }, { status: result.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // Support POST { threadId, dryRun?, body? }
  try {
    const body = await req.json().catch(() => ({}));
    const threadId = body.threadId || "";
    const dry = body.dryRun;

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "Missing body.threadId" }, { status: 400 });
    }

    // Reuse GET logic by crafting a GET URL with params
    const origin = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const u = new URL(`${origin}/api/admin/responder`);
    u.searchParams.set("threadId", threadId);
    if (dry) u.searchParams.set("dryRun", "1");

    const res = await fetch(u, { cache: "no-store" });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
