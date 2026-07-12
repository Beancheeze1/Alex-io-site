// app/api/admin/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

async function getLastWebhook() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const getUrl = new URL(`${url}/get/${encodeURIComponent("hubspot:last-webhook")}`);
    const r = await fetch(getUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json(); // { result: "..." }
    if (j?.result) return JSON.parse(j.result);
  } catch {}
  return null;
}

async function tokensStatus() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { persisted: false };
  try {
    const getUrl = new URL(`${url}/get/${encodeURIComponent("hubspot:tokens")}`);
    const r = await fetch(getUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!j?.result) return { persisted: false };
    const t = JSON.parse(j.result);
    return {
      persisted: true,
      hasAccessToken: !!t?.access_token,
      hasRefreshToken: !!t?.refresh_token,
      expiresIn: t?.expires_in ?? null,
    };
  } catch {
    return { persisted: false };
  }
}

export async function GET(req: NextRequest) {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const status = await tokensStatus();
  const last = await getLastWebhook();
  return NextResponse.json({
    ok: true,
    service: "alex-io",
    ts: Date.now(),
    hubspot: status,
    lastWebhook: last,
  });
}
