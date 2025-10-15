// lib/hubspotCaps.js
import { capabilitiesFromScopes } from "./capabilities.js";

// In-memory singleton cache (survives per server instance)
const CACHE_KEY = "__HUBSPOT_CAPS_CACHE__";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function now() { return Date.now(); }

async function hs(path, token) {
  const url = path.startsWith("http") ? path : `https://api.hubapi.com${path}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data };
}

async function tryIntrospect(token) {
  try {
    const r = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`, { cache: "no-store" });
    if (!r.ok) return { hubId: null, scopes: null, status: r.status };
    const j = await r.json();
    return { hubId: j?.hub_id ?? null, scopes: j?.scopes ?? null, status: r.status };
  } catch {
    return { hubId: null, scopes: null, status: 0 };
  }
}

async function computeCaps() {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN missing");

  // 1) Try to get scopes (may be null for Private App tokens)
  const { hubId, scopes } = await tryIntrospect(token);

  // 2) Probe safe, read-only endpoints
  const [owners, products, lineItems, dealsR, contacts, companies, conv, filesR] = await Promise.all([
    hs("/crm/v3/owners?limit=1", token),
    hs("/crm/v3/objects/products?limit=1", token),
    hs("/crm/v3/objects/line_items?limit=1", token),
    hs("/crm/v3/objects/deals?limit=1", token),
    hs("/crm/v3/objects/contacts?limit=1", token),
    hs("/crm/v3/objects/companies?limit=1", token),
    hs("/conversations/v3/conversations/threads?limit=1", token),
    hs("/files/v3/files?limit=1", token),
  ]);
  const is200 = (x) => x.status >= 200 && x.status < 300;

  // 3) Start with scopes (if any), then overlay probes
  let caps = capabilitiesFromScopes(scopes || []);
  caps = {
    ...caps,
    conversationsRead: is200(conv)      || caps.conversationsRead,
    filesRead:         is200(filesR)    || caps.filesRead,
    productsRead:      is200(products)  || caps.productsRead,
    lineItemsRead:     is200(lineItems) || caps.lineItemsRead,
    dealsRead:         is200(dealsR)    || caps.dealsRead,
    contactsRead:      is200(contacts)  || caps.contactsRead,
    companiesRead:     is200(companies) || caps.companiesRead,
  };

  // 4) Final quoting mode (allow PDF if we can at least read/upload files)
  caps.quotingMode =
    (caps.quotesRead && caps.quotesWrite && caps.productsRead &&
     caps.lineItemsRead && caps.lineItemsWrite && caps.dealsWrite)
      ? "native"
      : ((caps.filesWrite || caps.filesRead) ? "pdf" : "text-only");

  return {
    hubId,
    computedAt: now(),
    ttlMs: DEFAULT_TTL_MS,
    probes: {
      owners: owners.status, products: products.status, lineItems: lineItems.status,
      deals: dealsR.status, contacts: contacts.status, companies: companies.status,
      conversations: conv.status, files: filesR.status,
    },
    can: caps,
    quotingMode: caps.quotingMode,
  };
}

/** Public: get cached caps (refresh when expired). */
export async function getHubSpotCaps({ forceRefresh = false } = {}) {
  if (!globalThis[CACHE_KEY]) {
    globalThis[CACHE_KEY] = { value: null };
  }
  const bucket = globalThis[CACHE_KEY];

  const expired = !bucket.value ||
                  (now() - (bucket.value?.computedAt || 0)) > (bucket.value?.ttlMs || DEFAULT_TTL_MS);

  if (forceRefresh || expired) {
    bucket.value = await computeCaps();
  }
  return bucket.value;
}

/** Optional: manual invalidation (e.g., after you rotate the token). */
export function invalidateHubSpotCaps() {
  if (globalThis[CACHE_KEY]) globalThis[CACHE_KEY].value = null;
}
