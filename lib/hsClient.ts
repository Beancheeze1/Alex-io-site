// lib/hsClient.ts — Path A: no alias imports
import { tokenStore, TokenRecord } from "./tokenStore";
import { refreshTokens } from "./hubspot";

/**
 * Return a valid access token for a given portalId.
 * - Refreshes if expiring within 60s
 * - Persists the refreshed token in tokenStore
 */
export async function getPortalAccessToken(portalId: string | number): Promise<string> {
  const rec = (await tokenStore.get(portalId)) as TokenRecord | null;
  if (!rec) throw new Error(`no token for portal ${portalId}`);

  const now = Math.floor(Date.now() / 1000);
  const needsRefresh = (rec.expires_at ?? 0) - now < 60;

  if (!needsRefresh) return rec.access_token;

  const updated = await refreshTokens(rec.refresh_token);
  const expires_at = Math.floor(Date.now() / 1000) + (updated.expires_in || 3600);

  await tokenStore.set(portalId, {
    access_token: updated.access_token,
    refresh_token: updated.refresh_token || rec.refresh_token, // HS may omit refresh_token on refresh
    expires_at,
    hub_id: (rec as any).hub_id,
    user_id: (rec as any).user_id,
    scopes: (rec as any).scopes
  });

  return updated.access_token;
}

/**
 * Convenience fetch that:
 *  - attaches Authorization: Bearer
 *  - JSON-serializes body when you pass an object
 *  - throws on non-2xx with response text
 */
export async function hsFetch(
  portalId: string | number,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getPortalAccessToken(portalId);

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  let body = init.body as any;
  if (body && typeof body === "object" && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
    body = JSON.stringify(body);
  }

  const res = await fetch(url, { ...init, headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${text || res.statusText}`);
  }
  return res;
}
