// app/api/auth/hubspot/callback/route.js
import { NextResponse } from 'next/server';
import { exchangeCodeForTokens, introspect } from '@/lib/hubspot';
import { tokenStore } from '@/lib/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');
    const state = searchParams.get('state');

    if (error) {
      return NextResponse.json({ ok: false, stage: 'auth', error, errorDesc, state }, { status: 400 });
    }
    if (!code) {
      return NextResponse.json({ ok: false, stage: 'auth', error: 'missing_code', state }, { status: 400 });
    }

    const clientId = process.env.HUBSPOT_OAUTH_CLIENT_ID || '';
    const clientSecret = process.env.HUBSPOT_OAUTH_CLIENT_SECRET || '';
    const redirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI || '';

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.json(
        { ok: false, error: 'OAuth env missing (HUBSPOT_OAUTH_CLIENT_ID/_SECRET/_REDIRECT_URI)' },
        { status: 500 }
      );
    }

    const tokens = await exchangeCodeForTokens({ code, clientId, clientSecret, redirectUri });

    // Discover portal ID via introspection, then save tokens under that portal key
    let info = null;
    let portal = null;
    try {
      info = await introspect(tokens?.access_token);
      portal = typeof info?.hub_id === 'number' ? info.hub_id : null;
    } catch (e) {
      info = { error: String(e?.message ?? e) };
    }

    const key = tokenStore.save(tokens, portal ?? undefined);

    return NextResponse.json({
      ok: true,
      state,
      savedUnder: key,
      portal,
      tokens: {
        access_token: tokens?.access_token ? '***' : null,
        refresh_token: tokens?.refresh_token ? '***' : null,
        expires_in: tokens?.expires_in ?? null,
        token_type: tokens?.token_type ?? null,
      },
      info,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, stage: 'callback', error: String(e?.message ?? e), detail: e?.data ?? null, status: e?.status ?? null },
      { status: 500 }
    );
  }
}
