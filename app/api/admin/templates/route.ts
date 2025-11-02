// app/api/admin/templates/route.ts
import { NextResponse } from "next/server";
import { pickTemplate } from "@/app/lib/templates";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const inboxEmail = searchParams.get("inboxEmail");
    const inboxId = searchParams.get("inboxId");
    const channelId = searchParams.get("channelId");
    const showRaw = searchParams.get("show");

    // Optional: quick peek at env if ?show=raw
    if (showRaw) {
      return NextResponse.json({
        ok: true,
        env: !!process.env.REPLY_TEMPLATES_JSON,
        raw: process.env.REPLY_TEMPLATES_JSON || "(none)",
      });
    }

    const ctx = {
      inboxEmail,
      inboxId,
      channelId,
    };

    const template = pickTemplate(ctx);

    return NextResponse.json({
      ok: true,
      inboxEmail,
      inboxId,
      channelId,
      subject: template.subject ?? "(no subject)",
      html: template.html ?? "(no html)",
    });
  } catch (err: any) {
    console.error("TEMPLATE ROUTE ERROR", err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
