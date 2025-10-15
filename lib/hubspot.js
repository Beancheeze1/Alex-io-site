// lib/hubspot.js
const BASE = "https://api.hubapi.com";

function requireToken() {
  const t = process.env.HUBSPOT_PRIVATE_APP_TOKEN || "";
  if (!t) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN missing");
  return t;
}

/** Generic fetch wrapper for HubSpot APIs using your Private App token */
export async function hsFetch(path, init = {}) {
  const token = requireToken();
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = `HubSpot ${res.status} ${res.statusText} on ${path}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

/** Light-weight token/scopes sanity call (no special scopes required) */
export async function hsGetOwners(limit = 1) {
  return hsFetch(`/crm/v3/owners?limit=${limit}`);
}


/** Read a message by id (used in webhook processing) */
export async function getMessageById(messageId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/messages/${encodeURIComponent(messageId)}`
  );
}

/** Read a thread by id (basic properties like status, inboxId, etc.) */
export async function getThreadById(threadId) {
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`
  );
}

/** NEW: list messages in a thread (to see sender info / channel-ish hints) */
export async function getThreadMessages(threadId, limit = 50, after = undefined) {
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (after) qs.set("after", String(after));
  return apiRequest(
    "GET",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages?${qs}`
  );
}
// Works with Private App tokens (pat_...) and OAuth tokens
export async function whoAmI() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN missing");

  // This endpoint returns the current account/portal details for the auth context
  // Docs: GET /account-info/v3/details
  const res = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const txt = await res.text();
  const data = txt ? (() => { try { return JSON.parse(txt); } catch { return { raw: txt }; } })() : null;

  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    const err = new Error(`whoAmI ${res.status}: ${msg}`);
    err.status = res.status;
    err.details = data || msg;
    throw err;
  }

  // Normalize a few common fields
  return {
    hubId: data?.portalId ?? data?.id ?? null,
    name: data?.name ?? data?.accountName ?? null,
    timeZone: data?.timezone ?? null,
    raw: data
  };
}


/** Simple reply (same endpoint works for email/chat) */
export async function sendReply(threadId, bodyText) {
  return apiRequest(
    "POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { type: "MESSAGE", text: bodyText }
  );
}

/** (kept) split helpers if you still call them elsewhere */
export async function sendEmailReply(threadId, bodyText) { return sendReply(threadId, bodyText); }
export async function sendChatReply(threadId, bodyText)  { return sendReply(threadId, bodyText); }

/* Optional diagnostics used earlier */
export async function listThreads(limit = 10, after) {
  const qs = new URLSearchParams(); qs.set("limit", String(limit)); if (after) qs.set("after", String(after));
  return apiRequest("GET", `/conversations/v3/conversations/threads?${qs}`);
}
