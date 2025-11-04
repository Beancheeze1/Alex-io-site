// app/api/hubspot/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function env(name: string, required = false) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env: ${name}`);
  return v ?? "";
}
function baseFromReq(req: Request) {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}
function getBoolean(v: string | null | undefined) {
  if (!v) return false;
  return /^(1|true|yes|on)$/i.test(v);
}

export async function POST(req: Request) {
  const t0 = Date.now();
  const url = new URL(req.url);
  const dryRunParam = url.searchParams.get("dryRun") === "1";
  const replyEnabled = getBoolean(process.env.REPLY_ENABLED) || getBoolean(process.env.ALEX_REPLY_ENABLED);

  try {
    const arr = (await req.json()) as any[];
    if (!Array.isArray(arr) || arr.length === 0) {
      return NextResponse.json({ ok: true, ignored: true, reason: "empty_payload" });
    }

    const evt = arr.find((x) => String(x?.changeFlag || "").toUpperCase() === "NEW_MESSAGE") || arr[0];
    const objectId = evt?.objectId ?? evt?.threadId ?? evt?.objectID ?? null;
    if (!objectId) return NextResponse.json({ ok: true, ignored: true, reason: "no_objectId" });

    const SELF = env("NEXT_PUBLIC_BASE_URL") || baseFromReq(req);

    // 1) Lookup (tokenless works with HUBSPOT_SKIP_LOOKUP=1)
    const lookupRes = await fetch(`${SELF}/api/hubspot/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ objectId }),
    });
    const lookup = await lookupRes.json().catch(() => ({} as any));
    if (!lookup?.ok) return NextResponse.json({ ok: true, ignored: true, reason: "lookup_failed", lookup });

    // 2) AI
    const respondRes = await fetch(`${SELF}/api/ai/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        toEmail: lookup.email,
        subject: lookup.subject,
        text: lookup.text,
        threadId: lookup.threadId,
        dryRun: dryRunParam || !replyEnabled,
      }),
    });
    const responseAi = await respondRes.json().catch(() => ({} as any));
    if (!responseAi?.ok) return NextResponse.json({ ok: true, ignored: true, reason: "ai_failed", responseAi });

    // 3) Send via Graph (pass internetMessageId when present for threading)
    const sendRes = await fetch(`${SELF}/api/msgraph/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        to: responseAi.to,
        subject: responseAi.subject,
        html: responseAi.html,
        // Prefer internetMessageId to resolve a Graph message id
        internetMessageId: lookup.internetMessageId,
        // If caller passed a real Graph id earlier we still honor it
        threadId: responseAi.threadId,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({} as any));

    console.log("[webhook] OK", {
      dryRun: dryRunParam || !replyEnabled,
      ms: Date.now() - t0,
      mode: sendJson?.mode,
      hasInternetMessageId: !!lookup.internetMessageId,
    });

    return NextResponse.json({
      ok: true,
      dryRun: dryRunParam || !replyEnabled,
      event: { objectId },
      ai: { mode: responseAi?.mode },
      send: sendJson,
    });
  } catch (e: any) {
    console.error("[webhook] ERROR", e?.message || String(e));
    return NextResponse.json({ ok: false, error: e?.message || "webhook_exception" }, { status: 500 });
  }
}
