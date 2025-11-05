// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* -------------------- helpers (kept) -------------------- */
const b = (v: unknown) => String(v ?? "").toLowerCase() === "true";
const g = (o: any, p: string[]) => p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
const isEmail = (s: unknown): s is string => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function extractMessageId(evt: any): string | null {
  const headers = g(evt, ["message", "headers"]) || g(evt, ["object", "message", "headers"]) || {};
  const mid =
    headers["Message-Id"] ||
    headers["message-id"] ||
    headers["MESSAGE-ID"] ||
    evt?.messageId ||
    evt?.object?.messageId ||
    null;
  return typeof mid === "string" && mid.length > 6 ? String(mid) : null;
}
function hasLoopHeader(evt: any): boolean {
  const headers = g(evt, ["message", "headers"]) || g(evt, ["object", "message", "headers"]) || {};
  return String(headers["X-AlexIO-Responder"] ?? headers["x-alexio-responder"] ?? "").trim() === "1";
}
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType.includes("conversation.newMessage") ||
    changeFlag === "NEW_MESSAGE" ||
    messageType === "MESSAGE"
  );
}
async function postJson(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/* -------------------- route -------------------- */
export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    const url = new URL(req.url);

    const dryRunParam = url.searchParams.get("dryRun") === "1";
    const replyEnabled = b(process.env.REPLY_ENABLED);

    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const ORCH = process.env.INTERNAL_ORCH_URL || new URL("/api/ai/orchestrate", url).toString();

    const kv = makeKv();
    const cooldownMin = Number(process.env.REPLY_COOLDOWN_MIN ?? 120);
    const idemTtlMin = Number(process.env.IDEMP_TTL_MIN ?? 1440);
    const microThrottleSec = Math.max(1, Number(process.env.REPLY_MICRO_THROTTLE_SEC ?? 5));

    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }
    const evt = events[0];

    // Skip self-loops
    if (hasLoopHeader(evt)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "loop_guard" });
    }

    // Only handle new inbound messages
    if (!isNewInbound(evt)) {
      return NextResponse.json({ ok: true, ignored: true, reason: "not_new_message" });
    }

    const objectId = g(evt, ["objectId"]) || g(evt, ["object", "id"]) || null;

    // Extract what we can locally
    let toEmail: string | null =
      g(evt, ["message", "from", "email"]) || g(evt, ["object", "message", "from", "email"]) || null;
    if (toEmail && !isEmail(toEmail)) toEmail = null;

    let text: string = (g(evt, ["message", "text"]) || g(evt, ["object", "message", "text"]) || "").toString();
    let subject: string = (g(evt, ["message", "subject"]) || g(evt, ["object", "message", "subject"]) || "").toString();

    // Capture Message-Id (if present) and persist by email for threading memory
    const rawMessageId = extractMessageId(evt);
    if (toEmail && rawMessageId) {
      const kvKey = `alexio:mid:${toEmail.toLowerCase()}`;
      // Keep a short but useful TTL; refreshes on every inbound
      await kv.set(kvKey, rawMessageId, 60 * 60 * 24 * 14).catch(() => {});
    }

    // If we’re missing email/subject/text, hydrate from /lookup
    if (!toEmail || !text || !subject) {
      if (!objectId) {
        return NextResponse.json({ ok: true, ignored: true, reason: "no_objectId_for_lookup" });
      }
      const lookupRes = await postJson(`${SELF}/api/hubspot/lookup`, { objectId, messageId: rawMessageId ?? null });
      const lookup = await lookupRes.json().catch(() => ({} as any));
      if (lookupRes.ok && lookup?.ok) {
        toEmail = toEmail || lookup.email || null;
        subject = subject || lookup.subject || "";
        text = text || lookup.text || "";
      } else {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "lookup_failed",
          detail: lookup?.error ?? (await lookupRes.text().catch(() => "")),
        });
      }
    }

    if (!toEmail) return NextResponse.json({ ok: true, ignored: true, reason: "no_email" });

    // Micro-throttle per email
    const microKey = `alexio:throttle:${toEmail.toLowerCase()}`;
    const last = await kv.get(microKey).catch(() => null);
    if (last) {
      return NextResponse.json({ ok: true, ignored: true, reason: "throttled" });
    }
    await kv.set(microKey, String(Date.now()), microThrottleSec);

    // Compose AI request
    const orchestrateBody = {
      mode: "ai" as const,
      toEmail,
      inReplyTo: rawMessageId ?? undefined,
      subject,
      text,
      dryRun: dryRunParam || !replyEnabled,
      ai: { task: "reply_helpfully", hints: ["quote", "pricing", "dimensions"] },
      hubspot: objectId ? { objectId } : undefined,
    };

    const orchRes = await postJson(ORCH, orchestrateBody);
    const orch = await orchRes.json().catch(() => ({}));

    if (!orchRes.ok) {
      return NextResponse.json(
        { ok: false, error: "orchestrator_failed", detail: orch?.error ?? (await orchRes.text().catch(() => "")) },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      ai: true,
      toEmail,
      dryRun: orchestrateBody.dryRun,
      orchestrate: orch,
      ms: Date.now() - t0,
    });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
