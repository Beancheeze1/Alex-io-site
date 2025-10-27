// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function getAccessToken(): Promise<string> {
  // 1) If set in env (dev), use it
  if (process.env.HUBSPOT_ACCESS_TOKEN) return process.env.HUBSPOT_ACCESS_TOKEN;

  // 2) Otherwise call your refresh endpoint
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_BASE_URL not set");

  const res = await fetch(`${base.replace(/\/$/, "")}/api/hubspot/refresh`, { cache: "no-store" });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json?.access_token) {
    throw new Error(`refresh_failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.access_token as string;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId");
    const dryRun = url.searchParams.get("dryRun") === "1";

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "missing threadId" }, { status: 400 });
    }

    // Allow an override token via header/query (optional helper for testing)
    const bearerFromQuery = url.searchParams.get("token");
    const bearerFromHeader = (() => {
      try {
        const h = (req as any).headers?.get?.("authorization") || "";
        return h.toLowerCase().startsWith("bearer ") ? h.slice(7) : "";
      } catch { return ""; }
    })();

    const token =
      bearerFromQuery?.trim() ||
      bearerFromHeader?.trim() ||
      (await getAccessToken());

    // Pull messages for the thread
    const msgRes = await fetch(
      `https://api.hubapi.com/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!msgRes.ok) {
      const t = await msgRes.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `hubspot_messages_failed ${msgRes.status}`, detail: t.slice(0, 300) },
        { status: 502 }
      );
    }
    const data = await msgRes.json();

    // Find the latest incoming email-style message
    const results: any[] = data?.results ?? [];
    const inbound = [...results].reverse().find(
      (m: any) => (m?.direction === "INCOMING" || m?.direction === "inbound") && (m?.type === "MESSAGE" || m?.type === "message")
    );

    if (!inbound) {
      return NextResponse.json({ ok: false, threadId, error: "no inbound message found" }, { status: 422 });
    }

    // Extract email, subject, and a reply anchor (Message-Id header if present)
    const customerEmail =
      inbound?.senders?.[0]?.deliveryIdentifier?.value ??
      inbound?.from?.email ??
      null;

    const subject = inbound?.subject ?? "(no subject)";

    const messageId =
      (Array.isArray(inbound?.headers)
        ? inbound.headers.find((h: any) => String(h?.name).toLowerCase() === "message-id")?.value
        : inbound?.headers?.["Message-Id"] || inbound?.headers?.["message-id"]) ||
      inbound?.id ||
      threadId;

    if (!customerEmail) {
      return NextResponse.json(
        { ok: false, threadId, picked: { subject, messageId }, error: "missing customer email" },
        { status: 422 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        threadId,
        picked: { customerEmail, subject, messageId },
        note: "Ready to send via Graph/Gmail with In-Reply-To/References.",
      });
    }

    // TODO: Call your real Graph/Gmail sender here (we'll wire it right after dry-run succeeds)
    return NextResponse.json({
      ok: true,
      provider: "placeholder",
      sent: { to: customerEmail, subject, inReplyTo: messageId },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
