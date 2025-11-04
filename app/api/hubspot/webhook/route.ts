// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { makeKv } from "@/app/lib/kv";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* -------------------- small utils (kept from your working version) -------------------- */
const b = (v: unknown) => String(v ?? "").toLowerCase() === "true";
const g = (o: any, p: string[]) =>
  p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
const isEmail = (s: unknown): s is string =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function extractMessageId(evt: any): string | null {
  const headers =
    g(evt, ["message", "headers"]) ||
    g(evt, ["object", "message", "headers"]) ||
    {};
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
  const headers =
    g(evt, ["message", "headers"]) ||
    g(evt, ["object", "message", "headers"]) ||
    {};
  return (
    String(
      headers["X-AlexIO-Responder"] ?? headers["x-alexio-responder"] ?? ""
    ).trim() === "1"
  );
}
function isNewInbound(evt: any): boolean {
  const subscriptionType = String(evt?.subscriptionType ?? "");
  const changeFlag = String(evt?.changeFlag ?? "");
  const messageType = String(evt?.messageType ?? "");
  return (
    subscriptionType === "conversation.newMessage" &&
    (changeFlag === "NEW_MESSAGE" || messageType === "MESSAGE")
  );
}
async function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/* -------------------- new: logging helpers (minimal + safe) -------------------- */
function redactedHeaders(h: Headers) {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    const key = k.toLowerCase();
    out[k] =
      key.includes("authorization") ||
      key.includes("secret") ||
      key.includes("signature")
        ? "[redacted]"
        : v;
  });
  return out;
}

/* -------------------- GET: keep probes JSON so you never see HTML -------------------- */
export async function GET() {
  return NextResponse.json({ ok: true, method: "GET" });
}

/* -------------------- POST: AI reply path -------------------- */
export async function POST(req: NextRequest) {
  try {
    const startedAt = Date.now();
    const url = new URL(req.url);

    // unconditional entry log (headers redacted; body preview not required)
    console.log("[webhook] -> entry", {
      method: req.method,
      path: url.pathname + url.search,
      headers: redactedHeaders(req.headers),
    });
    const logExit = (reason: string, extra?: any) =>
      console.log("[webhook] exit", {
        reason,
        ...(extra ? { extra } : {}),
        ms: Date.now() - startedAt,
      });

    // dryRun=1 -> orchestrate will be called with dryRun:true (no Graph send)
    const dryRunParam = url.searchParams.get("dryRun") === "1";
    // If REPLY_ENABLED=false -> still build AI reply, but force dryRun:true
    const replyEnabled = b(process.env.REPLY_ENABLED);

    // Internal URLs
    const SELF = process.env.INTERNAL_SELF_URL || `${url.protocol}//${url.host}`;
    const ORCH =
      process.env.INTERNAL_ORCH_URL ||
      new URL("/api/ai/orchestrate", url).toString();

    // Throttles / TTLs (kept same names/behavior)
    const kv = makeKv();
    const cooldownMin = Number(process.env.REPLY_COOLDOWN_MIN ?? 120);
    const idemTtlMin = Number(process.env.IDEMP_TTL_MIN ?? 1440);
    const microThrottleSec = Math.max(
      1,
      Number(process.env.REPLY_MICRO_THROTTLE_SEC ?? 5)
    );

    // Payload (HubSpot sends an array)
    const events = (await req.json()) as any[];
    if (!Array.isArray(events) || events.length === 0) {
      logExit("no_events");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }
    const evt = events[0];

    // Fast reject paths
    if (!isNewInbound(evt)) {
      logExit("wrong_subtype", { subscriptionType: evt?.subscriptionType, changeFlag: evt?.changeFlag });
      return NextResponse.json({ ok: true, ignored: true, reason: "wrong_subtype" });
    }
    if (hasLoopHeader(evt)) {
      logExit("loop_header_present");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "loop_header_present",
      });
    }

    const objectId = evt?.objectId ?? evt?.threadId ?? null;
    const rawMessageId = extractMessageId(evt);

    // Micro-throttle per (thread,messageId)
    const microKey = `alexio:micro:${objectId ?? "x"}:${rawMessageId ?? "x"}`;
    if (await kv.get(microKey)) {
      logExit("micro_throttle");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "micro_throttle",
      });
    }
    await kv.set(microKey, "1", microThrottleSec); // seconds

    // Idempotency / cooldown
    if (rawMessageId) {
      const k = `alexio:idempotency:${rawMessageId}`;
      if (await kv.get(k)) {
        logExit("idempotent");
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "idempotent",
        });
      }
    }
    if (objectId) {
      const ck = `alexio:cooldown:thread:${objectId}`;
      if (await kv.get(ck)) {
        logExit("cooldown", { objectId });
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "cooldown",
        });
      }
    }

    // Extract what we can locally
    let toEmail: string | null =
      g(evt, ["message", "from", "email"]) ||
      g(evt, ["object", "message", "from", "email"]) ||
      null;
    if (toEmail && !isEmail(toEmail)) toEmail = null;

    let text: string =
      (g(evt, ["message", "text"]) ||
        g(evt, ["object", "message", "text"]) ||
        "").toString();

    let subject: string =
      (g(evt, ["message", "subject"]) ||
        g(evt, ["object", "message", "subject"]) ||
        "").toString();

    // If we’re missing email or text/subject, hydrate via lookup
    if (!toEmail || !text || !subject) {
      if (!objectId) {
        logExit("no_objectId_for_lookup");
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "no_objectId_for_lookup",
        });
      }
      const lookupRes = await postJson(`${SELF}/api/hubspot/lookup`, {
        objectId,
        messageId: rawMessageId ?? null,
      });
      const lookup = await lookupRes.json().catch(() => ({}));

      if (!toEmail) toEmail = lookup?.email ?? null;
      if (!subject) subject = (lookup?.subject ?? "").toString();
      if (!text) text = (lookup?.text ?? "").toString();

      if (!toEmail) {
        logExit("no_email_lookup_failed", { objectId, lookupStatus: lookupRes.status });
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: "no_email_lookup_failed",
          lookup,
        });
      }
    }

    if (!subject) subject = "Re: your message to Alex-IO";
    if (!text) text = ""; // AI can follow-up if needed

    // Build AI payload for orchestrator
    const aiTask =
      process.env.AI_TASK ||
      "Reply like a helpful estimator and move toward quoting. Ask clarifying questions needed to produce a quote.";
    const aiHints =
      (process.env.AI_HINTS &&
        process.env.AI_HINTS.split("|").map((s) => s.trim()).filter(Boolean)) ||
      [
        "<~120 words",
        "Ask 2 crisp questions if info is missing",
        "Confirm units (in/mm)",
        "Foam inserts typically need density and thickness under the part",
      ];

    const orchestrateBody = {
      mode: "ai" as const,
      toEmail,
      inReplyTo: rawMessageId ?? undefined,
      subject,
      text,
      dryRun: dryRunParam || !replyEnabled, // force dryRun if replies disabled
      ai: {
        task: aiTask,
        hints: aiHints,
      },
      hubspot: objectId ? { objectId } : undefined,
    };

    // Call AI orchestrator (it will call /api/msgraph/send when dryRun=false)
    const orchRes = await postJson(ORCH, orchestrateBody);
    const orch = await orchRes.json().catch(() => ({}));

    if (!orchRes.ok) {
      console.log("[webhook] orchestrate_failed %s", orchRes.status);
      return NextResponse.json(
        {
          ok: false,
          ai: false,
          toEmail,
          dryRun: orchestrateBody.dryRun,
          orchestrate_status: orchRes.status,
          orchestrate_body: orch,
        },
        { status: 502 }
      );
    }

    // Only stamp idempotency/cooldown when orchestrator ran live (dryRun=false)
    if (!orchestrateBody.dryRun) {
      if (rawMessageId) {
        await kv.set(
          `alexio:idempotency:${rawMessageId}`,
          "1",
          Math.max(60, idemTtlMin * 60)
        );
      }
      if (objectId) {
        await kv.set(
          `alexio:cooldown:thread:${objectId}`,
          "1",
          Math.max(60, cooldownMin * 60)
        );
      }
    }

    console.log(
      "[webhook] AI ok to=%s dryRun=%s ms=%d",
      toEmail,
      String(orchestrateBody.dryRun),
      Date.now() - startedAt
    );
    return NextResponse.json({
      ok: true,
      ai: true,
      toEmail,
      dryRun: orchestrateBody.dryRun,
      orchestrate: orch,
    });
  } catch (err: any) {
    console.log("[webhook] ERROR %s", err?.message ?? "unknown");
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown" },
      { status: 500 }
    );
  }
}
