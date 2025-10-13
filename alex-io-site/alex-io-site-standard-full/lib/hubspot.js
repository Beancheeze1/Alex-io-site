// lib/hubspot.js
function requireToken() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return token;
}

function jsonHeaders() {
  return {
    Authorization: `Bearer ${requireToken()}`,
    "Content-Type": "application/json",
  };
}

async function parse(r) {
  const txt = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: JSON.parse(txt), raw: txt };
  } catch {
    return { ok: r.ok, status: r.status, data: null, raw: txt };
  }
}

export async function postMessageToThread(threadId, text) {
  if (!threadId) throw new Error("threadId required");
  if (!text) throw new Error("text required");

  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;
  const payload = {
    type: "MESSAGE", // change to "INTERNAL_NOTE" if you want private notes
    text,
    sender: { type: "BOT", name: "ALEX-IO" },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  const res = await parse(r);

  if (!res.ok) throw new Error(`HubSpot POST failed ${res.status}: ${res.raw}`);
  return res.data ?? { ok: true };
}
