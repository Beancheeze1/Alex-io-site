// app/api/auth/hubspot/start/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/hubspot/start?state=xyz
 * Add ?debug=1 to get JSON with the exact authorize URL & params instead of redirect.
 *
 * Env required:
 *  - HUBSPOT_OAUTH_CLIENT_ID
 *  - HUBSPOT_OAUTH_REDIRECT_URI
 *  - HUBSPOT_OAUTH_SCOPES   (SPACE-separated, must be a subset of app-configured scopes)
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const state = searchParams.get('state') || 'start';
  const debug = searchParams.get('debug') === '1';

  const clientId = process.env.HUBSPOT_OAUTH_CLIENT_ID || '';
  const redirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI || '';
  const scopes = (process.env.HUBSPOT_OAUTH_SCOPES || '').trim();

  if (!clientId || !redirectUri || !scopes) {
    const msg =
      'Missing env: HUBSPOT_OAUTH_CLIENT_ID, HUBSPOT_OAUTH_REDIRECT_URI, or HUBSPOT_OAUTH_SCOPES';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const authorize = new URL('https://app.hubspot.com/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', scopes);  // SPACE-separated
  authorize.searchParams.set('state', state);

  if (debug) {
    return NextResponse.json({
      ok: true,
      note: 'Open authorizeUrl in a browser to continue the OAuth flow.',
      authorizeUrl: authorize.toString(),
      params: {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        state,
      },
    });
  }

  return NextResponse.redirect(authorize.toString(), { status: 302 });
}
