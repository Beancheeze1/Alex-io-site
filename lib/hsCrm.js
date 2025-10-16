// lib/hsCrm.js
import { getToken } from "@/lib/oauthStore.js";

/**
 * Update a single CRM property on a record (deal/company/contact, etc).
 * - object: "deals" | "companies" | "contacts" | other CRM object names
 * - id: record ID (string/number)
 * - property: CRM property internal name (must exist on object)
 * - value: value to set
 */
export async function updateCrmProperty({ hubId = null, object, id, property, value, token = null }) {
  let bearer = token;
  if (!bearer && hubId) bearer = getToken(hubId);
  if (!bearer) bearer = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!bearer) throw new Error("No HubSpot token available (OAuth or PAT).");

  const r = await fetch(`https://api.hubapi.com/crm/v3/objects/${object}/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ properties: { [property]: value } }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`CRM ${object}/${id} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}
