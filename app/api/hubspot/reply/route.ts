// app/api/hubspot/reply/route.ts
import { NextResponse } from "next/server";
import { tokenStore } from "@/lib/tokenStore";
import { hsFetch } from "@/lib/hubspot";
import { requireEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/hubspot/reply?portal=244053164
 * Headers:
 *   x-admin-key: <ADMIN_KEY>
 * Body (JSON):
 *   { "threadId": number|string, "text": string }
 *
 * Notes:
 * - Uses Conversations v3: POST /conversations/v3/conversations/threads/{threadId}/messages
 * - HubSpot may evolve this API; we pass through the response body for visibility.
 */
export async function POST(req: Request) {
  requireEnv();

  // --- auth gate
  const adminKey = process.env.ADMIN_KEY || "";
  const hdr = new Headers(req.headers).get("x-admin-key") || "";
  if (!adminKey || hdr !== adminKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // --- parse JSON body
  let payload: any;
  try {
    // Some clients mislabel Content-Type or send unusual encodings.
    // Read raw text first; then try JSON.parse; fall back to req.json().
    const raw = await req.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    try {
      payload = await req.json(); // fallback if raw parse failed
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
}

  const text = String(payload?.text || "").trim();
  const threadIdRaw = payload?.threadId ?? payload?.thread_id ?? payload?.thread;
  const threadId =
    typeof threadIdRaw === "number"
      ? threadIdRaw
      : typeof threadIdRaw === "string" && /^\d+$/.test(threadIdRaw)
      ? Number(threadIdRaw)
      : undefined;

  if (!text || !threadId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing required fields",
        hint: "Body must include { text: string, threadId: number|string }",
      },
      { status: 400 }
    );
  }

  // --- select portal (optional)
  const url = new URL(req.url);
  const portalParam = url.searchParams.get("portal");
  const portal =
    portalParam && /^\d+$/.test(portalParam) ? Number(portalParam) : undefined;

  const bundle = tokenStore.get(portal);
  if (!bundle?.access_token) {
    return NextResponse.json(
      { ok: false, error: "No token available for requested portal/default" },
      { status: 400 }
    );
  }

  // --- build request to HubSpot Conversations API
  const path = `/conversations/v3/conversations/threads/${encodeURIComponent(
    String(threadId)
  )}/messages`;

  // minimal message body; HubSpot accepts "type": "MESSAGE" with "text"
  const body = JSON.stringify({
    type: "MESSAGE",
    text,
  });

  try {
    const r = await hsFetch(bundle, path, {
      method: "POST",
      body,
    });

    const data = await r
      .json()
      .catch(async () => ({ raw: await r.text().catch(() => "") }));

    if (!r.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: r.status,
          statusText: r.statusText,
          error: data?.message || "HubSpot error",
          data,
        },
        { status: r.status }
      );
    }

    return NextResponse.json({
      ok: true,
      portal: portal ?? bundle.hubId ?? "default",
      threadId,
      data,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}

// Optional: reject GET clearly
export function GET() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
