// app/api/admin/responder/route.ts
import { NextResponse } from "next/server";
import { sendGraphMail } from "@/lib/msgraph";

export const dynamic = "force-dynamic";

function bool(v: string | undefined, def = false) {
  if (v == null) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

// Simple responder endpoint used by your webhook handler.
export async function POST(req: Request) {
  try {
    const replyEnabled = bool(process.env.REPLY_ENABLED, false);

    const payload = (await req.json().catch(() => ({}))) as {
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    };

    // Fallback demo content so you can hit it directly if needed.
    const to = payload.to || "sales@alex-io.com";
    const subject = payload.subject || "[Alex-IO] Webhook smoke test";
    const html =
      payload.html ||
      `<p>Webhook reached responder ✅</p><p>ts: ${new Date().toISOString()}</p>`;
    const text = payload.text;

    if (!replyEnabled) {
      return NextResponse.json({
        ok: false,
        sent: false,
        action: "no-responder",
        note: "reply disabled by REPLY_ENABLED",
      });
    }

    const result = await sendGraphMail({ to, subject, html, text });

    return NextResponse.json({
      ok: result.ok,
      sent: result.ok,
      action: "graph-send",
      graphStatus: result.status,
      requestId: result.requestId ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        sent: false,
        action: "error",
        error: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}

// Optional GET to make curl -i checks easy
export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/admin/responder" });
}
