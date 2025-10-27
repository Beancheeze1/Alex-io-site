// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Reads the most recent INCOMING message on a HubSpot thread,
 * extracts customerEmail, subject, and messageId,
 * and either returns (dryRun) or sends a reply.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId");
  const dryRun = url.searchParams.get("dryRun") === "1";

  if (!threadId)
    return NextResponse.json({ ok: false, error: "missing threadId" }, { status: 400 });

  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token)
    return NextResponse.json({ ok: false, error: "missing access token" }, { status: 400 });

  try {
    const res = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();

    const inbound = (data.results || []).findLast(
      (m: any) => m.direction === "INCOMING" && m.type === "MESSAGE"
    );

    if (!inbound)
      return NextResponse.json({
        ok: false,
        threadId,
        error: "no inbound message found",
      });

    const customerEmail =
      inbound?.senders?.[0]?.deliveryIdentifier?.value || null;
    const subject = inbound?.subject || "Re: (no subject)";
    const messageId =
      inbound?.headers?.find?.((h: any) => h.name === "Message-Id")?.value ||
      inbound.id;

    if (!customerEmail)
      return NextResponse.json({
        ok: false,
        threadId,
        picked: { subject, messageId },
        error: "missing customer email",
      });

    // DRY RUN
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        threadId,
        picked: { customerEmail, subject, messageId },
        note: "Ready to send reply via Graph or Gmail.",
      });
    }

    // REAL SEND (placeholder)
    // TODO: call sendViaGraph or Gmail function here
    return NextResponse.json({
      ok: true,
      sent: { to: customerEmail, subject, inReplyTo: messageId },
      provider: "placeholder",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
