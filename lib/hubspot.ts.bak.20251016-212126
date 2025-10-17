// lib/hubspot.ts
import { tokenStore } from "@/lib/tokenStore";

const HS_OAUTH_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HS_INTROSPECT_URL = "https://api.hubapi.com/oauth/v1/access-tokens"; // /:access_token

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID!;
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET!;
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI!;
const REQUIRED_SCOPES = (process.env.HUBSPOT_OAUTH_SCOPES || "oauth").split(" ").filter(Boolean);

type OAuthTokenResp = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  hub_id?: number;
};

export async function exchangeCodeForTokens(code: string): Promise<OAuthTokenResp> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });

  const res = await fetch(HS_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot token exchange failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as OAuthTokenResp;
  return json;
}

export async function refreshTokens(refresh_token: string): Promise<OAuthTokenResp> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token,
  });

  const res = await fetch(HS_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot token refresh failed: ${res.status} ${text}`);
  }

  return (await res.json()) as OAuthTokenResp;
}

export async function introspect(access_token: string) {
  const res = await fetch(`${HS_INTROSPECT_URL}/${access_token}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token introspect failed: ${res.status} ${text}`);
  }
  // shape includes { hub_id, user_id, token, scopes:[], expires_in, ... }
  return res.json();
}

/**
 * Ensures valid token for a portal: auto-refresh on 401/expiry.
 * @param portalId from introspect hub_id (we store by hub)
 */
export async function withHubSpot(portalId: string | number) {
  async function getValidToken(): Promise<string> {
    const rec = await tokenStore.get(portalId);
    if (!rec) throw new Error(`No token found for portal ${portalId}`);
    const now = Math.floor(Date.now() / 1000);
    if (rec.expires_at - now <= 30) {
      // refresh
      const next = await refreshTokens(rec.refresh_token);
      const expires_at = Math.floor(Date.now() / 1000) + next.expires_in;
      const intros = await introspect(next.access_token);
      await tokenStore.set(intros.hub_id ?? portalId, {
        access_token: next.access_token,
        refresh_token: next.refresh_token || rec.refresh_token, // sometimes not returned
        expires_at,
        hub_id: intros.hub_id,
        user_id: intros.user_id,
        scopes: intros.scopes,
      });
      return next.access_token;
    }
    return rec.access_token;
  }

  return {
    async fetch(path: string, init?: RequestInit) {
      const doFetch = async (): Promise<Response> => {
        const token = await getValidToken();
        const url = path.startsWith("http") ? path : `https://api.hubapi.com${path}`;
        const res = await fetch(url, {
          ...init,
          headers: {
            ...(init?.headers || {}),
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });
        return res;
      };

      let res = await doFetch();
      if (res.status === 401) {
        // force refresh and retry once
        const rec = await tokenStore.get(portalId);
        if (!rec) return res;
        const next = await refreshTokens(rec.refresh_token);
        const expires_at = Math.floor(Date.now() / 1000) + next.expires_in;
        const intros = await introspect(next.access_token);
        await tokenStore.set(intros.hub_id ?? portalId, {
          access_token: next.access_token,
          refresh_token: next.refresh_token || rec.refresh_token,
          expires_at,
          hub_id: intros.hub_id,
          user_id: intros.user_id,
          scopes: intros.scopes,
        });
        res = await doFetch();
      }
      return res;
    },

    REQUIRED_SCOPES,
  };
}
