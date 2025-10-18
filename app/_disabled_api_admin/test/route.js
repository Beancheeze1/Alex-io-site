// app/api/admin/test/route.js
import { NextResponse } from "next/server";
import { kvPing } from "@/lib/kv";
import { hsGetOwners } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(headers) {
  const sent = headers.get("x-admin-key");
  const need = process.env.ADMIN_KEY || "";
  if (!need) return { ok: false, status: 500, error: "ADMIN_KEY missing" };
  if (sent !== need) return { ok: false, status: 401, error: "Unauthorized" };
  return { ok: true };
}

/** GET /api/admin/test
 *  - Verifies ADMIN_KEY
 *  - Pings KV (Redis/Upstash/memory)
 *  - Calls a trivial HubSpot endpoint to confirm token works
 */
export async function GET(req) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const checks = { env: {}, kv: {}, hubspot: {} };

  // Env presence
  checks.env = {
    ADMIN_KEY: !!process.env.ADMIN_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    HUBSPOT_WEBHOOK_SECRET: !!process.env.HUBSPOT_WEBHOOK_SECRET,
    HUBSPOT_PORTAL_ID: Number(process.env.HUBSPOT_PORTAL_ID || 0) || null,
  };

  // KV ping
  try {
    checks.kv.pong = await kvPing();
  } catch (e) {
    checks.kv.error = String(e?.message || e);
  }

  // HubSpot token sanity (no special scopes; reads owners)
  try {
    const owners = await hsGetOwners(1);
    checks.hubspot.ok = true;
    checks.hubspot.sample = Array.isArray(owners?.results) ? owners.results[0] ?? null : owners;
  } catch (e) {
    checks.hubspot.ok = false;
    checks.hubspot.error = { status: e?.status || null, detail: e?.data || String(e?.message || e) };
  }

  return NextResponse.json({ ok: true, checks });
}
