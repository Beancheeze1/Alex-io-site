// lib/hubspot.js
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

if (!HUBSPOT_TOKEN) {
  console.warn("HUBSPOT_ACCESS_TOKEN is missing");
}

const BASE = "https://api.hubapi.com";

/** Generic REST helper */
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

  // Return JSON or throw with details
  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const details = data && data.message ? data.message : text || res.statusText;
    const err = new Error(`HubSpot ${res.status} ${res.statusText}: ${details}`);
    err.status = res.status;
    err.details = data || details;
    throw err;
  }
  return data;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/** Read a message by id (to check sender info) */
export async function getMessageById(messageId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`
  );
}

/** Read a thread by id (to discover conversationId + channelType) */
export async function getThreadById(threadId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`
  );
}

/** Send an EMAIL reply (same endpoint as chat for most portals) */
export async function sendEmailReply(threadId, bodyText) {
  return apiRequest(
    "POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    {
      type: "MESSAGE",
      text: bodyText
      // If your portal requires channelId or direction, add here (inspect getThreadById output).
    }
  );
}

/** Send a CHAT/MESSAGING reply */
export async function sendChatReply(threadId, bodyText) {
  return apiRequest(
    "POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    {
      type: "MESSAGE",
      text: bodyText
    }
  );
}
