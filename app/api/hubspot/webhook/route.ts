// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- tiny helpers
const j = (v: unknown) => {
  try { return JSON.stringify(v); } catch { return String(v); }
};
const pick = (o: any, p: string[]) =>
  p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);

function normalizeBody(body: any): any[] {
  // HubSpot can send a single object or an array
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") return [body];
  return [];
}

function shallow(evt: any) {
  const message = evt?.message ?? evt?.object?.message ?? {};
  const text = message?.text ?? message?.richText ?? "";
  const headers = message?.headers ?? {};
  const hasEmail = !!(message?.from?.email);
  const hasText = typeof text === "string" && text.trim().length > 0;

  const messageId =
    headers["Message-Id"] ||
    headers["message-id"] ||
    headers["MESSAGE-ID"] ||
    evt?.messageId ||
    evt?.object?.messageId ||
    null;

  const objectId = evt?.objectId ?? evt?.threadId ?? null;

  return { hasEmail, hasText, messageId, objectId };
}

// ---- GET: cheap reachability ping (keep for visibility while debugging)
export async function GET(req: NextRequest) {
  console.log("//// [webhook] GET PING", req.nextUrl.pathname, req.nextUrl.search);
  // If you want HubSpot GETs to fail (so you can spot a misconfigured method), uncomment:
  // return NextResponse.json({ ok: true, method: "GET" }, { status: 405 });
  return NextResponse.json({ ok: true, method: "GET" });
}

// ---- POST: real handler
export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    console.log("//// [webhook] ARRIVE {");

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") === "1";

    let body: any;
    try {
      body = await req.json();
    } catch (e: any) {
      console.log("[webhook] bad json:", e?.message);
      return NextResponse.json({ ok: true, ignored: true, reason: "bad_json" });
    }

    const events = normalizeBody(body);
    console.log("[webhook] subtype:", {
      subscriptionType: String(events[0]?.subscriptionType ?? undefined),
      messageType: events[0]?.messageType ?? null,
      changeFlag: events[0]?.changeFlag ?? undefined,
    });

    if (events.length === 0) {
      console.log("[webhook] empty body -> IGNORE");
      return NextResponse.json({ ok: true, ignored: true, reason: "no_events" });
    }

    // Only look at first for now (HubSpot batches, we’ll still log each shallow)
    const first = events[0];
    const s = shallow(first);
    console.log("[webhook] shallow extract ->", j(s));

    if (!s.hasEmail || !s.hasText) {
      console.log("[webhook] IGNORE missing { toEmail:", s.hasEmail, ", text:", s.hasText, "}");
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: "missing toEmail or text",
      });
    }

    if (dryRun) {
      console.log("[webhook] DRY RUN ok");
      return NextResponse.json({ ok: true, dryRun: true });
    }

    // 🔧 Wire your AI or orchestrator call here (kept minimal for now)
    // Example “kick” (uncomment when your /api/ai/orchestrate is live again):
    //
    // const kick = await fetch(new URL("/api/ai/orchestrate", url).toString(), {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     mode: "ai",
    //     toEmail: first?.message?.from?.email,
    //     inReplyTo: s.messageId,
    //     subject: "Re: (auto)",
    //     text: first?.message?.text ?? "",
    //   }),
    // });
    // const kickText = await kick.text();
    // console.log("[webhook] orchestrate status=%d body=%s", kick.status, kickText.slice(0, 400));

    console.log("[webhook] OK ms=%d", Date.now() - started);
    return NextResponse.json({ ok: true, handled: true, ms: Date.now() - started });
  } catch (err: any) {
    console.log("[webhook] ERROR", err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  } finally {
    console.log("//// [webhook] }");
  }
}
