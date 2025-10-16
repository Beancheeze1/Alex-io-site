// /lib/hsFiles.js
import { getToken } from "@/lib/oauthStore.js";

export async function hsUploadBuffer({ hubId, buffer, filename, folderPath = "quotes" }) {
  const bearer = getToken(hubId);
  if (!bearer) throw new Error(`No OAuth token for hub ${hubId}`);

  const form = new FormData();
  form.set("file", new Blob([buffer]), filename);
  form.set("folderPath", `/${folderPath}`);
  form.set("options", JSON.stringify({ access: "PUBLIC_INDEXABLE" }));

  const res = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: form,
  });

  const j = await res.json();
  if (!res.ok) throw new Error(`Files API ${res.status}: ${JSON.stringify(j)}`);

  // v3 returns id and a public url
  return { id: j.id, url: j.url };
}
