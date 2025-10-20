// lib/hsClient.ts
// Helper to retrieve a valid access token for a given HubSpot portal (hub_id).
// If the token looks expired (or close), it will attempt a refresh and persist it.

import { tokenStore, TokenRecord } from './tokenStore';
import { refreshTokens } from './hubspot';

function isExpired(rec: NonNullable<TokenRecord>): boolean {
  // Consider expired if we have an expires_in and obtained_at and we're within a 60s grace window.
  if (!rec.expires_in || !rec.obtained_at) return false;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = rec.obtained_at + rec.expires_in;
  return now >= (expiresAt - 60); // refresh if within last 60s
}

/**
 * Get a valid access token for a portal.
 * - Throws if we have no record and cannot refresh.
 * - Uses OAuth client env vars to perform refresh:
 *   HUBSPOT_OAUTH_CLIENT_ID, HUBSPOT_OAUTH_CLIENT_SECRET, HUBSPOT_OAUTH_REDIRECT_URI
 */
export async function getPortalAccessToken(portalId: string | number): Promise<string> {
  const rec = tokenStore.get(portalId) as NonNullable<TokenRecord> | null;
  if (!rec) throw new Error(`No tokens stored for portal ${portalId}`);

  // If not expired, return as-is
  if (!isExpired(rec)) {
    if (!rec.access_token) throw new Error(`No access_token for portal ${portalId}`);
    return rec.access_token;
  }

  // Need to refresh
  if (!rec.refresh_token) {
    throw new Error(`Token expired and no refresh_token available for portal ${portalId}`);
  }

  const clientId = process.env.HUBSPOT_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.HUBSPOT_OAUTH_CLIENT_SECRET || '';
  const redirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI || '';
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('OAuth client env missing (HUBSPOT_OAUTH_CLIENT_ID/_SECRET/_REDIRECT_URI)');
  }

  const refreshed = await refreshTokens({
    refreshToken: rec.refresh_token,
    clientId,
    clientSecret,
    redirectUri,
  });

  // Persist the refreshed tokens; carry over refresh_token if HubSpot omits it in response
  tokenStore.update(
    {
      access_token: refreshed?.access_token ?? rec.access_token,
      refresh_token: refreshed?.refresh_token ?? rec.refresh_token,
      expires_in: refreshed?.expires_in ?? rec.expires_in,
      token_type: refreshed?.token_type ?? rec.token_type,
    },
    portalId
  );

  const after = tokenStore.get(portalId) as NonNullable<TokenRecord> | null;
  if (!after?.access_token) throw new Error(`Failed to obtain access_token for portal ${portalId} after refresh`);

  return after.access_token;
}
