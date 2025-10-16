// lib/hsFiles.js
import { getToken } from "@/lib/oauthStore.js";

export const runtime = "nodejs";

/**
 * Upload a Buffer to HubSpot Files and return file id + public URL.
 *
 * @param {Object} opts
 * @param {Buffer|Uint8Array|ArrayBuffer} opts.buffer
 * @param {string} opts.filename
 * @param {string} [opts.folderPath="quotes"]
 * @param {string|number} [opts.hubId]
 */
export async function hsUploadBuffer({ buffer, filename, folderPath = "quotes", hubId }) {
  const token = getToken(hubId) || process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    throw new Error("Files upload: no HubSpot token for hub");
  }

  // Ensure we have a Blob for FormData
  let blob;
  if (buffer instanceof Blob) {
    blob = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    blob = new Blob([buffer]);
  } else if (ArrayBuffer.isView(buffer)) {
    blob = new Blob([buffer.buffer]);
  } else {
    // Node Buffer
    blob = new Blob([buffer]);
  }

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("folderPath", folderPath);
  form.append("options", JSON.stringify({ access: "PUBLIC_INDEXABLE" }));

  const r = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Files API ${r.status}: ${JSON.stringify(j)}`);
  }

  return {
    id: j.id ?? j.fileId ?? null,
    url: j.url ?? j.browserUrl ?? null
  };
}
