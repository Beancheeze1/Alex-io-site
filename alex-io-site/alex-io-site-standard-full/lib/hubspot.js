// lib/hubspot.js
import { Client } from "@hubspot/api-client";

const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN;
if (!hubspotToken) {
  console.warn("HUBSPOT_ACCESS_TOKEN missing");
}
export const hubspot = new Client({ accessToken: hubspotToken });

export async function getMessageById(messageId) {
  const r = await hubspot.apiRequest({
    method: "GET",
    path: `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`
  });
  return r.json();
}

export async function getThreadById(threadId) {
  const r = await hubspot.apiRequest({
    method: "GET",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`
  });
  return r.json();
}

export async function sendEmailReply(threadId, bodyText) {
  const r = await hubspot.apiRequest({
    method: "POST",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    body: {
      type: "MESSAGE",
      text: bodyText
      // add channelId if your portal requires it after you inspect thread JSON
    }
  });
  return r.json();
}

export async function sendChatReply(threadId, bodyText) {
  const r = await hubspot.apiRequest({
    method: "POST",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    body: {
      type: "MESSAGE",
      text: bodyText
    }
  });
  return r.json();
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
export async function postMessageToThread(threadId, text, { type = "COMMENT" } = {}) {
  if (!threadId) throw new Error("threadId required");
  if (!text) throw new Error("text required");

  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}/messages`;

  // Minimal valid payload for an internal comment:
  // { "type": "COMMENT", "text": "..." }
  const payload =
    type === "MESSAGE"
      ? { type: "MESSAGE", text } // MESSAGE works, but usually also needs sender/recipients/channel – see docs
      : { type: "COMMENT", text }; // default

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await r.text();
  if (!r.ok) throw new Error(`HubSpot ${r.status}: ${body}`);
  try { return JSON.parse(body); } catch { return { ok: true, raw: body }; }
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
