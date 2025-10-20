// app/api/auth/peek/route.js
import { NextResponse } from 'next/server';
import { tokenStore } from '@/lib/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const portalParam = searchParams.get('portal');
  const portal = portalParam ? Number(portalParam) : undefined;

  const rec = tokenStore.get(portal);
  if (rec) {
    return NextResponse.json({
      ok: true,
      portal: portal ?? '_default',
      exists: true,
      meta: {
        token_type: rec.token_type ?? null,
        expires_in: rec.expires_in ?? null,
        has_refresh: !!rec.refresh_token,
        has_access: !!rec.access_token,
      },
    });
  }

  // If a portal was provided but nothing is found, also show whether the default has something
  const def = portal !== undefined ? tokenStore.get() : null;

  return NextResponse.json({
    ok: true,
    portal: portal ?? '_default',
    exists: false,
    defaultExists: def ? true : false,
  });
}
