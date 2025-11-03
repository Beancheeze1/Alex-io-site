// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HSMessage = {
  subscriptionType?: string;
  messageType?: string | null;
  changeFlag?: string | null;
  objectId?: string | number;           // thread id
  messageId?: string;                   // hubspot msg id (sometimes at top)
  message?: {
    id?: string;
    from?: { email?: string };
    text?: string;
    subject?: string;
  };
};

function b(val: string | null): boolean {
  return val === "1" || val === "true";
}

function safeStr(x: unknown): string {
  return (typeof x === "string" ? x : x != null ? String(x) : "").trim();
}

function baseUrl(): string {
  const v = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
  if (!v) throw new Error("Missing NEXT_PUBLIC_BASE_URL");
  return v.replace(/\/+$/, "");
}

export async function GET() {
  // HubSpot occasionally probes with GETs; keep it green.
  return NextResponse.json({ ok: true, method: "GET" });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun = b(url.searchParams.get("dryRun"));

  // Parse body (HubSpot can send a single object or an array of events)
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const events: HSMessage[] = Array.isArray(body) ? body : body ? [body] : [];

  const evt = (events[0] || {}) as HSMessage;

  // Shallow top-level signals for logging/triage
  const subtype = {
    subscriptionType: evt.subscriptionType ?? undefined,
    messageType: (evt as any).messageType ?? null,
    changeFlag: (evt as any).changeFlag ?? undefined,
  };

  // Minimal arrival log — mirrors your existing style
  console.log("==> //////////////////////////////////////////////////");
  console.log("[webhook] ARRIVE {");
  console.log("  subtype:", JSON.stringify(subtype), ",");
  console.log("}");
  const shallowMessageId = safeStr(evt.messageId || evt.message?.id);
  const shallow = {
    hasEmail: !!evt.message?.from?.email,
    hasText: !!evt.message?.text,
    messageId: shallowMessageId || undefined,
  };
  console.log("[webhook] shallow extract ->", JSON.stringify(shallow));

  // Extract raw bits (often missing in real webhooks)
  let toEmail = safeStr(evt.message?.from?.email);
  let text = safeStr(evt.message?.text);
  let subject = safeStr((evt.message as any)?.subject);
  let inReplyTo = shallowMessageId;

  // Thread + msg ids for hydration
  const objectId = safeStr(evt.objectId);
  const messageId = shallowMessageId;

  // If the webhook didn’t include email/text, hydrate via /api/hubspot/lookup
  if (!toEmail || !text) {
    if (!objectId && !messageId) {
      console.log("[webhook] IGNORE missing { toEmail: false , text: false }");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "missing ids",
      });
    }

    try {
      const res = await fetch(`${baseUrl()}/api/hubspot/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ objectId, messageId }),
      });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) {
        toEmail = toEmail || safeStr(j.toEmail);
        text = text || safeStr(j.text);
        subject = subject || safeStr(j.subject);
        inReplyTo = inReplyTo || safeStr(j.inReplyTo || messageId);
      } else {
        console.log("[webhook] lookup error:", j?.error || res.status);
      }
    } catch (e: any) {
      console.log("[webhook] lookup exception:", e?.message || String(e));
    }
  }

  // If we still don’t have the essentials, keep HubSpot green but do nothing
  if (!toEmail || !text) {
    console.log(
      "[webhook] IGNORE missing { toEmail:",
      !!toEmail,
      ", text:",
      !!text,
      "}"
    );
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "missing toEmail or text",
    });
  }

  // Dry run: echo what we would do, don’t call downstream
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      toEmail,
      subject: subject || "Re: your message",
      inReplyTo,
      text: text.slice(0, 140),
      note: "stub only; no orchestrate/send invoked",
    });
  }

  // Live: forward to AI orchestrator
  try {
    const orchestration = {
      mode: "ai" as const,
      toEmail,
      inReplyTo,
      subject: subject || "Re: your message to Alex-IO",
      text,
      dryRun: false,
      ai: {
        // safe defaults; your orchestrator can enrich/override
        task:
          "Reply like a helpful estimator and move toward quoting. Ask 2–3 crisp questions if specs are incomplete.",
        hints: [
          "Keep it under ~120 words unless extra detail is necessary.",
          "If dimensions are given, confirm units (in/mm).",
          "Foam insert quoting often requires density + thickness under part.",
        ],
      },
    };

    const res = await fetch(`${baseUrl()}/api/ai/orchestrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(orchestration),
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.ok) {
      console.log("[webhook] orchestrate error:", j?.error || res.status);
      return NextResponse.json({
        ok: false,
        error: "orchestrate_failed",
        detail: j?.error || res.statusText || res.status,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "ai",
      toEmail,
      subject: orchestration.subject,
      graph: j?.graph || null, // whatever your orchestrator returns (e.g., msgraph/send status)
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "orchestrate_exception", detail: e?.message || String(e) },
      { status: 500 }
    );
  }
}
