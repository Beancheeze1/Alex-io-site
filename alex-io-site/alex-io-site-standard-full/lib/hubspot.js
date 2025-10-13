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

function authHeaders() {
  return { Authorization: `Bearer ${requireToken()}` };
}

async function parseResponse(r) {
  const txt = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: JSON.parse(txt), raw: txt };
  } catch {
    return { ok: r.ok, status: r.status, data: null, raw: txt };
  }
}

/** -------- Helpers you asked for (back-compat) -------- **/

// Resolve conversationId from a threadId (some code still calls this)
export async function getConversationIdFromThread(threadId) {
  if (!threadId) throw new Error("threadId required");
  const r = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`,
    { headers: authHeaders() }
  );
  const res = await parseResponse(r);
  if (!res.ok) throw new Error(`Thread lookup ${res.status}: ${res.raw}`);
  const id = res?.data?.conversation?.id;
  if (!id) throw new Error(`No conversationId on thread ${threadId}`);
  return id;
}

/** Most reliable: post directly to the THREAD endpoint */
export async function postMessageToThread(threadId, text) {
  if (!threadId) throw new Error("threadId required");
  if (!text) throw new Error("text required");

  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;
  const payload = {
    type: "MESSAGE", // change to "INTERNAL_NOTE" for a private note
    text,
    sender: { type: "BOT", name: "ALEX-IO" },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  const res = await parseResponse(r);
  if (!res.ok) throw new Error(`Post thread ${res.status}: ${res.raw}`);
  return res.data ?? { ok: true };
}

/** Back-compat wrapper: lets older code call postHubSpotMessage(kind) */
export async function postHubSpotMessage(id, text, { kind = "conversation" } = {}) {
  if (!id) throw new Error("id required");
  if (!text) throw new Error("text required");

  if (kind === "thread") {
    return postMessageToThread(id, text);
  }

  // conversation endpoint (some setups require this)
  const url = `https://api.hubapi.com/conversations/v3/conversations/${id}/messages`;
  const payload = {
    type: "MESSAGE",
    text,
    sender: { type: "BOT", name: "ALEX-IO" },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  const res = await parseResponse(r);
  if (!res.ok) throw new Error(`Post conversation ${res.status}: ${res.raw}`);
  return res.data ?? { ok: true };
}
