import { kv, ns } from "lib/kv";

export type TokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  hubId: number;
  scope?: string;
};

const HS_BASE = "https://api.hubapi.com";
const now = () => Math.floor(Date.now() / 1000);
const env = (name: string, required = true) => {
  const v = process.env[name]; if (!v && required) throw new Error(`Missing env ${name}`); return v!;
};

export function redirectUri(origin?: string) {
  return process.env.HUBSPOT_REDIRECT_URI || `${origin}/api/auth/hubspot/callback`;
}

export function buildAuthUrl(origin?: string) {
  const clientId = env("HUBSPOT_CLIENT_ID");
  const scopes =
    process.env.HUBSPOT_SCOPES ||
    "oauth files crm.objects.deals.read crm.objects.deals.write crm.objects.contacts.read crm.objects.contacts.write crm.objects.owners.read";
  const ruri = encodeURIComponent(redirectUri(origin));
  const state = crypto.randomUUID();
  const url =
    `https://app.hubspot.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${ruri}` +
    `&scope=${encodeURIComponent(scopes)}`;
  return { url, state };
}

export async function saveState(state: string) { await kv.set(ns(`oauth:state:${state}`), 1, { ex: 600 }); }
export async function verifyState(state?: string) {
  if (!state) return false; const ok = await kv.get(ns(`oauth:state:${state}`));
  if (ok) await kv.del(ns(`oauth:state:${state}`)); return !!ok;
}

export async function exchangeCode(code: string, origin?: string) {
  const clientId = env("HUBSPOT_CLIENT_ID");
  const clientSecret = env("HUBSPOT_CLIENT_SECRET");
  const ruri = redirectUri(origin);

  const res = await fetch(`${HS_BASE}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: ruri,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();

  const who = await fetch(`${HS_BASE}/oauth/v1/access-tokens/${data.access_token}`);
  if (!who.ok) throw new Error(`Introspection failed: ${who.status} ${await who.text()}`);
  const whoJson = await who.json();
  const hubId = Number(whoJson.hub_id);

  const token: TokenBundle = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: now() + (data.expires_in ?? 0) - 30,
    hubId,
    scope: data.scope,
  };
  return { token };
}

export async function storeToken(token: TokenBundle) {
  await kv.hset(ns(`hubspot:portal:${token.hubId}`), token);
}
export async function listPortals(): Promise<number[]> {
  const keys = await kv.keys(ns("hubspot:portal:*"));
  return keys.map((k) => Number(k.split(":").pop())).filter((n) => !Number.isNaN(n));
}
export async function getAnyToken(): Promise<TokenBundle | null> {
  const hubs = await listPortals();
  for (const h of hubs) {
    const b = await kv.hget<TokenBundle>(ns(`hubspot:portal:${h}`), "" as any);
    if (b) return b;
  }
  return null;
}
export async function refreshIfNeeded(bundle: TokenBundle): Promise<TokenBundle> {
  if (bundle.expires_at > now()) return bundle;
  const clientId = env("HUBSPOT_CLIENT_ID");
  const clientSecret = env("HUBSPOT_CLIENT_SECRET");
  const res = await fetch(`${HS_BASE}/oauth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: bundle.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const updated: TokenBundle = {
    ...bundle,
    access_token: data.access_token,
    expires_at: now() + (data.expires_in ?? 0) - 30,
    scope: data.scope ?? bundle.scope,
  };
  await storeToken(updated);
  return updated;
}
export async function hsFetch(bundle: TokenBundle, path: string, init?: RequestInit) {
  const tok = await refreshIfNeeded(bundle);
  return fetch(`${HS_BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
  });
}
