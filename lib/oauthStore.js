// lib/oauthStore.js
/**
 * Minimal shim so admin routes compile on Vercel.
 * Path-A: provides the named exports your routes expect.
 * Later we can swap these to your real store (Upstash/DB OAuth tokens).
 */

/** @typedef {{
 *  accessToken: string | null,
 *  refreshToken?: string | null,
 *  expiresAt?: number | null,
 *  portalId?: number | null
 * }} TokenBundle */

/** @returns {Promise<TokenBundle>} */
export async function getToken() {
  const token =
    process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
    process.env.HUBSPOT_ACCESS_TOKEN ||
    null;

  const portalId = process.env.HUBSPOT_PORTAL_ID
    ? Number(process.env.HUBSPOT_PORTAL_ID)
    : null;

  return {
    accessToken: token || null,
    refreshToken: null,
    expiresAt: null,
    portalId
  };
}

/** no-op setters to satisfy imports */
export async function setToken(_bundle) {
  return true;
}

export async function clearToken() {
  return true;
}

/** keep signature simple; used by some routes during checks */
export async function ensureValidToken() {
  return getToken();
}

/**
 * Some preview/export routes import renderQuotePdf from oauthStore.
 * Provide a harmless stub to avoid build-time failures.
 * Return a Uint8Array so callers can .byteLength safely.
 */
export async function renderQuotePdf(_args) {
  return new Uint8Array(); // placeholder empty PDF bytes
}
