// lib/hubspot.js
function requireToken() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!t) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return t;
}

function jsonHeaders() {
  return {
    Authorization: `Bearer ${requireToken()}`,
    "Content-Type": "application/json",
  };
}

async function read(r) {
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}

/** Most reliable across inbox types: post to the THREAD endpoint */
export async function postMessageToThread(threadId, text) {
  if (!threadId) throw new Error("threadId required");
  if (!text) throw new Error("text required");

  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;
  const payload = {
    type: "MESSAGE",                 // use "INTERNAL_NOTE" if you want an internal note
    text,
    sender: { type: "BOT", name: "ALEX-IO" }
  };

  const r = await fetch(url, { method: "POST", headers: jsonHeaders(), body: JSON.stringify(payload) });
  const out = await read(r);
  if (!out.ok) throw new Error(`HubSpot POST thread ${out.status}: ${out.text}`);
  return out.json ?? { ok: true };
}
