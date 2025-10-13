// lib/hubspot.js
// Shared helpers for HubSpot Conversations API

// Minimal retry helper for transient 429/5xx
async function withRetry(fn, { attempts = 3, baseMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.code || "";
      // only retry on 429/5xx-ish or explicit transient flags
      const shouldRetry =
        /(^429$)|(^5\d{2}$)/.test(String(status)) ||
        /ECONNRESET|ETIMEDOUT/i.test(String(err?.message || ""));
      if (!shouldRetry || i === attempts - 1) break;
      const jitter = Math.floor(Math.random() * baseMs);
      await new Promise(r => setTimeout(r, baseMs + jitter));
    }
  }
  throw lastErr;
}

function authHeaders() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("Missing HUBSPOT_ACCESS_TOKEN");
  return { Authorization: `Bearer ${token}` };
}

export async function getConversationIdFromThread(threadId) {
  if (!threadId) throw new Error("threadId is required");
  const url = `https://api.hubapi.com/conversations/v3/conversations/threads/${threadId}`;

  const res = await withRetry(() =>
    fetch(url, { headers: authHeaders() }).then(async r => {
      if (!r.ok) {
        const txt = await r.text();
        const err = new Error(`Thread lookup failed ${r.status}: ${txt}`);
        err.status = r.status;
        throw err;
      }
      return r.json();
    })
  );

  const conversationId = res?.conversation?.id;
  if (!conversationId) throw new Error(`No conversationId on thread ${threadId}`);
  return conversationId;
}

export async function postHubSpotMessage(conversationId, text) {
  if (!conversationId) throw new Error("conversationId is required");
  if (!text) throw new Error("text is required");

  const url = `https://api.hubapi.com/conversations/v3/conversations/${conversationId}/messages`;
  const payload = { type: "MESSAGE", text };

  const data = await withRetry(() =>
    fetch(url, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async r => {
      const body = await r.text(); // read once
      if (!r.ok) {
        const err = new Error(`HubSpot post failed ${r.status}: ${body}`);
        err.status = r.status;
        throw err;
      }
      try { return JSON.parse(body); } catch { return { ok: true, raw: body }; }
    })
  );

  return data;
}

// Optional: simple guard if webhook payload includes your appId or bot sender flag
export function isFromOurApp(eventAppId) {
  const appId = process.env.HUBSPOT_APP_ID;
  if (!appId) return false; // if not configured, we won't filter by appId
  return String(eventAppId) === String(appId);
}

