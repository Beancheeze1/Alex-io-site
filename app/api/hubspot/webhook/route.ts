// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function asBool(v: unknown) { return String(v ?? "").toLowerCase() === "true"; }
function get(o: any, path: string[]) { return path.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o); }
function isEmail(s: unknown): s is string { return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function extractMessageId(evt: any): string | null {
  const headers = get(evt, ["message", "headers"]) || get(evt, ["object", "message", "headers"]) || {};
  const mid = headers["Message-Id"] || headers["message-id"] || headers["MESSAGE-ID"] || evt?.messageId || evt?.object?.messageId || null;
  return typeof mid === "string" && mid.length > 6 ? mid : null;
}
function hasLoopHeader(evt: any): boolean {
  const headers = get(evt, ["message", "headers"]) || get(evt, ["object", "message", "headers"]) || {};
  const v = headers["X-AlexIO-Responder"] || headers["x-alexio-responder"] || headers["X-ALEXIO-RESPONDER"] || "";
  return String(v).trim() === "1";
}
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const eventType = String(evt?.eventType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType.includes("conversation.newMessage") ||
    eventType.includes("newMessage") ||
    changeFlag === "NEW_MESSAGE" ||
    messageType === "MESSAGE"
  );
}

async function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const replyEnabled = asBool(process.env.REPLY_ENABLED);

    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      console.log("[webhook] IGNORE no_events");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }

    const evt = events[0];
    const subtype = {
      subscriptionType: evt?.subscriptionType ?? null,
      eventType: evt?.eventType ?? null,
      changeFlag: evt?.changeFlag ?? null,
      messageType: evt?.messageType ?? null,
    };
    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const messageId = evt?.messageId ?? null;

    console.log("[webhook] ARRIVE subtype=%j", subtype);

    if (!isNewInbound(evt)) {
      console.log("[webhook] IGNORE wrong_subtype");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "wrong_subtype", subtype });
    }
    if (hasLoopHeader(evt)) {
      console.log("[webhook] IGNORE loop_header_present");
      return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "loop_header_present", subtype });
    }

    // Step 1: try trivial places (real events often don't have them)
    let toEmail: string | null = null;
    const directCandidates: any[] = [
      get(evt, ["recipient", "email"]),
      get(evt, ["message", "from", "email"]),
      get(evt, ["object", "message", "from", "email"]),
    ];
    for (const c of directCandidates) { if (isEmail(c)) { toEmail = c; break; } }

    // Step 2: if missing, look it up from HubSpot thread/messages
    let via = "direct";
    if (!toEmail) {
      if (!objectId) {
        console.log("[webhook] IGNORE no_email (no objectId to resolve)");
        return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "no_email_no_objectId", subtype });
      }
      const lookupRes = await postJson(new URL("/api/hubspot/lookup", url).toString(), { objectId, messageId });
      const lookup = await lookupRes.json().catch(() => ({}));
      if (lookupRes.ok && lookup?.email) {
        toEmail = lookup.email;
        via = `lookup:${lookup?.via || "unknown"}`;
      } else {
        console.log("[webhook] IGNORE no_email (lookup failed) status=%s body=%j", lookupRes.status, lookup);
        return NextResponse.json({ ok: true, dryRun, ignored: true, reason: "no_email_lookup_failed", subtype, lookup });
      }
    }

    const inReplyTo = extractMessageId(evt);
    if (dryRun || !replyEnabled) {
      console.log("[webhook] DRYRUN to=%s via=%s inReplyTo=%s", toEmail, via, inReplyTo ?? "-");
      return NextResponse.json({ ok: true, dryRun: true, wouldSend: true, toEmail, via, inReplyTo, subtype });
    }

    const html = `<p>Thanks for reaching out! We received your message and will follow up shortly.</p><p>— Alex-IO</p>`;
    const override = process.env.INTERNAL_SEND_URL; // Render origin preferred
    const sendUrl = override || new URL("/api/msgraph/send", url).toString();

    const res = await postJson(sendUrl, {
      to: toEmail,
      html,
      inReplyTo,
      references: inReplyTo ? [inReplyTo] : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log("[webhook] SEND FAIL to=%s status=%s ms=%d", toEmail, res.status, Date.now() - startedAt);
      return NextResponse.json(
        { ok: false, error: "sendMail fetch failed", status: res.status, details: text.slice(0, 1000), toEmail, via, inReplyTo, subtype },
        { status: 502 }
      );
    }

    console.log("[webhook] SENT to=%s via=%s inReplyTo=%s ms=%d", toEmail, via, inReplyTo ?? "-", Date.now() - startedAt);
    return NextResponse.json({ ok: true, sent: true, toEmail, via, inReplyTo, subtype });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
