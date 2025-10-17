// lib/hubspot.ts — clean, named-exports only

const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const INTROSPECT_URL = "https://api.hubapi.com/oauth/v1/access-tokens";

const CLIENT_ID = process.env.HUBSPOT_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.HUBSPOT_REDIRECT_URI ?? "";

export type OAuthTokenResp = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export async function exchangeCodeForTokens(code: string): Promise<OAuthTokenResp> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    throw new Error(`exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as OAuthTokenResp;
}

export async function refreshTokens(refresh_token: string): Promise<OAuthTokenResp> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as OAuthTokenResp;
}

export async function introspect(access_token: string) {
  const res = await fetch(`${INTROSPECT_URL}/${access_token}`);
  if (!res.ok) {
    throw new Error(`introspect failed: ${res.status} ${await res.text()}`);
  }
  return await res.json(); // { hub_id, user_id, scopes, expires_in, ... }
}
