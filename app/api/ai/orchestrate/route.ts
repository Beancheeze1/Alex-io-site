import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type In = {
  mode?: "live" | "ai";
  toEmail?: string;
  subject?: string;
  text?: string;
  inReplyTo?: string | null;
  dryRun?: boolean;
};

export async function POST(req: NextRequest) {
  const started = Date.now();
  try {
    const body = (await req.json().catch(() => ({}))) as In;

    const replyEnabled = (process.env.REPLY_ENABLED ?? "").toLowerCase() === "true";
    const dryRun = Boolean(body.dryRun) || !replyEnabled;

    // STRICT: never allow the demo placeholder through
    const toEmail = String(body.toEmail ?? "").trim();
    if (!toEmail || toEmail.toLowerCase() === "you@example.com") {
      return NextResponse.json(
        { ok: true, dryRun, send_ok: false, reason: "missing_toEmail" },
        { status: 200 },
      );
    }

    const payload = {
      mode: "live",
      toEmail,
      subject: String(body.subject ?? "").trim(),
      text: String(body.text ?? "").trim(),
      inReplyTo: body.inReplyTo ?? null,
      dryRun,
    };

    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/msgraph/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));

    return NextResponse.json(
      {
        ok: true,
        dryRun,
        send_ok: Boolean(j?.ok),
        toEmail,
        ms: Date.now() - started,
        result: j,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "orchestrate_exception" },
      { status: 200 },
    );
  }
}
