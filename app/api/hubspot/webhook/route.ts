// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** tiny helpers */
const ok = (extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: true, ...extra });

const bad = (status: number, reason: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, reason, ...extra }, { status });

/** Parse both `?dryRun=1` and `?dryRun=true` as true */
const isTrue = (v: string | null) => v !== null && /^1|true|yes$/i.test(v);

/** Optional KV (Upstash) – loaded lazily and safely */
async function getKV() {
  try {
    // Works whether you export default or named `kv`
    const mod: any = await import("@/lib/kv");
    const kv = mod?.kv ?? mod?.default ?? mod;
    if (kv && typeof kv.get === "function" && typeof kv.set === "function") {
      return kv as { get: (k: string) => Promise<any>; set: (k: string, v: any, opts?: any) => Promise<any> };
    }
  } catch {
    // no kv available – fine, we silently skip dedupe
  }
  return null;
}

/** Minimal shape we care about from HubSpot envelope */
type Envelope = {
  subType?: string;          // e.g., "conversation.newMessage"
  objId?: string | number;   // conversation/thread/message identifier
  channel?: string;
  direction?: string;        // sometimes "", sometimes "INCOMING"/"OUTGOING"
};

/** Normalize request JSON into our Envelope */
function asEnvelope(body: unknown): Envelope {
  // Some HubSpot deliveries are arrays of events; you’ve been seeing single-object envelopes.
  if (Array.isArray(body) && body.length > 0) {
    const first = body[0] as any;
    return {
      subType: first?.subType ?? first?.subscriptionType ?? undefined,
      objId: String(first?.objId ?? first?.objectId ?? ""),
      channel: first?.channel ?? "",
      direction: first?.direction ?? first?.messageDirection ?? "",
    };
  }
  const b = body as any;
  return {
    subType: b?.subType ?? b?.subscriptionType ?? undefined,
    objId: String(b?.objId ?? b?.objectId ?? ""),
    channel: b?.channel ?? "",
    direction: b?.direction ?? b?.messageDirection ?? "",
  };
}

/** GET: quick health check */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dryRun = isTrue(url.searchParams.get("dryRun"));
  console.log(`[webhook] GET hit { dryRun: ${dryRun}, qs: '${url.search}' }`);
  return ok({ dryRun });
}

/** POST: HubSpot webhook handler with guardrails */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const dryRun = isTrue(url.searchParams.get("dryRun"));
  const hubspotSig =
    req.headers.get("x-hubspot-signature-v3") ||
    req.headers.get("x-hubspot-signature") ||
    "missing";

  // Loop-protection header we add on our outbound sends
  const alexSent = req.headers.get("x-alexio-sent");

  let body: unknown;
  try {
    // If you dry-run with an empty body, make a tiny envelope so logs still show shape.
    body = (await req.json().catch(() => (dryRun ? {} : undefined))) ?? {};
  } catch {
    return bad(400, "invalid_json");
  }

  const env: Envelope = asEnvelope(body);

  console.log(
    `[webhook] POST hit { dryRun:${dryRun}, len:${JSON.stringify(body).length}, json:true, ua:'${req.headers.get(
      "user-agent"
    )}', hubspotSig:'${hubspotSig}' }`
  );
  console.log(`[webhook] envelope`, {
    subType: env.subType ?? "",
    objId: env.objId ?? "",
    channel: env.channel ?? "",
    direction: env.direction ?? "",
  });

  // 1) Global kill switch
  const REPLY_ENABLED = String(process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";
  const MAILBOX_FROM = String(process.env.MS_MAILBOX_FROM ?? "sales@alex-io.com").toLowerCase();

  console.log(
    `[webhook] env { REPLY_ENABLED:'${REPLY_ENABLED}', MS_TENANT_ID:'${!!process.env.MS_TENANT_ID}', MS_CLIENT_ID:'${!!process.env.MS_CLIENT_ID}', MS_CLIENT_SECRET:'${!!process.env.MS_CLIENT_SECRET}', MS_MAILBOX_FROM:'${MAILBOX_FROM}' }`
  );

  if (!REPLY_ENABLED) {
    console.log(`[webhook] Responder output { sent:false, action:'no-responder', note:'reply disabled' }`);
    return ok({ dryRun, ignored: true, reason: "reply_disabled" });
  }

  // 2) Subtype guard
  if ((env.subType || "").toLowerCase() !== "conversation.newmessage") {
    console.log(`[webhook] Responder output { sent:false, action:'no-responder', note:'wrong subtype' }`);
    return ok({ dryRun, ignored: true, reason: "wrong_subtype", subType: env.subType ?? "" });
  }

  // 3) Loop guard (ignore anything we sent)
  // We tag every Graph send with header: X-AlexIO-Sent: 1
  if (alexSent === "1") {
    console.log(`[webhook] Responder output { sent:false, action:'no-responder', note:'loop header' }`);
    return ok({ dryRun, ignored: true, reason: "loop_header" });
  }

  // 4) De-dupe on objId (best effort; only if KV is available)
  try {
    const kv = await getKV();
    if (kv && env.objId) {
      const key = `hs:evt:${env.objId}`;
      const seen = await kv.get(key);
      if (seen) {
        console.log(`[webhook] Responder output { sent:false, action:'no-responder', note:'duplicate objId' }`);
        return ok({ dryRun, ignored: true, reason: "duplicate" });
      }
      // TTL 10 minutes is plenty for HS retries
      await kv.set(key, "1", { ex: 600 });
    }
  } catch (e: any) {
    console.log(`[webhook] dedupe skipped: ${e?.message ?? String(e)}`);
  }

  // 5) Dry-run quick exit
  if (dryRun) {
    console.log(`[webhook] Responder output { sent:false, action:'noop', note:'dry-run' }`);
    return ok({ dryRun, processable: false, reason: "dry-run" });
  }

  // At this point: allowed to proceed. We forward to the responder
  // so it can decide whether to send (templates, parsing, etc).
  try {
    // We forward to your responder URL so the "brains" live in one place.
    // NOTE: keep this path consistent with your project’s existing responder route.
    const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
    const responder = `${base}/api/admin/responder`;

    const forward = await fetch(responder, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Preserve our loop-protection marker through the pipeline.
        "X-AlexIO-Envelope": "webhook",
      },
      body: JSON.stringify({
        objId: env.objId ?? "",
        envelope: env,
      }),
    });

    const text = await forward.text();
    console.log(
      `[webhook] Responder forward result { status: ${forward.status}, text: ${text ? text.slice(0, 400) : ""} }`
    );

    const sent = forward.ok;
    console.log(
      `[webhook] Responder output { sent:${sent}, action:'${sent ? "graph-send" : "no-responder"}', note:'${
        forward.ok ? "accepted" : "failed:" + forward.status
      }' }`
    );
    return NextResponse.json({ ok: true, forwarded: true, status: forward.status, body: text ?? "" });
  } catch (err: any) {
    console.log(`[webhook] ERROR forwarding to responder: ${err?.message ?? String(err)}`);
    return bad(500, "forward_error");
  }
}
