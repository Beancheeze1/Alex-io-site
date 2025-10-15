// lib/hsFiles.js
export async function hsUploadBuffer({ filename, buffer, folderPath = "quotes", access = "PUBLIC_INDEXABLE" }) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN missing");

  // Node 18+ has global FormData/Blob
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("options", JSON.stringify({ access, overwrite: false, duplicateValidationStrategy: "NONE" }));
  form.append("folderPath", folderPath);

  const r = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Files API ${r.status}: ${JSON.stringify(j)}`);
  // v3 returns { id, name, url, ... }
  return j.url || j.browserUrl || null;
}
