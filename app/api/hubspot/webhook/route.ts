// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ClassicEvent = {
  objectId?: string | number;
  objId?: string | number;
  subType?: string;                 // e.g. "conversation.newMessage"
  channel?: string;                 // e.g. "EMAIL"
  direction?: string;               // e.g. "INCOMING"
};

type ExpandedObjectEvent = {
  // Expanded/object model examples seen from HubSpot:
  // {
  //   "objectType":"conversation",
  //   "objectId":"9819308774",
  //   "eventType":"NEW_MESSAGE",      // sometimes uppercase
  //   "subscriptionType"?: "conversation.newMessage",
  //   ...
  // }
  objectType?: string;
  objectId?: string | number;
  eventType?: string;               // e.g. "NEW_MESSAGE"
  subscriptionType?: string;        // e.g. "conversation.newMessage"
};

type Envelope = {
  subType: string;
  objId: string;
  channel: string;
  direction: string;
};

function log(msg: string, obj?: any) {
  if (obj !== undefined) {
    console.log(`[webhook] ${msg}`, obj);
  } else {
    console.log(`[webhook] ${msg}`);
  }
}

function asString(v: any): string {
  return v == null ? "" : String(v);
}

/**
 * Normalize either payload style into a single envelope our responder understands.
 * Returns null if we can't positively identify a "new inbound message".
 */
function extractEnvelope(body: any): Envelope | null {
  // 1) Classic conversations webhook (what we originally built for)
  const maybeClassic = (evt: any): Envelope | null => {
    const c: ClassicEvent = evt ?? {};
    const subType = asString(c.subType);
    if (subType) {
      return {
        subType,
        objId: asString(c.objId ?? c.objectId),
        channel: asString(c.channel),
        direction: asString(c.direction),
      };
    }
    return null;
  };

  // 2) Expanded object style → map into our envelope
  const maybeExpanded = (evt: any): Envelope | null => {
    const e: ExpandedObjectEvent = evt ?? {};
    // Positive signals we treat as "new message":
    const looksLikeNew =
      e.subscriptionType === "conversation.newMessage" ||
      (e.objectType === "conversation" &&
        (e.eventType?.toUpperCase?.() === "NEW_MESSAGE" ||
         e.eventType?.toLowerCase?.() === "conversation.newmessage"));

    if (!looksLikeNew) return null;

    return {
      subType: "conversation.newMessage",
      objId: asString(e.objectId),
      channel: "",    // unknown in object model
      direction: "",  // unknown in object model
    };
  };

  const arr = Array.isArray(body) ? body : [body];

  for (const item of arr) {
    // Try the classic shape first
    const c = maybeClassic(item);
    if (c) return c;

    // Then try the expanded/object shape
    const x = maybeExpanded(item);
    if (x) return x;
  }

  return null;
}

function summarizeEnvelope(env: Envelope | null) {
  if (!env) return { subType: "", objId: "", channel: "", direction: "" };
  const { subType, objId, channel, direction } = env;
  return { subType, objId, channel, direction };
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const hubspotSig =
    req.headers.get("X-HubSpot-Signature") ||
    req.headers.get("x-hubspot-signature");

  const isJson =
    (req.headers.get("content-type") || "").includes("application/json");

  let body: any = null;
  try {
    body = isJson ? await req.json() : await req.text();
  } catch {
    // ignore parse error; we'll respond below
  }

  log(`POST hit { dryRun:${dryRun}, len:${body ? JSON.stringify(body).length : 0}, json:${isJson}, ua:'${req.headers.get("user-agent")}', hubspotSig:'${hubspotSig ? "present" : "missing"}' }`);

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      ignored: false,
      reason: "processable: dry-run",
    });
  }

  if (!isJson || !body) {
    log("Responder output { sent:false, action:'no-responder', note:'invalid_json' }");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const env = extractEnvelope(body);
  log("envelope", summarizeEnvelope(env));

  // Surface important env vars (helpful for debugging)
  log("env", {
    REPLY_ENABLED: process.env.REPLY_ENABLED,
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_MAILBOX_FROM: process.env.MS_MAILBOX_FROM,
  });

  if (!env || env.subType !== "conversation.newMessage") {
    log("Responder output { sent:false, action:'no-responder', note:'ignore_event:unknown' }");
    return NextResponse.json({ ok: true, ignored: true, note: "unknown_event" });
  }

  // ---------- At this point we know it's a new message ----------
  // Call the responder route to actually send email via Graph.
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/admin/responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objId: env.objId,
        from: process.env.MS_MAILBOX_FROM,
      }),
    });

    const text = await res.text();
    log("Responder forward result", { status: res.status, text: text?.slice(0, 500) });

    const ok = res.ok;
    log(`Responder output { sent:${ok}, action:'graph-send', note:'${ok ? "accepted" : "failed"}:${res.status}' }`);

    return NextResponse.json({
      ok,
      forwardedStatus: res.status,
      body: text?.slice(0, 500),
    }, { status: ok ? 200 : 500 });
  } catch (err: any) {
    log("Responder output { sent:false, action:'graph-send', note:'exception' }");
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
