import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function b(v: any) { return String(v ?? "").toLowerCase() === "true"; }

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const ev = await req.json();

    const sub = String(ev?.subscriptionType ?? ev?.subscription_type ?? "");
    if (!/conversation\.newMessage/i.test(sub)) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }

    const objectId = Number(ev?.objectId ?? ev?.object_id);
    if (!objectId) {
      return NextResponse.json({ ok: true, ignored: true, reason: "missing_objectId" }, { status: 200 });
    }

    const base = process.env.NEXT_PUBLIC_BASE_URL || "";
    const lookupUrl = `${base}/api/hubspot/lookupEmail`;
    const orchUrl = `${base}/api/ai/orchestrate`;

    // 1) lookup real customer email + subject/text
    const lr = await fetch(`${lookupUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectId }),
      cache: "no-store",
    });
    const lookup = await lr.json().catch(() => ({}));

    const toEmail: string = String(lookup?.email ?? "").trim();
    const subject: string = String(lookup?.subject ?? "").trim();
    const text: string = String(lookup?.text ?? "").trim();

    if (!toEmail) {
      return NextResponse.json(
        {
          ok: true,
          dryRun: false,
          send_ok: false,
          reason: "missing_toEmail",
          lookup_traces: [{ path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: lr.ok, status: lr.status }],
        },
        { status: 200 },
      );
    }

    // 2) send via orchestrate (which calls msgraph/send)
    const replyEnabled = b(process.env.REPLY_ENABLED);
    const orchBody = { mode: "live" as const, toEmail, subject, text, inReplyTo: null, dryRun: !replyEnabled };

    const or = await fetch(`${orchUrl}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orchBody),
      cache: "no-store",
    });
    const oj = await or.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: true,
        dryRun: !replyEnabled,
        send_ok: Boolean(oj?.send_ok ?? oj?.ok),
        toEmail,
        ms: Date.now() - started,
        lookup_traces: [{ path: "/api/hubspot/lookupEmail", url: lookupUrl, ok: lr.ok, status: lr.status }],
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "webhook_exception" }, { status: 200 });
  }
}
