// app/api/auth/peek/route.ts
import { NextResponse } from 'next/server';
import { tokenStore } from '@/lib/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/peek?portal=244053164
 * - Returns whether we have tokens cached for the given portal (hub_id).
 * - If no portal is provided, checks the default slot.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const portalParam = searchParams.get('portal');
  const portal = portalParam ? Number(portalParam) : undefined;

  const rec = tokenStore.get(portal);
  if (!rec) {
    return NextResponse.json({
      ok: true,
      portal: portal ?? '_default',
      exists: false,
    });
  }

  // Don’t leak tokens—just indicate presence and basic metadata
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
