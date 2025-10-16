// lib/hubspot.js
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = "https://api.hubapi.com";

if (!HUBSPOT_TOKEN) {
  console.warn("HUBSPOT_ACCESS_TOKEN is missing");
}

/** Minimal REST helper using Node 18/20 built-in fetch */
async function apiRequest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const txt = await res.text();
  const data = txt ? (() => { try { return JSON.parse(txt); } catch { return { raw: txt }; } })() : null;

  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    const err = new Error(`HubSpot ${res.status} ${res.statusText}: ${msg}`);
    err.status = res.status;
    err.details = data || msg;
    throw err;
  }
  return data;
}

/** ✅ Add back: read a message by id (used for sender filtering) */
export async function getMessageById(messageId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`
  );
}

/** Read a thread by id (channelType, conversationId, etc.) */
export async function getThreadById(threadId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`
  );
}

/** Send EMAIL reply */
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
export async function whoAmI() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN missing");
  const res = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${token}`);
  const txt = await res.text();
  const data = txt ? (()=>{ try { return JSON.parse(txt); } catch { return { raw: txt }; } })() : null;
  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    const err = new Error(`whoAmI ${res.status}: ${msg}`);
    err.status = res.status; err.details = data || msg; throw err;
  }
  return data; // contains hubId (portal id), user info, scopes, expiresIn, etc.
}
