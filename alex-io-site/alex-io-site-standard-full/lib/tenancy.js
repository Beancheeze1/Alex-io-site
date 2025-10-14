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
