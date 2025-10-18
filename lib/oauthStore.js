import { refreshTokens } from "@/lib/hubspot.js";

const KV_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function kvGet(key) {
  if (KV_URL && KV_TOKEN) {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }, cache: "no-store"
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.result ?? null;
  }
  return global.__MEM_KV__?.[key] ?? null;
}
async function kvSet(key, val) {
  if (KV_URL && KV_TOKEN) {
    const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ value: val })
    });
    return r.ok;
  }
  global.__MEM_KV__ = global.__MEM_KV__ || {};
  global.__MEM_KV__[key] = val;
  return true;
}
async function kvDel(key) {
  if (KV_URL && KV_TOKEN) {
    await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, { method: "POST", headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    return true;
  }
  if (global.__MEM_KV__) delete global.__MEM_KV__[key];
  return true;
}

const KEY = "hubspot:oauth:bundle";

export async function getToken() {
  const envToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;
  if (envToken) {
    return {
      accessToken: envToken,
      refreshToken: null,
      expiresAt: null,
      portalId: process.env.HUBSPOT_PORTAL_ID ? Number(process.env.HUBSPOT_PORTAL_ID) : null
    };
  }
  return (await kvGet(KEY)) ?? { accessToken: null };
}

export async function setToken(bundle) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = bundle.expiresAt ?? (bundle.expires_in ? now + Number(bundle.expires_in) : null);
  const clean = {
    accessToken: bundle.accessToken || bundle.access_token || null,
    refreshToken: bundle.refreshToken || bundle.refresh_token || null,
    expiresAt,
    portalId:
      bundle.portalId ?? bundle.hub_id ??
      (typeof bundle.portal_id === "string" ? Number(bundle.portal_id) : bundle.portal_id) ?? null
  };
  await kvSet(KEY, clean);
  return true;
}

export async function clearToken() { await kvDel(KEY); return true; }
export async function getAccessToken() { const t = await getToken(); return t?.accessToken ?? null; }

export async function ensureValidToken() {
  const t = await getToken();
  if (!t?.accessToken) return t;
  const now = Math.floor(Date.now() / 1000);
  if (t.refreshToken && t.expiresAt && t.expiresAt - now < 60) {
    const r = await refreshTokens(t.refreshToken);
    if (r?.ok && r.access_token) {
      await setToken({
        accessToken: r.access_token,
        refreshToken: r.refresh_token || t.refreshToken,
        expires_in: r.expires_in,
        portalId: t.portalId ?? null
      });
      return await getToken();
    }
  }
  return t;
}

// compatibility stubs
export async function renderQuotePdf() { return new Uint8Array(); }
export async function getRecord() { return null; }
