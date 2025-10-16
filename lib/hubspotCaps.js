// /lib/hubspotCaps.js
import { getAccessToken } from "@lib/oauthStore.js";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // hubId -> { scopes:Set<string>, quotingMode:string, ts:number }

export function getQuotingMode(scopes) {
  const s = new Set(scopes);
  if (s.has("crm.objects.quotes.write") && s.has("files")) return "full";
  if (s.has("files")) return "pdf_only";
  return "local_only";
}

export async function fetchCaps(hubId) {
  const cached = cache.get(hubId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached;

  const bearer = await getAccessToken(hubId);   // <— will auto-refresh
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${bearer}`);
  const j = await r.json();
  if (!r.ok) throw new Error(`caps ${r.status}: ${JSON.stringify(j)}`);

  const scopes = j.scopes || [];
  const rec = { scopes, quotingMode: getQuotingMode(scopes), ts: Date.now() };
  cache.set(hubId, rec);
  return rec;
}
