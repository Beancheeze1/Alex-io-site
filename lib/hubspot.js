// lib/hubspot.js
/**
 * HubSpot minimal client for OAuth + helpers.
 * Path-A: small, focused functions used by your routes.
 *
 * Required env:
 *  - HUBSPOT_CLIENT_ID
 *  - HUBSPOT_CLIENT_SECRET
 *  - HUBSPOT_REDIRECT_URI  (must match HubSpot app config)
 *
 * Optional env:
 *  - HUBSPOT_PRIVATE_APP_TOKEN (fallback for hsGetOwners via oauthStore)
 */

import { getAccessToken } from "@/lib/oauthStore.js";

const HS_API = "https://api.hubapi.com";
const HS_TOKEN_URL = `${HS_API}/oauth/v1/token`;

/** Small helper for x-www-form-urlencoded body */
function formBody(obj) {
  return new URLSearchParams(Object.entries(obj)).toString();
}

/**
 * Exchange OAuth "code" for tokens.
 * Returns { access_token, refresh_token, expires_in, ... } on success.
 */
export async function exchangeCodeForTokens(code, overrideRedirectUri) {
  const client_id = process.env.HUBSPOT_CLIENT_ID;
  const client_secret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirect_uri = overrideRedirectUri || process.env.HUBSPOT_REDIRECT_URI;

  if (!client_id || !client_secret || !redirect_uri) {
    return { ok: false, error: "missing_env", detail: "HUBSPOT_CLIENT_ID/SECRET/REDIRECT_URI not set" };
  }

  const res = await fetch(HS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: formBody({
      grant_type: "authorization_code",
      client_id,
      client_secret,
      redirect_uri,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "exchange_failed", status: res.status, detail: text };
  }

  const data = await res.json();
  return { ok: true, ...data };
}

/**
 * Refresh an access token using refresh_token.
 * Returns { access_token, expires_in, refresh_token? } on success.
 */
export async function refreshTokens(refresh_token) {
  const client_id = process.env.HUBSPOT_CLIENT_ID;
  const client_secret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!client_id || !client_secret || !refresh_token) {
    return { ok: false, error: "missing_env_or_token" };
  }

  const res = await fetch(HS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: formBody({
      grant_type: "refresh_token",
      client_id,
      client_secret,
      refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "refresh_failed", status: res.status, detail: text };
  }

  const data = await res.json();
  return { ok: true, ...data };
}

/**
 * Introspect an access token (HubSpot: GET /oauth/v1/access-tokens/:token).
 * Returns token metadata or {ok:false} on failure.
 */
export async function introspect(accessToken) {
  const token = accessToken || (await getAccessToken());
  if (!token) return { ok: false, error: "no_token" };

  const res = await fetch(`${HS_API}/oauth/v1/access-tokens/${token}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "introspect_failed", status: res.status, detail: text };
  }

  const data = await res.json();
  return { ok: true, ...data };
}

/**
 * Owners helper used by admin checks.
 * Works with a valid access token (env or oauthStore).
 */
export async function hsGetOwners() {
  const token = await getAccessToken();
  if (!token) return [];

  const res = await fetch(`${HS_API}/crm/v3/owners`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

export default {
  exchangeCodeForTokens,
  refreshTokens,
  introspect,
  hsGetOwners,
};
