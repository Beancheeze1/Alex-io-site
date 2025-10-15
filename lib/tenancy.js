HEAD
// lib/tenancy.js
// START SIMPLE: inline registry. later, swap this for a DB table.
// secrets should come from ENV (never commit tokens).
export const tenants = {
  // Example tenant "demo". Change or add more below.
  "demo": {
    brand: { signature: "\n— Demo Bot" },
    // choose one backend:
    pricingSource: {
      kind: "formula",
      formula: {
        baseSetup: 25,
        laborPerUnitMin: 0.25,
        materialRates: { foam_1_7lb: 0.0024, foam_2_2lb: 0.0028, crate_plywood: 0.0010 },
        markup: 1.15,
        discounts: [{ minQty: 100, multiplier: 0.97 }, { minQty: 250, multiplier: 0.95 }]
      },
      tax: { rate: 0.00 }, shipping: { perLb: 0.75 }
    },
    calendar: { link: "https://cal.com/yourteam/intro" },
    features: { quotes: true, meetings: true, infoLookup: true },
    // Secrets are namespaced ENV vars:
    env: {
      HUBSPOT_ACCESS_TOKEN: process.env.DEMO_HS_TOKEN,
      HUBSPOT_APP_ID: process.env.DEMO_HS_APP_ID,         // optional
      HUBSPOT_WEBHOOK_SECRET: process.env.DEMO_HS_SECRET, // signature verify
    }
    // If you want Google Sheet or Postgres, add config keys here (ids/urls)
  },

  // add more tenants by copy/paste:
  // "acme": { ...similar..., env: { HUBSPOT_ACCESS_TOKEN: process.env.ACME_HS_TOKEN, HUBSPOT_WEBHOOK_SECRET: process.env.ACME_HS_SECRET } }
};

// Resolve tenant from subdomain, header, or ?tenant= query.
export function resolveTenantFromRequest(req) {
  const url = new URL(req.url);
  const qp = (url.searchParams.get("tenant") || "").toLowerCase();
  const hdr = (req.headers.get("x-tenant") || "").toLowerCase();
  const host = (req.headers.get("host") || "").toLowerCase(); // e.g., api.customer-a.com

  // try header, then query, then subdomain (leftmost label)
  const sub = host.split(".")[0];
  const id = hdr || qp || sub;

  const cfg = tenants[id];
  if (!cfg) throw new Error(`Unknown tenant '${id}'. Pass ?tenant=<id> or X-Tenant header.`);
  // basic secret presence check:
  if (!cfg.env?.HUBSPOT_ACCESS_TOKEN) throw new Error(`Tenant '${id}' is missing HUBSPOT_ACCESS_TOKEN env.`);
  return { tenantId: id, cfg };
}

// lib/tenancy.js
const tenantConfigs = {
  // quick start: file-based; later load from DB
  "customer-a": {
    hubspot: { token: process.env.CUSTA_HS_TOKEN, appId: "2175..." },
    pricingSource: { kind: "sheet", url: "https://..." },
    calendar: { kind: "google", calendarId: "..." },
    features: { quotes: true, meetings: true, infoLookup: true },
    brand: { fromName: "Customer A Sales", signature: "— Team A" }
  },
  "customer-b": {
    hubspot: { token: process.env.CUSTB_HS_TOKEN, appId: "3175..." },
    pricingSource: { kind: "postgres", url: process.env.CUSTB_DB_URL },
    calendar: { kind: "hubspot_meetings", link: "https://meet.link/b" },
    features: { quotes: true, meetings: false, infoLookup: true },
    brand: { fromName: "Customer B Support", signature: "— Team B" }
  }
};

export function resolveTenant(req) {
  // 1) subdomain: api.customer-a.com => "customer-a"
  const host = req.headers.get("host") || "";
  const sub = host.split(".")[0]; // crude but fine to start
  // 2) header (override), or query (?tenant=customer-a)
  const hdr = req.headers.get("x-tenant");
  const url = new URL(req.url);
  const qp = url.searchParams.get("tenant");
  const tenantId = (hdr || qp || sub || "").toLowerCase();
  const cfg = tenantConfigs[tenantId];
  if (!cfg) throw new Error(`Unknown tenant '${tenantId}'`);
  return { tenantId, cfg };
}
f6dd5e74f75b95489f0ed99361ff7fc7c6357b48
