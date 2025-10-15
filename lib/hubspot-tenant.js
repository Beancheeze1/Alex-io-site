// lib/hubspot-tenant.js
const BASE = "https://api.hubapi.com";

function jsonOrText(res) {
  return res.text().then(txt => {
    if (!txt) return null;
    try { return JSON.parse(txt); } catch { return { raw: txt }; }
  });
}

export async function hsApi(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await jsonOrText(res);
  if (!res.ok) {
    const msg = (data && (data.message || data.raw)) || res.statusText;
    const err = new Error(`HubSpot ${res.status}: ${msg}`);
    err.status = res.status; err.details = data;
    throw err;
  }
  return data;
}

export const getMessageById = (id, token) =>
  hsApi("GET", `/conversations/v3/conversations/messages/${encodeURIComponent(id)}`, token);

export const getThreadById = (id, token) =>
  hsApi("GET", `/conversations/v3/conversations/threads/${encodeURIComponent(id)}`, token);

export const getThreadMessages = (id, token, limit = 50, after) => {
  const qs = new URLSearchParams(); qs.set("limit", String(limit)); if (after) qs.set("after", String(after));
  return hsApi("GET", `/conversations/v3/conversations/threads/${encodeURIComponent(id)}/messages?${qs}`, token);
};

export const sendReply = (threadId, text, token) =>
  hsApi("POST", `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`, token, {
    type: "MESSAGE", text
  });

// account/portal check (PAT safe)
export const whoAmIWithToken = (token) =>
  fetch("https://api.hubapi.com/account-info/v3/details", { headers: { Authorization: `Bearer ${token}` } })
    .then(async res => {
      const data = await jsonOrText(res);
      if (!res.ok) {
        const err = new Error(`whoAmI ${res.status}: ${(data && (data.message || data.raw)) || res.statusText}`);
        err.status = res.status; err.details = data; throw err;
      }
      return { hubId: data?.portalId ?? data?.id ?? null, raw: data };
    });
