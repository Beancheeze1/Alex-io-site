// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type HubSpotEvent = {
  subscriptionType?: string;
  changeFlag?: string;
  customerEmail?: string;
  subject?: string;
  text?: string;
  html?: string;
};

function json(data: any, init?: number | ResponseInit) {
  const opts: ResponseInit | undefined =
    typeof init === "number" ? { status: init } : init;
  return NextResponse.json(data, opts);
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  let events: HubSpotEvent[] = [];
  try {
    const body = await req.json();
    events = Array.isArray(body) ? body : body ? [body] : [];
  } catch {
    console.log("[webhook] invalid_json");
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  console.log(`[webhook] received events=${events.length}`);

  if (!events.length) return json({ ok: true, skipped: true, reason: "no_events" });

  const outbound = events.filter(
    (e) =>
      e.subscriptionType?.toLowerCase() === "conversation.newmessage" &&
      e.changeFlag?.toUpperCase() === "NEW_MESSAGE" &&
      e.customerEmail &&
      !e.customerEmail.toLowerCase().includes("sales@alex-io.com")
  );

  if (!outbound.length) {
    console.log("[webhook] no_valid_inbound");
    return json({ ok: true, skipped: true, reason: "no_valid_inbound" });
  }

  if (dryRun) {
    console.log("[webhook] DRYRUN sample to=" + outbound[0].customerEmail);
    return json({ ok: true, dryRun: true, sample: outbound[0] });
  }

  const results: any[] = [];
  for (const e of outbound) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: e.customerEmail,
        subject: `Re: ${e.subject || "Your message"}`,
        text: e.text
          ? `Hi — thanks for your message!\n\n${e.text}`
          : "Thanks for reaching out.",
      }),
    });
    const ok = res.status === 202 || res.ok;
    results.push({ to: e.customerEmail, status: res.status, ok });
    console.log(`[webhook] send to=${e.customerEmail} status=${res.status}`);
  }

  return json({ ok: true, sent: results });
}
