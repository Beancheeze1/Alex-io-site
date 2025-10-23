// lib/hubspot.ts
import { tokenStore, type TokenRecord } from "@/lib/tokenStore";
import { randomBytes } from "node:crypto";


const BASE_OAUTH = "https://api.hubapi.com";
const AUTHORIZE = "https://app.hubspot.com/oauth/authorize";

// --- State handling (Upstash if present, else memory) ---
let _kv: any | null = null;
async function getKV() {
  if (_kv) return _kv;
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) { try { const { Redis } = await import("@upstash/redis"); _kv = new Redis({ url, token }); return _kv; } catch {} }
  const mem = new Map<string, number>();
  _kv = { async set(k: string, _v: string, o?: { ex?: number }) { mem.set(k, Date.now() + (o?.ex ?? 600)*1000); },
          async get(k: string) { const t = mem.get(k); return t && Date.now() <= t ? "1" : null; },
          async del(k: string) { mem.delete(k); } };
  return _kv;
}
const NS = (k: string) => `alexio:oauth:${k}`;
export async function saveState(s: string) { const kv = await getKV(); await kv.set(NS(s), "1", { ex: 600 }); }
export async function verifyState(s: string) { const kv = await getKV(); const v = await kv.get(NS(s)); if (v) await kv.del(NS(s)); return !!v; }

// --- Auth URL builder ---

export function buildAuthUrl() {
  const clientId = process.env.HUBSPOT_CLIENT_ID || "";
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI || "";
  const scope = encodeURIComponent(process.env.HUBSPOT_OAUTH_SCOPES || "oauth");
  if (!clientId || !redirectUri) {
    throw new Error("Missing HUBSPOT_CLIENT_ID or HUBSPOT_REDIRECT_URI");
  }
  // IMPORTANT: do NOT include &state here; route will append it
  const url = `${AUTHORIZE}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;
  const state = randomHex();
  return { url, state };
}


function randomHex(bytes = 16): string {
  return randomBytes(bytes).toString("hex");
}


// --- Exchange code ---
export async function exchangeCode(code: string) {
  const clientId = process.env.HUBSPOT_CLIENT_ID || "";
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET || "";
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI || "";
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Missing HUBSPOT_* envs");

  const form = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
  const tr = await fetch(`${BASE_OAUTH}/oauth/v1/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" });
  const tokens = await safeJson(tr); if (!tr.ok) throw new Error(`OAuth exchange failed: ${tokens?.message || tr.statusText}`);

  const ir = await fetch(`${BASE_OAUTH}/oauth/v1/access-tokens/${encodeURIComponent(tokens.access_token)}`, { cache: "no-store" });
  const info = await safeJson(ir); if (!ir.ok) throw new Error(`Introspection failed: ${info?.message || ir.statusText}`);

  const token: TokenRecord = { ...tokens, hubId: info?.hub_id ?? info?.hubId ?? null, obtained_at: Math.floor(Date.now()/1000) };
  return { token, info };
}
async function safeJson(res: Response) { const t = await res.text(); if (!t) return null as any; try { return JSON.parse(t); } catch { return { raw: t } as any; } }

// --- Refresh / fetch helpers ---
export async function refreshTokens(rec?: TokenRecord) {
  const base = rec?.refresh_token ? rec : tokenStore.get();
  const refreshToken = base?.refresh_token || process.env.HUBSPOT_REFRESH_TOKEN || "";
  const clientId = process.env.HUBSPOT_CLIENT_ID || "", clientSecret = process.env.HUBSPOT_CLIENT_SECRET || "";
  if (!refreshToken || !clientId || !clientSecret) throw new Error("Missing refresh_token or client credentials");

  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const r = await fetch(`${BASE_OAUTH}/oauth/v1/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" });
  const data = await safeJson(r); if (!r.ok) throw new Error(`Refresh failed: ${data?.message || r.statusText}`);
  const updated: TokenRecord = { ...base, ...data, obtained_at: Math.floor(Date.now()/1000) };
  tokenStore.set(updated, typeof updated.hubId === "number" ? updated.hubId : undefined);
  return updated;
}
export async function refreshIfNeeded(rec?: TokenRecord) {
  if (!rec?.access_token || !rec?.expires_in || !rec?.obtained_at) return rec;
  const age = Math.floor(Date.now()/1000) - Number(rec.obtained_at), ttl = Number(rec.expires_in);
  return age >= Math.max(0, ttl - 120) ? refreshTokens(rec) : rec;
}
export async function hsFetch(bundle: TokenRecord | undefined, path: string, init: RequestInit = {}) {
  const rec = await refreshIfNeeded(bundle ?? tokenStore.get()); const tok = rec?.access_token || "";
  if (!tok) throw new Error("No access_token available");
  const url = path.startsWith("http") ? path : `${BASE_OAUTH}${path}`;
  return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, cache: "no-store" });
}
export async function hsGetOwners(bundle?: TokenRecord, { limit = 10 } = {}) {
  const r = await hsFetch(bundle, `/crm/v3/owners/?limit=${limit}`); const d = await safeJson(r);
  if (!r.ok) throw new Error(`owners failed: ${d?.message || r.statusText}`); return Array.isArray(d?.results) ? d.results : d;
}
export async function hsGetProperties(bundle?: TokenRecord, objectType = "contacts") {
  const r = await hsFetch(bundle, `/crm/v3/properties/${objectType}`); const d = await safeJson(r);
  if (!r.ok) throw new Error(`getProperties failed: ${d?.message || r.statusText}`); return Array.isArray(d?.results) ? d.results : d;
}
