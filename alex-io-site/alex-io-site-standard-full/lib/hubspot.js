// lib/hubspot.js
function mustToken() {
  const t = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!t) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return t;
}
function headers(json = true) {
  return json
    ? { Authorization: `Bearer ${mustToken()}`, "Content-Type": "application/json" }
    : { Authorization: `Bearer ${mustToken()}` };
}
async function jsonOrText(r) {
  const txt = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(txt), raw: txt }; }
  catch { return { ok: r.ok, status: r.status, data: null, raw: txt }; }
}

export async function getConversationIdFromThread(threadId) {
  if (!threadId) throw new Error("threadId required");
  const r = await fetch(
    `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`,
    { headers: headers(false) }
  );
  const { ok, status, data, raw } = await jsonOrText(r);
  if (!ok) throw new Error(`Thread lookup ${status}: ${raw}`);
  const id = data?.conversation?.id;
  if (!id) throw new Error(`No conversationId on thread ${threadId}`);
  return id;
}

/**
 * Post a message. Default is posting to the THREAD endpoint,
 * which proves more reliable across inbox types.
 * kind: "thread" | "conversation"
 */
export async function postHubSpotMessage(id, text, { kind = "thread" } = {}) {
  if (!id) throw new Error("id required");
  if (!text) throw new Error("text required");
  const url = kind === "conversation"
    ? `https://api.hubapi.com/conversations/v3/conversations/${id}/messages`
    : `https://api.hubapi.com/conversations/v3/conversations/threads/${id}/messages`;

  // `sender` helps some portals render the message properly
  const payload = { type: "MESSAGE", text, sender: { type: "BOT", name: "ALEX-IO" } };

  const r = await fetch(url, { method: "POST", headers: headers(true), body: JSON.stringify(payload) });
  const { ok, status, data, raw } = await jsonOrText(r);
  if (!ok) throw new Error(`Post ${kind} ${status}: ${raw}`);
  return data ?? { ok: true, raw };
}


// Optional: simple guard if webhook payload includes your appId or bot sender flag
export function isFromOurApp(eventAppId) {
  const appId = process.env.HUBSPOT_APP_ID;
  if (!appId) return false; // if not configured, we won't filter by appId
  return String(eventAppId) === String(appId);
}

