import { getToken } from "@/lib/oauthStore.js";

const cache = new Map(); // hubId -> { scopes:Set<string>, quotingMode:string, ts:number }
const TTL_MS = 10 * 60 * 1000;

export function getQuotingMode(scopes) {
  const s = new Set(scopes);
  // pick the mode you want — tweak as needed
  if (s.has("crm.objects.quotes.write") && s.has("files")) return "full";           // PDF + Files + quote ops
  if (s.has("files")) return "pdf_only";                                            // PDF + Files upload
  return "local_only";                                                               // no upload
}

export async function fetchCaps(hubId) {
  const cached = cache.get(hubId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached;

  const bearer = getToken(hubId);
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${bearer}`);
  const j = await r.json();
  if (!r.ok) throw new Error(`caps ${r.status}: ${JSON.stringify(j)}`);

  const scopes = j.scopes || [];
  const quotingMode = getQuotingMode(scopes);
  const rec = { scopes: new Set(scopes), quotingMode, ts: Date.now() };
  cache.set(hubId, rec);
  return rec;
}
