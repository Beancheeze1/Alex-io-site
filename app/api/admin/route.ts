import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!process.env.BOT_ADMIN_ENABLED) {
    return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
  }
  return NextResponse.json(
    {
      ok: true,
      endpoints: [
        { path: "/api/health", purpose: "Liveness" },
        { path: "/api/admin", purpose: "This index" },
        { path: "/api/admin/ping", purpose: "Diagnostic" },
        { path: "/api/admin/whoami", purpose: "OAuth/PrivateApp check" },
        { path: "/api/auth/hubspot", purpose: "Begin OAuth" },
        { path: "/api/auth/hubspot/callback", purpose: "OAuth callback" },
        { path: "/api/hubspot/webhook", purpose: "Webhook receiver" }
      ]
    },
    { status: 200 }
  );
}
