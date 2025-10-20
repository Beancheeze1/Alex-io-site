// app/api/admin/test/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kvPing } from '@/lib/kv';
import { hsGetOwners } from '@/lib/hubspot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(headers: Headers) {
  const sent = headers.get('x-admin-key');
  const need = process.env.ADMIN_KEY || '';
  if (!need) return { ok: false, status: 500, error: 'ADMIN_KEY missing' as const };
  if (sent !== need) return { ok: false, status: 401, error: 'Unauthorized' as const };
  return { ok: true as const };
}

/**
 * GET /api/admin/test
 * - Verifies ADMIN_KEY via "x-admin-key" header
 * - Pings KV (Upstash REST) if envs are present
 * - Calls HubSpot Owners (requires PAT with owners read)
 */
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json(auth, { status: auth.status });

  const checks: {
    env: Record<string, boolean | number | null>;
    kv: { pong?: unknown; error?: string };
    hubspot: { ok?: boolean; sample?: unknown; error?: unknown };
  } = { env: {}, kv: {}, hubspot: {} };

  // Environment presence (no secrets leaked)
  checks.env = {
    ADMIN_KEY: !!process.env.ADMIN_KEY,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    HUBSPOT_PRIVATE_APP_TOKEN: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN,
    HUBSPOT_WEBHOOK_SECRET: !!process.env.HUBSPOT_WEBHOOK_SECRET,
    HUBSPOT_PORTAL_ID: process.env.HUBSPOT_PORTAL_ID
      ? Number(process.env.HUBSPOT_PORTAL_ID) || null
      : null,
  };

  // KV ping (optional)
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      checks.kv.pong = await kvPing();
    } else {
      checks.kv.error = 'kv env missing';
    }
  } catch (e: any) {
    checks.kv.error = String(e?.message ?? e);
  }

  // HubSpot owners (optional)
  try {
    if (process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
      const owners = await hsGetOwners(1);
      checks.hubspot.ok = true;
      checks.hubspot.sample = Array.isArray(owners?.results)
        ? owners.results[0] ?? null
        : owners ?? null;
    } else {
      checks.hubspot.ok = false;
      checks.hubspot.error = 'HUBSPOT_PRIVATE_APP_TOKEN missing';
    }
  } catch (e: any) {
    checks.hubspot.ok = false;
    checks.hubspot.error = { status: e?.status ?? null, detail: e?.data ?? String(e?.message ?? e) };
  }

  return NextResponse.json({ ok: true, route: '_admin/test', ts: Date.now(), checks });
}
