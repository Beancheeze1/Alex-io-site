// app/api/hubspot/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Always use production base for internal calls
const PROD_BASE =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
  "https://api.alex-io.com";

// Utility: safely fetch JSON with error protection
async function safeJsonFetch(path: string, body: any) {
  const url = `${PROD_BASE}${path}?t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json, url };
  } catch (err) {
    return { ok: false, status: 0, json: { error: String(err) }, url };
  }
}

export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const lookupTraces: any[] = [];

  try {
    const payload = await req.json();
    console.log("[webhook] received", payload);

    const subType = payload.subscriptionType;
    const objectId = payload.objectId;
    const inReplyTo = payload.messageId || payload.threadId || null;

    if (subType !== "conversation.newMessage" || !objectId) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "not_new_message_or_missing_id" },
        { status: 200 }
      );
    }

    // ---- 1️⃣  Lookup email via production URL ----
    const lookupRes = await safeJsonFetch("/api/hubspot/lookupEmail", {
      objectId,
    });
    lookupTraces.push({
      path: "/api/hubspot/lookupEmail",
      url: lookupRes.url,
      ok: lookupRes.ok,
      status: lookupRes.status,
    });

    const toEmail = lookupRes.json?.email;
    if (!toEmail) {
      const res = {
        ok: true,
        dryRun,
        send_ok: false,
        reason: "missing_toEmail",
        lookup_traces: lookupTraces,
      };
      console.log("[webhook] missing_toEmail", res);
      return NextResponse.json(res, { status: 200 });
    }

    // ---- 2️⃣  Pass to orchestrator (/api/ai/orchestrate) ----
    const orchRes = await safeJsonFetch("/api/ai/orchestrate", {
      mode: "ai",
      toEmail,
      subject: lookupRes.json?.subject || "(no subject)",
      text: lookupRes.json?.text || "",
      inReplyTo,
      dryRun,
    });
    lookupTraces.push({
      path: "/api/ai/orchestrate",
      url: orchRes.url,
      ok: orchRes.ok,
      status: orchRes.status,
    });

    const result = {
      ok: true,
      dryRun,
      send_ok: orchRes.ok,
      toEmail,
      lookup_traces: lookupTraces,
    };
    console.log("[webhook] done", result);
    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    console.error("[webhook] fatal", err);
    return NextResponse.json(
      { ok: false, error: String(err), lookup_traces: lookupTraces },
      { status: 500 }
    );
  }
}
