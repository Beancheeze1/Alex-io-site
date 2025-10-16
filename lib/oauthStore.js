// lib/oauthStore.js

/**
 * In-memory token store.
 * Keyed by hubId (portalId).
 * You can swap this to Redis/DB later; the API stays the same.
 */

const mem = new Map(); // hubId -> { access_token, refresh_token, expires_at, scopes:[], saved_at:number }

/** Save tokens for a hub */
export function saveToken(hubId, tokenJson) {
  const now = Date.now();
  const expires_at = tokenJson.expires_in
    ? now + tokenJson.expires_in * 1000 - 30_000 // minus 30s safety
    : undefined;

  const record = {
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
    expires_at,
    scopes: tokenJson.scopes || [],
    saved_at: now,
  };

  mem.set(String(hubId), record);
  return record;
}

/** Optional: remember which hub you're “on” right now */
let currentHubId = null;
export function setPortal(hubId) {
  currentHubId = String(hubId);
}
export function getCurrentPortal() {
  return currentHubId;
}

/** Get raw record (or undefined) */
export function getRecord(hubId) {
  return mem.get(String(hubId));
}

/** Get a fresh access token, refreshing if needed (uses env CLIENT_ID/SECRET) */
export async function getAccessToken(hubId) {
  const rec = mem.get(String(hubId));
  if (!rec) return null;

  // If token is still valid, return it.
  if (!rec.expires_at || Date.now() < rec.expires_at) {
    return rec.access_token;
  }

  // No refresh token? We’re stuck.
  if (!rec.refresh_token) return null;

  // Try to refresh.
  const refreshed = await refreshToken(rec.refresh_token);
  if (!refreshed.ok) return null;

  // Save the new tokens against the same hub
  saveToken(hubId, refreshed.token);
  return mem.get(String(hubId)).access_token;
}

/** Low-level refresh call */
export async function refreshToken(refresh_token) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.HUBSPOT_CLIENT_ID,
    client_secret: process.env.HUBSPOT_CLIENT_SECRET,
    refresh_token,
  });

  try {
    const r = await fetch("https://api.hubapi.com/oauth/v1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return { ok: false, error: "refresh_failed", detail: j };
    }

    // HubSpot does not include scopes in the refresh response.
    return { ok: true, token: j };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
