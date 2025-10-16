// /lib/hubspotAssociations.js
import { getToken } from "@/lib/oauthStore.js";

/** Associate a Deal to a File (shows under Attachments on the record) */
export async function associateDealToFile({ hubId, dealId, fileId }) {
  const bearer = getToken(hubId);
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  const body = {
    inputs: [{ from: { id: String(dealId) }, to: { id: String(fileId) }, type: "deal_to_file" }],
  };

  const r = await fetch("https://api.hubapi.com/crm/v4/associations/deal/file/batch/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const j = await r.json();
  if (!r.ok) throw new Error(`Associate deal->file failed: ${r.status} ${JSON.stringify(j)}`);
  return j;
}
