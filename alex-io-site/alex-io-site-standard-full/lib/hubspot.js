// lib/hubspot.js
const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = "https://api.hubapi.com";
if (!HUBSPOT_TOKEN) console.warn("HUBSPOT_ACCESS_TOKEN is missing");

async function apiRequest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const txt = await res.text();
  const data = txt ? (()=>{ try{ return JSON.parse(txt);}catch{return { raw: txt }; }})() : null;
  if (!res.ok) {
    const msg = data?.message || txt || res.statusText;
    const err = new Error(`HubSpot ${res.status} ${res.statusText}: ${msg}`);
    err.status = res.status; err.details = data || msg; throw err;
  }
  return data;
}

export async function getThreadById(threadId) {
  return apiRequest("GET", `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}`);
}

export async function sendEmailReply(threadId, bodyText) {
  return apiRequest("POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { type: "MESSAGE", text: bodyText }
  );
}

export async function sendChatReply(threadId, bodyText) {
  return apiRequest("POST",
    `/conversations/v3/conversations/threads/${encodeURIComponent(threadId)}/messages`,
    { type: "MESSAGE", text: bodyText }
  );
}
