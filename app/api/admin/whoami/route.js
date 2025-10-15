// works at: /api/_admin/whoami  and  /api/admin/whoami
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok: false, status: 500, error: "ADMIN_KEY missing" };
  if (sent !== need) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

export async function GET(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({
    ok: true,
    hubId: Number(process.env.HUBSPOT_PORTAL_ID || 0) || null,
    env: {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      HUBSPOT_PRIVATE_APP_TOKEN: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN,
      HUBSPOT_WEBHOOK_SECRET: !!process.env.HUBSPOT_WEBHOOK_SECRET,
    },
  });
}
