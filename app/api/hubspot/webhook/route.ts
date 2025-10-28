// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Path-A Webhook:
 * - Accepts conversation.newMessage events
 * - Extracts sender email from HubSpot’s new deliveryIdentifier field if needed
 * - Builds a reply payload and forwards to /api/ms/send
 * - ?dryRun=1 skips the Graph send for safety checks
 */

type HubSpotEvent = {
  eventId?: number;
  portalId?: number;
  subscriptionId?: number;
  subscriptionType?: string;
  occurredAt?: number;
  objectId?: number;
  messageId?: string;
  messageType?: string;
  changeFlag?: string;
  customerEmail?: string;
  fromEmail?: string;
  email?: string;
  sender?: string;
  subject?: string;
  text?: string;
  deliveryIdentifier?: { type: string; value: string }[]; // NEW
};

function json(data: any, init: number | ResponseInit = 200) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const dryRun = searchParams.has("dryRun");

    const events: HubSpotEvent[] = await req.json();
    if (!Array.isArray(events)) return json({ ok: false, error: "invalid_json" }, 400);

    console.log("[webhook] received events=" + events.length);

    let valid: HubSpotEvent | null = null;
    for (const ev of events) {
      const sub = ev.subscriptionType || "";
      const flag = ev.changeFlag || "";
      if (sub.includes("conversation.newMessage") && flag === "NEW_MESSAGE") {
        // Extract email from new deliveryIdentifier format if needed
        let email =
          ev.customerEmail ||
          ev.fromEmail ||
          ev.email ||
          ev.sender ||
          (ev.deliveryIdentifier?.find((d) => d.type === "HS_EMAIL_ADDRESS")?.value ?? null);

        if (email && !email.includes("sales@alex-io.com")) {
          valid = { ...ev, customerEmail: email };
          break;
        }
      }
    }

    if (!valid) {
      console.log("[webhook] no_valid_inbound (missing/loop email)");
      return json({ ok: true, skipped: true, reason: "no_valid_inbound" });
    }

    const payload = {
      to: valid.customerEmail,
      subject: valid.subject || "Alex-IO auto-reply",
      text: valid.text || "Thanks for your message — this is an automated reply from Alex-IO.",
    };

    if (dryRun) {
      console.log("[webhook] dryRun → would send:", payload);
      return json({ ok: true, dryRun: true, payload });
    }

    // Forward to MS Graph send route
    const sendRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/ms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const sendData = await sendRes.json().catch(() => ({}));
    console.log("[webhook] sent via /ms/send", sendRes.status, sendData);

    return json({ ok: true, status: sendRes.status, data: sendData });
  } catch (err: any) {
    console.error("[webhook] error", err);
    return json({ ok: false, error: err.message || "internal_error" }, 500);
  }
}
