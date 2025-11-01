// app/api/admin/responder/route.ts
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function j(o: any) {
  try { return JSON.stringify(o); } catch { return String(o); }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const t0 = Date.now();

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    console.log("[responder] invalid json body");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const objId = body?.objId ?? "";
  const base = process.env.NEXT_PUBLIC_BASE_URL || "https://api.alex-io.com";
  const from = process.env.MS_MAILBOX_FROM || "";
  const testTo = from; // smoke test: send back to our mailbox so we can verify quickly

  console.log("[responder] start", { objId, base, from, hasTenant: !!process.env.MS_TENANT_ID });

  // Safety: if Graph envs aren’t present, bail early with 200 so HubSpot stops retrying,
  // but tell us clearly in logs.
  if (!process.env.MS_TENANT_ID || !process.env.MS_CLIENT_ID || !process.env.MS_CLIENT_SECRET || !from) {
    console.log("[responder] missing Graph envs; returning 200 to stop HubSpot retries");
    return NextResponse.json({ ok: true, skipped: "missing_graph_envs" });
  }

  // Call the existing Graph sender route you already proved working
  try {
    const r = await fetch(`${base}/api/msgraph/send?t=${Date.now()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // loop tag you were using in tests
        "X-AlexIO-Sent": "1",
      },
      body: JSON.stringify({
        to: testTo,
        subject: `[Alex-IO] Webhook smoke test (objId: ${objId})`,
        html: `<p>Webhook reached responder ✅</p>
               <p>objId: <code>${objId || "(none)"}</code></p>
               <p>ts: ${new Date().toISOString()}</p>`,
      }),
    });

    const text = await r.text();
    console.log("[responder] graph result", { status: r.status, body: text?.slice(0, 400) });

    // Return 200 so HubSpot treats it as delivered; include downstream status for our logs
    return NextResponse.json({
      ok: r.ok,
      graphStatus: r.status,
      tookMs: Date.now() - t0,
    }, { status: 200 });
  } catch (err: any) {
    console.log("[responder] graph exception", j(String(err)));
    // Still return 200 to stop retry storms, but flag failure
    return NextResponse.json({
      ok: false,
      error: String(err),
      tookMs: Date.now() - t0,
    }, { status: 200 });
  }
}

// Optional: provide GET to avoid 405 if someone pings it by hand
export async function GET() {
  return NextResponse.json({ ok: true, route: "admin/responder" });
}
