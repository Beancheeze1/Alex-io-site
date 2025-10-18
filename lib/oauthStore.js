// lib/oauthStore.js
/**
 * Minimal shim for build-time imports.
 * Replace/extend with your real storage (Upstash/DB) later.
 */

/** @typedef {{
 *   accessToken: string | null,
 *   refreshToken?: string | null,
 *   expiresAt?: number | null,
 *   portalId?: number | null
 * }} TokenBundle */

/** Return whatever token we have from env for now */
export async function getToken() {
  const accessToken =
    process.env.HUBSPOT_PRIVATE_APP_TOKEN ||
    process.env.HUBSPOT_ACCESS_TOKEN ||
    null;

  const portalId = process.env.HUBSPOT_PORTAL_ID
    ? Number(process.env.HUBSPOT_PORTAL_ID)
    : null;

  return {
    accessToken: accessToken || null,
    refreshToken: null,
    expiresAt: null,
    portalId,
  };
}

/** Compatibility aliases some routes expect */
export async function getAccessToken() {
  const { accessToken } = await getToken();
  return accessToken;
}

/** no-ops for now (satisfy imports) */
export async function setToken(_bundle /** @type {TokenBundle} */) { return true; }
export async function clearToken() { return true; }
export async function ensureValidToken() { return getToken(); }

/**
 * Some routes import renderQuotePdf from oauthStore—provide harmless stub.
 * Return a Uint8Array so callers can check .byteLength safely.
 */
export async function renderQuotePdf(_args) {
  return new Uint8Array(); // placeholder empty PDF
}

/**
 * Some admin/debug routes import getRecord; provide a stub.
 * Replace with your real read call if/when needed.
 */
export async function getRecord(_key) {
  return null;
}
