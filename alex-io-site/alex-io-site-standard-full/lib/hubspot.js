// lib/hubspot.js
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = "https://api.hubapi.com";

if (!HUBSPOT_TOKEN) {
  console.warn("HUBSPOT_ACCESS_TOKEN is missing");
}

/** Minimal REST helper using Node 18/20 built-in fetch */
async function apiRequest(method, path, body) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const txt = await res.text();
  const data = txt ? safeJson(txt) : null;

  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    const err = new Error(`HubSpot ${res.status} ${res.statusText}: ${msg}`);
    err.status = res.status;
    err.details = data || msg;
    throw err;
  }
  return data;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return { raw: s }; } }

/** Read a message by id (check sender to ignore ourselves) */
export async function getMessageById(messageId) {
  return apiRequest("GET", `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`);
}

/** Read a thread by id (has channelType, conversationId, etc.) */
export async function getThreadById(threadId) {
  return apiRequest("GET", `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`);
}

/** Send EMAIL reply (same endpoint is fine for chat in many portals) */
export async function sendEmailReply(threadId, bodyText) {
  return apiRequest(
    "POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { type: "MESSAGE", text: bodyText }
  );
}

/** Send CHAT/MESSAGING reply */
export async function sendChatReply(threadId, bodyText) {
  return apiRequest(
    "POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { type: "MESSAGE", text: bodyText }
  );
}
