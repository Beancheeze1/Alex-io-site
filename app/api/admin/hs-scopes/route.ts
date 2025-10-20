import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(headers: Headers) {
  const sent = headers.get('x-admin-key');
  const need = process.env.ADMIN_KEY || '';
  if (!need) return { ok: false, status: 500, error: 'ADMIN_KEY missing' as const };
  if (sent !== need) return { ok: false, status: 401, error: 'Unauthorized' as const };
  return { ok: true as const };
}

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req.headers);
  if (!auth.ok) return NextResponse.json(auth, { status: auth.status });

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';
  if (!token) {
    return NextResponse.json({ ok: false, error: 'HUBSPOT_PRIVATE_APP_TOKEN missing' }, { status: 500 });
  }

  const fingerprint = token.slice(0, 6) + '...' + token.slice(-4);
  const url = `https://api.hubapi.com/oauth/v1/access-tokens/${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return NextResponse.json({ ok: false, fingerprint, status: res.status, body: text }, { status: 500 });
  }

  const data = await res.json();
  const { hub_id, user, scopes } = data || {};
  return NextResponse.json({ ok: true, fingerprint, hub_id, user, scopes });
}
