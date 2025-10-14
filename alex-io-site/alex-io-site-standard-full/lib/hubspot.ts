// lib/hubspot.ts
import { Client } from "@hubspot/api-client";

const hubspotToken = process.env.HUBSPOT_ACCESS_TOKEN!;
export const hubspot = new Client({ accessToken: hubspotToken });

/**
 * Get a single message to inspect who sent it.
 * We rely on HubSpot's Conversations APIs. If your SDK lacks a direct method,
 * we can use the generic apiRequest.
 */
export async function getMessageById(messageId: string) {
  // Generic fallback request (works across SDK versions):
  const r = await hubspot.apiRequest({
    method: "GET",
    path: `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`,
  });
  return r.json();
}

/**
 * Get thread info (find conversationId + channelType).
 * We treat webhook objectId as threadId.
 */
export async function getThreadById(threadId: string) {
  const r = await hubspot.apiRequest({
    method: "GET",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`,
  });
  return r.json();
}

/**
 * Send a reply to an EMAIL thread.
 * Adjust payload shape if your portal expects slightly different fields.
 */
export async function sendEmailReply(threadId: string, bodyText: string) {
  const r = await hubspot.apiRequest({
    method: "POST",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    body: {
      type: "MESSAGE",
      text: bodyText,
      // Some portals require specifying "channelId" or "direction": "OUTGOING"
      // If getThreadById returns channel info, you can include it here:
      // channelId: thread.channelId,
    },
  });
  return r.json();
}

/**
 * Send a reply to a CHAT/MESSAGING thread.
 */
export async function sendChatReply(threadId: string, bodyText: string) {
  const r = await hubspot.apiRequest({
    method: "POST",
    path: `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    body: {
      type: "MESSAGE",
      text: bodyText,
    },
  });
  return r.json();
}
