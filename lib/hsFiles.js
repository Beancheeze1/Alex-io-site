import { getToken } from "./oauthStore.js";

export async function hsUploadBuffer({ filename, buffer, folderPath = "quotes", access = "PUBLIC_INDEXABLE", hubId = null, token = null }) {
  // Select token: explicit param > OAuth store by hub > PAT fallback
  let bearer = token;
  if (!bearer && hubId) bearer = getToken(hubId);
  if (!bearer) bearer = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";

  if (!bearer) throw new Error("No HubSpot token available (OAuth or PAT).");

  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("options", JSON.stringify({ access, overwrite: false, duplicateValidationStrategy: "NONE" }));
  form.append("folderPath", folderPath);

  const r = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Files API ${r.status}: ${JSON.stringify(j)}`);
  return j.url || j.browserUrl || null;
}
// ensure this returns id + url
// ...
const j = await r.json().catch(() => ({}));
if (!r.ok) throw new Error(`Files API ${r.status}: ${JSON.stringify(j)}`);
return { id: j.id ?? j.fileId ?? null, url: j.url || j.browserUrl || null };